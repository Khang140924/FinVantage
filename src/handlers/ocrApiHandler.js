import { extractInvoiceData } from '../services/textract.service.js';
import { cacheInvoiceData, createNotification } from '../services/db.service.js';
import * as response from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { buildOcrCacheKey } from '../utils/invoice.js';
import {
  assertValidOcrPayload,
  normalizeOcrCachePayload,
  OcrResultError
} from '../utils/textractExpense.js';
import { requireAuth } from '../utils/cognitoAuth.js';

const parseBody = (event) => {
  if (!event?.body) return {};
  if (typeof event.body === 'object') return event.body;
  const bodyText = String(event.body).trim();
  return bodyText ? JSON.parse(bodyText) : {};
};

const getBucketName = () => process.env.S3_RAW_BUCKET_NAME || process.env.S3_BUCKET_NAME || '';

const classifyOcrError = (error) => {
  if (error instanceof OcrResultError) {
    return { statusCode: 422, code: error.code, message: error.message };
  }
  if (
    error?.name === 'AccessDeniedException' || error?.Code === 'AccessDenied' ||
    error?.code === 'AccessDenied' || /access denied/i.test(error?.message || '')
  ) {
    return {
      statusCode: 403,
      code: 'OCR_ACCESS_DENIED',
      message: 'Textract không có quyền AnalyzeExpense hoặc không đọc được file trong S3.'
    };
  }
  if (
    error?.name === 'InvalidS3ObjectException' || error?.name === 'NoSuchKey' ||
    error?.Code === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404 ||
    /unable to get object metadata|not found|no such key/i.test(error?.message || '')
  ) {
    return { statusCode: 404, code: 'OCR_S3_OBJECT_NOT_FOUND', message: 'Không tìm thấy file hóa đơn trong S3.' };
  }
  if (
    error?.code === 'ECONNREFUSED' || error?.cause?.code === 'ECONNREFUSED' ||
    /redis|econnrefused/i.test(error?.message || '')
  ) {
    return { statusCode: 503, code: 'OCR_REDIS_UNAVAILABLE', message: 'Redis chưa sẵn sàng để lưu trạng thái OCR.' };
  }
  if (
    error?.name === 'CredentialsProviderError' || error?.name === 'UnrecognizedClientException' ||
    error?.name === 'InvalidSignatureException' || error?.name === 'AuthorizationHeaderMalformed' ||
    error?.Code === 'SignatureDoesNotMatch' ||
    /credential|region|signature|security token|missing credentials/i.test(error?.message || '')
  ) {
    return {
      statusCode: 502,
      code: 'OCR_AWS_CONFIGURATION_ERROR',
      message: 'Không thể gọi S3/Textract. Hãy kiểm tra region và AWS credentials của backend.'
    };
  }
  return {
    statusCode: 500,
    code: 'OCR_PROCESSING_FAILED',
    message: `Không thể xử lý OCR: ${error?.message || 'Unknown error'}`
  };
};

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
    logger.error('Invoice OCR failed', error, {
      invoiceId,
      fileKey,
      status: 'OCR_FAILED',
      failureCode: details.code
    });

    try {
      await cacheStatus('OCR_FAILED', { progress: 50, errorCode: details.code, errorMessage: details.message, uploadConfirmed: true });
    } catch (cacheError) {
      logger.warn('Could not cache OCR_FAILED status', { invoiceId, fileKey, error: cacheError.message });
    }
    await notifyFailure(details);

    return response.sendResponse(details.statusCode, {
      error: 'Invoice OCR failed',
      code: details.code,
      message: details.message,
      invoiceId,
      status: 'OCR_FAILED'
    });
  }
};
