import 'dotenv/config';
import assert from 'node:assert/strict';

process.env.USE_MOCK_AUTH = 'true';

const [{ handler: analyzeInvoice }, db] = await Promise.all([
  import('../src/handlers/analysisHandler.js'),
  import('../src/services/db.service.js')
]);

const invoiceId = 'test-empty-ocr-no-save';
const cacheKey = `ocr:${invoiceId}`;
const missingTotalInvoiceId = 'test-missing-total-no-save';
const missingTotalCacheKey = `ocr:${missingTotalInvoiceId}`;
const userId = 'mock-user';

try {
  await db.pgPool.query('DELETE FROM notifications WHERE user_id = $1 AND reference_id = $2', [userId, invoiceId]);
  await db.pgPool.query('DELETE FROM invoices WHERE user_id = $1 AND id = $2', [userId, invoiceId]);
  const before = await db.getDashboardSummary(userId);

  await db.cacheInvoiceData(cacheKey, {
    invoiceId,
    userId,
    fileKey: 'uploads/mock-user/empty.jpg',
    sourceFileKey: 'uploads/mock-user/empty.jpg',
    expenseDocuments: [],
    rawText: '',
    raw_text: '',
    totalAmount: null,
    storeName: null,
    status: 'OCR_PROCESSING'
  });

  const result = await analyzeInvoice({
    pathParameters: { id: invoiceId },
    headers: { Authorization: 'Bearer finvantage-mock-id-token' },
    body: JSON.stringify({ cacheKey })
  });
  const body = JSON.parse(result.body);
  assert.equal(result.statusCode, 422);
  assert.equal(body.code, 'OCR_EMPTY_RESULT');
  assert.equal(body.status, 'OCR_FAILED');

  const invoiceCount = await db.pgPool.query(
    'SELECT COUNT(*)::int AS count FROM invoices WHERE user_id = $1 AND id = $2',
    [userId, invoiceId]
  );
  assert.equal(invoiceCount.rows[0].count, 0);

  await db.pgPool.query('DELETE FROM notifications WHERE user_id = $1 AND reference_id = $2', [userId, missingTotalInvoiceId]);
  await db.pgPool.query('DELETE FROM invoices WHERE user_id = $1 AND id = $2', [userId, missingTotalInvoiceId]);
  await db.cacheInvoiceData(missingTotalCacheKey, {
    invoiceId: missingTotalInvoiceId,
    userId,
    fileKey: 'uploads/mock-user/missing-total.jpg',
    sourceFileKey: 'uploads/mock-user/missing-total.jpg',
    expenseDocuments: [{
      SummaryFields: [{ Type: { Text: 'AMOUNT_PAID' }, LabelDetection: { Text: 'CASH' }, ValueDetection: { Text: '500.000' } }]
    }],
    rawText: 'CASH 500.000',
    raw_text: 'CASH 500.000',
    totalAmount: null,
    storeName: 'Không xác định',
    status: 'OCR_PROCESSING',
    progress: 50
  });
  const missingTotalResult = await analyzeInvoice({
    pathParameters: { id: missingTotalInvoiceId },
    headers: { Authorization: 'Bearer finvantage-mock-id-token' },
    body: JSON.stringify({ cacheKey: missingTotalCacheKey })
  });
  const missingTotalBody = JSON.parse(missingTotalResult.body);
  assert.equal(missingTotalResult.statusCode, 422);
  assert.equal(missingTotalBody.code, 'OCR_TOTAL_NOT_FOUND');
  assert.equal(missingTotalBody.status, 'OCR_FAILED');
  const missingTotalCount = await db.pgPool.query(
    'SELECT COUNT(*)::int AS count FROM invoices WHERE user_id = $1 AND id = $2',
    [userId, missingTotalInvoiceId]
  );
  assert.equal(missingTotalCount.rows[0].count, 0);

  const notification = await db.pgPool.query(
    'SELECT type, message FROM notifications WHERE user_id = $1 AND reference_id = $2 ORDER BY created_at DESC LIMIT 1',
    [userId, invoiceId]
  );
  assert.equal(notification.rows[0]?.type, 'INVOICE_FAILED');
  assert.match(notification.rows[0]?.message || '', /ExpenseDocuments|Textract/i);

  const after = await db.getDashboardSummary(userId);
  assert.equal(after.total_invoices, before.total_invoices);
  assert.equal(after.total_amount, before.total_amount);
  console.log(JSON.stringify({
    ok: true,
    errorCode: body.code,
    missingTotalErrorCode: missingTotalBody.code,
    invoiceRowsCreated: invoiceCount.rows[0].count,
    notificationType: notification.rows[0].type,
    dashboardUnchanged: true
  }, null, 2));
} finally {
  await db.pgPool.query('DELETE FROM notifications WHERE user_id = $1 AND reference_id = $2', [userId, invoiceId]);
  await db.pgPool.query('DELETE FROM notifications WHERE user_id = $1 AND reference_id = $2', [userId, missingTotalInvoiceId]);
  await db.pgPool.query('DELETE FROM invoices WHERE user_id = $1 AND id = $2', [userId, missingTotalInvoiceId]);
  if (db.redisClient.isOpen) {
    await db.redisClient.del(cacheKey);
    await db.redisClient.del(missingTotalCacheKey);
    await db.redisClient.quit();
  }
  await db.pgPool.end();
}
