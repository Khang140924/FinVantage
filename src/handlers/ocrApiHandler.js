import { extractInvoiceData } from '../services/textract.service.js';
import { cacheInvoiceData } from '../services/db.service.js';
import * as response from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { buildOcrCacheKey } from '../utils/invoice.js';
import { normalizeOcrCachePayload } from '../utils/textractExpense.js';
import { requireAuth } from '../utils/cognitoAuth.js';

const parseBody = (event) => {
  if (!event?.body) {
    return {};
  }

  if (typeof event.body === 'object') {
    return event.body;
  }

  const bodyText = String(event.body).trim();
  return bodyText ? JSON.parse(bodyText) : {};
};

const getBucketName = () => process.env.S3_RAW_BUCKET_NAME || process.env.S3_BUCKET_NAME || '';

const isAccessDeniedError = (error) => (
  error?.name === 'AccessDeniedException' ||
  error?.Code === 'AccessDenied' ||
  error?.code === 'AccessDenied' ||
  /access denied/i.test(error?.message || '')
);

const isMissingS3ObjectError = (error) => (
  error?.name === 'InvalidS3ObjectException' ||
  error?.name === 'NoSuchKey' ||
  error?.Code === 'NoSuchKey' ||
  error?.$metadata?.httpStatusCode === 404 ||
  /unable to get object metadata|not found|no such key/i.test(error?.message || '')
);

const isRedisConnectionError = (error) => (
  error?.code === 'ECONNREFUSED' ||
  error?.cause?.code === 'ECONNREFUSED' ||
  /redis|econnrefused/i.test(error?.message || '')
);

const isAwsCredentialOrRegionError = (error) => (
  error?.name === 'CredentialsProviderError' ||
  error?.name === 'UnrecognizedClientException' ||
  error?.name === 'InvalidSignatureException' ||
  error?.name === 'AuthorizationHeaderMalformed' ||
  error?.Code === 'SignatureDoesNotMatch' ||
  /credential|region|signature|security token|missing credentials/i.test(error?.message || '')
);

const buildOcrErrorResponse = (error) => {
  if (isAccessDeniedError(error)) {
    return response.sendResponse(403, {
      error: 'Textract AccessDenied',
      message: 'Textract AccessDenied: AWS credentials do not have permission to call AnalyzeExpense or read the S3 object.'
    });
  }

  if (isMissingS3ObjectError(error)) {
    return response.notFound('File khong ton tai trong S3 hoac Textract khong doc duoc object voi fileKey da cung cap.');
  }

  if (isRedisConnectionError(error)) {
    return response.sendResponse(503, {
      error: 'Redis unavailable',
      message: 'Redis chua chay. Hay mo Docker Desktop va chay docker start finvantage-redis.'
    });
  }

  if (isAwsCredentialOrRegionError(error)) {
    return response.sendResponse(502, {
      error: 'AWS credentials or region error',
      message: 'OCR thuc te can AWS S3/Textract va credentials hop le. Hay kiem tra AWS_REGION, AWS_REGION_NAME va credentials local.'
    });
  }

  return response.serverError(`Khong the chay OCR Textract: ${error.message || 'Unknown error'}`);
};

export const handler = async (event = {}) => {
  const invoiceId = event.pathParameters?.id;

  const auth = await requireAuth(event);
  if (auth.error) return auth.error;

  if (!invoiceId) {
    logger.warn('OCR API request is missing invoiceId path parameter', {
      pathParameters: event.pathParameters
    });
    return response.badRequest('Thieu invoiceId trong pathParameters.id.');
  }

  let body;
  try {
    body = parseBody(event);
  } catch (parseError) {
    logger.error('Failed to parse OCR API request body JSON', parseError, { invoiceId });
    return response.badRequest('Request body phai la JSON hop le.');
  }

  const fileKey = body.fileKey || body.sourceFileKey || body.source_file_key;
  const cacheKey = body.cacheKey || buildOcrCacheKey(invoiceId);
  const bucketName = getBucketName();

  if (!fileKey) {
    return response.badRequest('Thieu fileKey. Hay truyen fileKey tu POST /invoices/import vao OCR API.');
  }

  if (!bucketName) {
    return response.badRequest('Thieu S3 bucket. Hay cau hinh S3_RAW_BUCKET_NAME hoac S3_BUCKET_NAME trong backend .env.');
  }

  try {
    logger.info('Starting OCR API Textract flow', {
      invoiceId,
      cacheKey,
      fileKey,
      bucketConfigured: Boolean(bucketName)
    });

    const expenseDocuments = await extractInvoiceData(bucketName, fileKey);
    const cachedInvoice = normalizeOcrCachePayload({
      invoiceId,
      fileKey,
      expenseDocuments
    });

    await cacheInvoiceData(cacheKey, cachedInvoice, 3600);

    logger.info('OCR API Textract flow completed', {
      invoiceId,
      cacheKey,
      fileKey,
      documentsCount: expenseDocuments.length,
      rawTextLength: cachedInvoice.rawText.length
    });

    return response.success({
      message: 'OCR Textract thanh cong va da luu rawText vao Redis cache.',
      invoiceId,
      cacheKey,
      fileKey,
      rawTextPreview: cachedInvoice.rawText.slice(0, 500),
      rawTextLength: cachedInvoice.rawText.length,
      source: 'aws-textract'
    });
  } catch (error) {
    logger.error('OCR API Textract flow failed', error, { invoiceId, cacheKey, fileKey });
    return buildOcrErrorResponse(error);
  }
};
