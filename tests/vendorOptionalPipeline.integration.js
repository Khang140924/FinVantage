import 'dotenv/config';
import assert from 'node:assert/strict';

process.env.USE_MOCK_AUTH = 'true';
process.env.USE_MOCK_AI = 'true';

const [
  { handler: analyzeInvoice },
  { getInvoiceStatus },
  db,
  { OCR_VENDOR_WARNING, UNKNOWN_VENDOR_NAME }
] = await Promise.all([
  import('../src/handlers/analysisHandler.js'),
  import('../src/handlers/invoiceHandler.js'),
  import('../src/services/db.service.js'),
  import('../src/utils/textractExpense.js')
]);

const authorization = 'Bearer finvantage-mock-id-token';
const userId = 'mock-user';
const invoiceId = 'invoice-mock-user-vendor-optional-test';
const cacheKey = `ocr:${invoiceId}`;
const foreignInvoiceId = 'invoice-other-user-status-test';
const foreignCacheKey = `ocr:${foreignInvoiceId}`;

const parseResponse = (result) => ({
  statusCode: result.statusCode,
  body: JSON.parse(result.body || '{}')
});

try {
  await db.pgPool.query('DELETE FROM notifications WHERE user_id = $1 AND reference_id = $2', [userId, invoiceId]);
  await db.pgPool.query('DELETE FROM invoices WHERE user_id = $1 AND id = $2', [userId, invoiceId]);
  const before = await db.getDashboardSummary(userId);

  await db.cacheInvoiceData(cacheKey, {
    invoiceId,
    userId,
    fileKey: 'uploads/mock-user/vendor-optional.jpg',
    sourceFileKey: 'uploads/mock-user/vendor-optional.jpg',
    source_file_key: 'uploads/mock-user/vendor-optional.jpg',
    expenseDocuments: [{ SummaryFields: [{ Type: { Text: 'TOTAL' }, ValueDetection: { Text: '103.000' } }] }],
    rawText: 'Ca phe sua 103.000\nTOTAL 103.000',
    raw_text: 'Ca phe sua 103.000\nTOTAL 103.000',
    totalAmount: 103000,
    total_amount: 103000,
    storeName: UNKNOWN_VENDOR_NAME,
    store_name: UNKNOWN_VENDOR_NAME,
    transactionDate: '2026-07-17',
    transaction_date: '2026-07-17',
    lineItems: [{ item: 'Ca phe sua', price: 103000 }],
    line_items: [{ item: 'Ca phe sua', price: 103000 }],
    warning: { ...OCR_VENDOR_WARNING },
    status: 'OCR_PROCESSING',
    progress: 50,
    uploadConfirmed: true
  });

  const readyStatus = parseResponse(await getInvoiceStatus({
    pathParameters: { id: invoiceId },
    headers: { Authorization: authorization }
  }));
  assert.equal(readyStatus.statusCode, 200);
  assert.equal(readyStatus.body.status, 'OCR_PROCESSING');
  assert.equal(readyStatus.body.progress, 50);
  assert.deepEqual(readyStatus.body.warning, OCR_VENDOR_WARNING);

  const first = parseResponse(await analyzeInvoice({
    pathParameters: { id: invoiceId },
    headers: { Authorization: authorization },
    body: JSON.stringify({ cacheKey })
  }));
  assert.equal(first.statusCode, 200, first.body.message);
  assert.equal(first.body.status, 'ANALYZED');
  assert.equal(first.body.invoice.store_name, UNKNOWN_VENDOR_NAME);
  assert.deepEqual(first.body.warning, OCR_VENDOR_WARNING);

  const analyzedStatus = parseResponse(await getInvoiceStatus({
    pathParameters: { id: invoiceId },
    headers: { Authorization: authorization }
  }));
  assert.equal(analyzedStatus.statusCode, 200);
  assert.equal(analyzedStatus.body.status, 'ANALYZED');
  assert.equal(analyzedStatus.body.progress, 100);
  assert.deepEqual(analyzedStatus.body.warning, OCR_VENDOR_WARNING);

  const afterFirst = await db.getDashboardSummary(userId);
  assert.equal(afterFirst.total_invoices, before.total_invoices + 1);
  assert.equal(Number(afterFirst.total_amount), Number(before.total_amount) + 103000);

  const retry = parseResponse(await analyzeInvoice({
    pathParameters: { id: invoiceId },
    headers: { Authorization: authorization },
    body: JSON.stringify({ cacheKey })
  }));
  assert.equal(retry.statusCode, 200, retry.body.message);

  const rows = await db.pgPool.query(
    'SELECT COUNT(*)::int AS count FROM invoices WHERE user_id = $1 AND id = $2',
    [userId, invoiceId]
  );
  assert.equal(rows.rows[0].count, 1);
  const afterRetry = await db.getDashboardSummary(userId);
  assert.equal(afterRetry.total_invoices, afterFirst.total_invoices);
  assert.equal(Number(afterRetry.total_amount), Number(afterFirst.total_amount));

  await db.cacheInvoiceData(foreignCacheKey, {
    invoiceId: foreignInvoiceId,
    userId: 'other-user',
    status: 'OCR_PROCESSING',
    progress: 50
  });
  const foreignStatus = parseResponse(await getInvoiceStatus({
    pathParameters: { id: foreignInvoiceId },
    headers: { Authorization: authorization }
  }));
  assert.equal(foreignStatus.statusCode, 404);

  console.log(JSON.stringify({
    ok: true,
    storeName: first.body.invoice.store_name,
    warning: first.body.warning,
    status: analyzedStatus.body.status,
    progress: analyzedStatus.body.progress,
    databaseRowsForInvoiceId: rows.rows[0].count,
    dashboardCountedOnce: true,
    foreignStatusHidden: true
  }, null, 2));
} finally {
  await db.pgPool.query('DELETE FROM notifications WHERE user_id = $1 AND reference_id = $2', [userId, invoiceId]);
  await db.pgPool.query('DELETE FROM invoices WHERE user_id = $1 AND id = $2', [userId, invoiceId]);
  if (db.redisClient.isOpen) {
    await db.redisClient.del(cacheKey);
    await db.redisClient.del(foreignCacheKey);
    await db.redisClient.quit();
  }
  await db.pgPool.end();
}
