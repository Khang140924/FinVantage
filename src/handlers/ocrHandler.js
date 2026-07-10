import { extractInvoiceData } from '../services/textract.service.js';
import { cacheInvoiceData } from '../services/db.service.js';
import { logger } from '../utils/logger.js';
import { buildOcrCacheKey, sanitizeInvoiceId } from '../utils/invoice.js';
import { normalizeOcrCachePayload } from '../utils/textractExpense.js';

export const handler = async (event) => {
  try {
    logger.info('Received OCR trigger from S3', { recordsCount: event.Records?.length || 0 });

    if (!event.Records || event.Records.length === 0) {
      logger.warn('No S3 event records found in OCR request.');
      return;
    }

    for (const record of event.Records) {
      const bucketName = record.s3.bucket.name;
      const objectKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

      logger.info('Processing S3 OCR record', { bucketName, objectKey });

      if (!objectKey.startsWith('uploads/')) {
        logger.info('Skipping file outside uploads prefix', { objectKey });
        continue;
      }

      logger.info('Starting Textract invoice OCR extraction', { bucketName, objectKey });
      const expenseDocuments = await extractInvoiceData(bucketName, objectKey);

      const invoiceId = sanitizeInvoiceId(objectKey);
      const primaryCacheKey = buildOcrCacheKey(invoiceId);
      const legacyCacheKey = `cache:invoice:${objectKey}`;
      const cachedInvoice = normalizeOcrCachePayload({
        invoiceId,
        fileKey: objectKey,
        expenseDocuments
      });

      logger.info('Textract OCR extraction completed', {
        objectKey,
        invoiceId,
        primaryCacheKey,
        legacyCacheKey,
        documentsCount: expenseDocuments.length,
        rawTextLength: cachedInvoice.rawText.length
      });

      if (!cachedInvoice.rawText) {
        logger.warn('Textract OCR result did not contain raw text', {
          objectKey,
          invoiceId,
          primaryCacheKey,
          legacyCacheKey
        });
      }

      await cacheInvoiceData(primaryCacheKey, cachedInvoice);
      await cacheInvoiceData(legacyCacheKey, cachedInvoice);

      logger.info('OCR invoice data cached in Redis', {
        objectKey,
        invoiceId,
        primaryCacheKey,
        legacyCacheKey
      });
    }

    logger.info('Finished processing OCR S3 event.');
  } catch (error) {
    logger.error('Failed to process OCR S3 event', error);
    throw error;
  }
};
