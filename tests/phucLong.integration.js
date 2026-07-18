import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// The integration test exercises the development identity only; production
// Cognito verification remains unchanged.
process.env.USE_MOCK_AUTH = 'true';

const billPath = process.env.BILL_PATH || 'C:\\Users\\Hieu\\Downloads\\bill.jpg';
const authorization = 'Bearer finvantage-mock-id-token';

const parseLambdaResponse = (result) => ({
  statusCode: result.statusCode,
  body: JSON.parse(result.body || '{}')
});

const run = async () => {
  const [
    { handler: importInvoice },
    { handler: runOcr },
    { handler: analyzeInvoice },
    { getDashboardSummary, pgPool, redisClient }
  ] = await Promise.all([
    import('../src/handlers/importHandler.js'),
    import('../src/handlers/ocrApiHandler.js'),
    import('../src/handlers/analysisHandler.js'),
    import('../src/services/db.service.js')
  ]);

  try {
    const file = await readFile(billPath);
    const contentSha256 = createHash('sha256').update(file).digest('hex');
    const imported = parseLambdaResponse(await importInvoice({
      path: '/invoices/import',
      httpMethod: 'POST',
      headers: { Authorization: authorization },
      body: JSON.stringify({ fileName: 'bill.jpg', contentType: 'image/jpeg', contentSha256 })
    }));
    assert.equal(imported.statusCode, 200, imported.body.message);

    const uploadResponse = await fetch(imported.body.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: file
    });
    assert.equal(uploadResponse.ok, true, `S3 upload returned ${uploadResponse.status}`);

    const ocr = parseLambdaResponse(await runOcr({
      pathParameters: { id: imported.body.invoiceId },
      headers: { Authorization: authorization },
      body: JSON.stringify({ fileKey: imported.body.fileKey, cacheKey: imported.body.cacheKey })
    }));
    assert.equal(ocr.statusCode, 200, `${ocr.body.code || ''} ${ocr.body.message || ''}`);
    assert.match(ocr.body.vendor, /PHUC LONG/i);
    assert.equal(ocr.body.totalAmount, 103000);
    assert.equal(ocr.body.transactionDate, '2018-09-11');

    const analyzed = parseLambdaResponse(await analyzeInvoice({
      pathParameters: { id: imported.body.invoiceId },
      headers: { Authorization: authorization },
      body: JSON.stringify({ cacheKey: imported.body.cacheKey })
    }));
    assert.equal(analyzed.statusCode, 200, analyzed.body.message);
    assert.match(analyzed.body.invoice.store_name, /PHUC LONG/i);
    assert.equal(Number(analyzed.body.invoice.total_amount), 103000);
    assert.equal(String(analyzed.body.invoice.transaction_date).slice(0, 10), '2018-09-11');
    assert.equal(analyzed.body.invoice.category, 'Ăn uống');
    assert.equal(analyzed.body.invoice.line_items.length, 3);
    assert.equal(analyzed.body.invoice.line_items.reduce((sum, item) => sum + item.price, 0), 103000);
    assert.match(analyzed.body.invoice.raw_text, /PHUC LONG/i);
    assert.doesNotMatch(analyzed.body.invoice.raw_text, /Cửa hàng giả lập/i);
    assert.notEqual(Number(analyzed.body.invoice.total_amount), 125000);

    // Retrying analysis for the stable invoiceId must update, not insert a duplicate.
    const retried = parseLambdaResponse(await analyzeInvoice({
      pathParameters: { id: imported.body.invoiceId },
      headers: { Authorization: authorization },
      body: JSON.stringify({ cacheKey: imported.body.cacheKey })
    }));
    assert.equal(retried.statusCode, 200, retried.body.message);

    const recordResult = await pgPool.query(
      'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
      [imported.body.invoiceId, 'mock-user']
    );
    assert.equal(recordResult.rowCount, 1);
    assert.equal(Number(recordResult.rows[0].total_amount), 103000);

    const duplicateResult = await pgPool.query(
      'SELECT COUNT(*)::int AS count FROM invoices WHERE id = $1 AND user_id = $2',
      [imported.body.invoiceId, 'mock-user']
    );
    assert.equal(duplicateResult.rows[0].count, 1);

    const dashboard = await getDashboardSummary('mock-user');
    assert.equal(dashboard.categories.some((item) => item.category === 'Ăn uống' && Number(item.total_amount) >= 103000), true);

    console.log(JSON.stringify({
      ok: true,
      invoiceId: imported.body.invoiceId,
      fileKey: imported.body.fileKey,
      storeName: recordResult.rows[0].store_name,
      totalAmount: Number(recordResult.rows[0].total_amount),
      transactionDate: String(recordResult.rows[0].transaction_date).slice(0, 10),
      category: recordResult.rows[0].category,
      lineItemsCount: recordResult.rows[0].line_items.length,
      databaseRowsForInvoiceId: duplicateResult.rows[0].count
    }, null, 2));
  } finally {
    if (redisClient.isOpen) await redisClient.quit();
    await pgPool.end();
  }
};

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
