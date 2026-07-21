import { extractInvoiceData } from '../services/textract.service.js';
import { cacheInvoiceData, createNotification } from '../services/db.service.js';
import * as response from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { buildOcrCacheKey } from '../utils/invoice.js';
import {
  assertValidOcrPayload,
  normalizeOcrCachePayload
} from '../utils/textractExpense.js';
import { requireAuth } from '../utils/cognitoAuth.js';
import { sanitizedAwsLogError } from '../utils/awsError.js';
import { classifyOcrError } from '../utils/ocrError.js';

const parseBody = (event) => {
  if (!event?.body) return {};
  if (typeof event.body === 'object') return event.body;
  const bodyText = String(event.body).trim();
  return bodyText ? JSON.parse(bodyText) : {};
};

const getBucketName = () => process.env.S3_RAW_BUCKET_NAME || process.env.S3_BUCKET_NAME || '';

const statusPayload = (invoiceId, fileKey, userId, status, extra = {}) => ({
  invoiceId,
  userId,
  fileKey,
  sourceFileKey: fileKey,
  source_file_key: fileKey,
  status,
  updatedAt: new Date().toISOString(),
  ...extra
});

export const handler = async (event = {}) => {
  const invoiceId = event.pathParameters?.id;
  const auth = await requireAuth(event);
  if (auth.error) return auth.error;
  const userId = auth.user.sub;

  if (!invoiceId) return response.badRequest('Thiếu invoiceId trong pathParameters.id.');

  let body;
  try {
    body = parseBody(event);
  } catch (parseError) {
    logger.error('Failed to parse OCR request JSON', parseError, { invoiceId });
    return response.badRequest('Request body phải là JSON hợp lệ.');
  }

  const fileKey = body.fileKey || body.sourceFileKey || body.source_file_key;
  const cacheKey = body.cacheKey || buildOcrCacheKey(invoiceId);
  const bucketName = getBucketName();
  if (!fileKey) return response.badRequest('Thiếu fileKey từ POST /invoices/import.');
  if (!bucketName) return response.badRequest('Backend chưa cấu hình S3 bucket cho hóa đơn.');
  const safeUserId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
  if (!fileKey.startsWith(`uploads/${safeUserId}/`)) {
    return response.sendResponse(403, {
      error: 'Invoice file ownership mismatch',
      code: 'OCR_FILE_OWNERSHIP_MISMATCH',
      message: 'Người dùng chỉ có thể OCR file hóa đơn do chính tài khoản này tải lên.'
    });
  }

  const cacheStatus = async (status, extra = {}) => {
    await cacheInvoiceData(cacheKey, statusPayload(invoiceId, fileKey, userId, status, extra), 3600);
  };

  const notifyFailure = async ({ code, message }) => {
    try {
      await createNotification({
        userId,
        type: 'INVOICE_FAILED',
        title: 'Xử lý hóa đơn thất bại',
        message,
        referenceId: invoiceId,
        dedupeKey: `invoice:${invoiceId}:failed:ocr:${code}`
      });
    } catch (notificationError) {
      logger.warn('Could not persist OCR failure notification', {
        invoiceId,
        fileKey,
        error: notificationError.message
      });
    }
  };

  try {
    logger.info('Invoice upload confirmed; starting OCR', { invoiceId, fileKey, status: 'UPLOADED' });
    await cacheStatus('UPLOADED', { progress: 25, uploadConfirmed: true });
    await cacheStatus('OCR_PROCESSING', { progress: 35, uploadConfirmed: true });

    const expenseDocuments = await extractInvoiceData(bucketName, fileKey);
    const cachedInvoice = normalizeOcrCachePayload({
      invoiceId,
      fileKey,
      userId,
      expenseDocuments,
      status: 'OCR_PROCESSING'
    });

    logger.info('Textract result normalized', {
      invoiceId,
      fileKey,
      expenseDocumentsCount: expenseDocuments.length,
      rawTextLength: cachedInvoice.rawText.length,
      vendorFound: !cachedInvoice.warning,
      totalFound: Number.isFinite(cachedInvoice.totalAmount),
      lineItemsCount: cachedInvoice.lineItems.length
    });

    assertValidOcrPayload(cachedInvoice);
    await cacheInvoiceData(cacheKey, cachedInvoice, 3600);

    return response.success({
      message: 'Textract đã đọc hóa đơn thành công.',
      invoiceId,
      cacheKey,
      fileKey,
      status: cachedInvoice.status,
      progress: 50,
      warning: cachedInvoice.warning,
      vendor: cachedInvoice.storeName,
      totalAmount: cachedInvoice.totalAmount,
      transactionDate: cachedInvoice.transactionDate,
      lineItems: cachedInvoice.lineItems,
      rawTextLength: cachedInvoice.rawText.length,
      source: 'aws-textract'
    });
  } catch (error) {
    const details = classifyOcrError(error);
    logger.error('Invoice OCR failed', sanitizedAwsLogError(error, details.code?.startsWith('AWS_') ? details : null), {
      invoiceId,
      fileKey,
      status: 'OCR_FAILED',
      failureCode: details.code
    });

    try {
      await cacheStatus('OCR_FAILED', {
        progress: details.code?.startsWith('AWS_') ? 25 : 50,
        errorCode: details.code,
        errorMessage: details.message,
        uploadConfirmed: true
      });
    } catch (cacheError) {
      logger.warn('Could not cache OCR_FAILED status', { invoiceId, fileKey, error: cacheError.message });
    }
    await notifyFailure(details);

    return response.sendResponse(details.statusCode, {
      error: details.error || 'Invoice OCR failed',
      code: details.code,
      message: details.message,
      invoiceId,
      status: 'OCR_FAILED',
      retryable: details.retryable ?? false
    });
  }
};
