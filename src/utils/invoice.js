export const sanitizeInvoiceId = (objectKey) => {
  const normalizedKey = String(objectKey || '');
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
