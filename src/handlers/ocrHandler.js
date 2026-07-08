import { extractInvoiceData } from '../services/textract.service.js';
import { cacheInvoiceData } from '../services/db.service.js';
import { logger } from '../utils/logger.js';

const sanitizeInvoiceId = (objectKey) => {
  const withoutUploadsPrefix = objectKey.replace(/^uploads\/+/i, '');
  const withoutExtension = withoutUploadsPrefix.replace(/\.[^/.]+$/, '');
  const sanitized = withoutExtension
    .replace(/\\/g, '/')
    .replace(/\/+/g, '-')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

  return sanitized || `invoice-${Date.now()}`;
};

const addText = (parts, value) => {
  if (typeof value !== 'string') {
    return;
  }

  const text = value.replace(/\s+/g, ' ').trim();
  if (text) {
    parts.push(text);
  }
};

const addExpenseFieldText = (parts, field) => {
  const label = field?.LabelDetection?.Text || field?.Type?.Text;
  const value = field?.ValueDetection?.Text;

  if (label && value) {
    addText(parts, `${label}: ${value}`);
    return;
  }

  addText(parts, label);
  addText(parts, value);
};

export const extractRawTextFromExpenseDocuments = (expenseDocuments = []) => {
  const parts = [];
  const documents = Array.isArray(expenseDocuments) ? expenseDocuments : [];

  for (const document of documents) {
    for (const field of document?.SummaryFields || []) {
      addExpenseFieldText(parts, field);
    }

    for (const group of document?.LineItemGroups || []) {
      for (const lineItem of group?.LineItems || []) {
        for (const field of lineItem?.LineItemExpenseFields || []) {
          addExpenseFieldText(parts, field);
        }
      }
    }
  }

  return [...new Set(parts)].join('\n');
};

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
      const primaryCacheKey = `ocr:${invoiceId}`;
      const legacyCacheKey = `cache:invoice:${objectKey}`;
      const rawText = extractRawTextFromExpenseDocuments(expenseDocuments);
      const createdAt = new Date().toISOString();
      const cachedInvoice = {
        invoiceId,
        rawText,
        raw_text: rawText,
        sourceFileKey: objectKey,
        source_file_key: objectKey,
        expenseDocuments,
        createdAt
      };

      logger.info('Textract OCR extraction completed', {
        objectKey,
        invoiceId,
        primaryCacheKey,
        legacyCacheKey,
        documentsCount: expenseDocuments.length,
        rawTextLength: rawText.length
      });

      if (!rawText) {
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
