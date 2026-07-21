import { buildInvoiceUploadIdentity, signInvoiceUploadUrl } from '../services/s3.service.js';
import { cacheInvoiceData, getInvoiceById, getInvoiceFromCache } from '../services/db.service.js';
import { logger } from '../utils/logger.js';
import { requireAuth } from '../utils/cognitoAuth.js';
import { createImportHandler } from './createImportHandler.js';

export { createImportHandler } from './createImportHandler.js';

export const handler = createImportHandler({
  authenticate: requireAuth,
  buildUploadIdentity: buildInvoiceUploadIdentity,
  signUploadUrl: signInvoiceUploadUrl,
  findInvoice: getInvoiceById,
  getCachedInvoice: getInvoiceFromCache,
  cacheUpload: cacheInvoiceData,
  log: logger
});
