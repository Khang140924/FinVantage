import { extractInvoiceData } from '../services/textract.service.js';
import { cacheInvoiceData, createNotification } from '../services/db.service.js';
import { logger } from '../utils/logger.js';
import { buildOcrCacheKey, sanitizeInvoiceId } from '../utils/invoice.js';
import { assertValidOcrPayload, normalizeOcrCachePayload } from '../utils/textractExpense.js';

const cacheStatus = (cacheKey, invoiceId, fileKey, userId, status, extra = {}) => cacheInvoiceData(cacheKey, {
  invoiceId,
  userId,
  fileKey,
  sourceFileKey: fileKey,
  source_file_key: fileKey,
  status,
  updatedAt: new Date().toISOString(),
  ...extra
});

const getUserIdFromFileKey = (fileKey) => fileKey.match(/^uploads\/([^/]+)\//)?.[1] || null;

export const handler = async (event = {}) => {
  const records = event.Records || [];
  logger.info('Received OCR trigger from S3', { recordsCount: records.length });
  if (!records.length) return;

  for (const record of records) {
    const bucketName = record.s3.bucket.name;
    const fileKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    if (!fileKey.startsWith('uploads/')) {
      logger.info('Skipping S3 object outside uploads prefix', { fileKey });
      continue;
    }

    const invoiceId = sanitizeInvoiceId(fileKey);
    const userId = getUserIdFromFileKey(fileKey);
    const cacheKey = buildOcrCacheKey(invoiceId);
    try {
      await cacheStatus(cacheKey, invoiceId, fileKey, userId, 'UPLOADED', { progress: 25, uploadConfirmed: true });
      await cacheStatus(cacheKey, invoiceId, fileKey, userId, 'OCR_PROCESSING', { progress: 35, uploadConfirmed: true });
      logger.info('Starting S3-triggered invoice OCR', { invoiceId, fileKey, status: 'OCR_PROCESSING' });

      const expenseDocuments = await extractInvoiceData(bucketName, fileKey);
      const cachedInvoice = normalizeOcrCachePayload({
        invoiceId,
        fileKey,
        userId,
        expenseDocuments,
        status: 'OCR_PROCESSING'
      });

      logger.info('S3-triggered Textract result normalized', {
        invoiceId,
        fileKey,
        expenseDocumentsCount: expenseDocuments.length,
        rawTextLength: cachedInvoice.rawText.length,
        vendorFound: !cachedInvoice.warning,
        totalFound: Number.isFinite(cachedInvoice.totalAmount),
        lineItemsCount: cachedInvoice.lineItems.length
      });

      assertValidOcrPayload(cachedInvoice);
      await cacheInvoiceData(cacheKey, cachedInvoice);
      logger.info('OCR data cached for analysis', { invoiceId, fileKey, cacheKey });
    } catch (error) {
      const errorCode = error.code || 'OCR_PROCESSING_FAILED';
      try {
        await cacheStatus(cacheKey, invoiceId, fileKey, userId, 'OCR_FAILED', {
          progress: 50,
          errorCode,
          errorMessage: error.message
        });
      } catch (cacheError) {
        logger.warn('Could not cache OCR_FAILED status from S3 trigger', {
          invoiceId,
          fileKey,
          error: cacheError.message
        });
      }
      logger.error('S3-triggered invoice OCR failed', error, {
        invoiceId,
        fileKey,
        status: 'OCR_FAILED',
        failureCode: errorCode
      });
      if (userId) {
        try {
          await createNotification({
            userId,
            type: 'INVOICE_FAILED',
            title: 'Xử lý hóa đơn thất bại',
            message: error.message,
            referenceId: invoiceId,
            dedupeKey: `invoice:${invoiceId}:failed:ocr:${errorCode}`
          });
        } catch (notificationError) {
          logger.warn('Could not persist S3-triggered OCR failure notification', {
            invoiceId,
            fileKey,
            error: notificationError.message
          });
        }
      }
      throw error;
    }
  }
};
