export const sanitizeInvoiceId = (objectKey) => {
  const normalizedKey = String(objectKey || '');
  const stableUploadMatch = normalizedKey.match(/^uploads\/([a-zA-Z0-9_-]+)\/([a-f0-9]{64})_/i);
  if (stableUploadMatch) {
    return `invoice-${stableUploadMatch[1].slice(0, 100)}-${stableUploadMatch[2].toLowerCase()}`;
  }
  const withoutUploadsPrefix = normalizedKey.replace(/^uploads\/+/i, '');
  const withoutExtension = withoutUploadsPrefix.replace(/\.[^/.]+$/, '');
  const sanitized = withoutExtension
    .replace(/\\/g, '/')
    .replace(/\/+/g, '-')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

  return sanitized || `invoice-${Date.now()}`;
};

export const buildOcrCacheKey = (invoiceId) => `ocr:${invoiceId}`;

export const getInvoiceUploadIdentity = (fileKey) => {
  const invoiceId = sanitizeInvoiceId(fileKey);

  return {
    invoiceId,
    cacheKey: buildOcrCacheKey(invoiceId)
  };
};
