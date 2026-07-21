export const MAX_INVOICE_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_FILE_TYPES = Object.freeze({
  '.jpg': new Set(['image/jpeg', 'image/jpg']),
  '.jpeg': new Set(['image/jpeg', 'image/jpg']),
  '.png': new Set(['image/png']),
  '.heic': new Set(['image/heic']),
  '.pdf': new Set(['application/pdf'])
});

export const validateInvoiceUploadRequest = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, message: 'Request body phải là JSON object hợp lệ.' };
  }

  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  const contentType = typeof body.contentType === 'string' ? body.contentType.trim().toLowerCase() : '';
  if (!fileName || !contentType) {
    return { valid: false, message: 'Yêu cầu thiếu tham số bắt buộc: fileName hoặc contentType.' };
  }
  if (fileName.length > 255 || /[\\/\0]/.test(fileName)) {
    return { valid: false, message: 'Tên file hóa đơn không hợp lệ.' };
  }

  const extensionMatch = fileName.toLowerCase().match(/(\.[^.]+)$/);
  const extension = extensionMatch?.[1] || '';
  if (!ALLOWED_FILE_TYPES[extension] || !ALLOWED_FILE_TYPES[extension].has(contentType)) {
    return { valid: false, message: 'Chỉ chấp nhận hóa đơn PNG, JPG, JPEG, HEIC hoặc PDF đúng định dạng.' };
  }

  let fileSize = null;
  if (body.fileSize !== undefined && body.fileSize !== null) {
    fileSize = Number(body.fileSize);
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_INVOICE_FILE_SIZE) {
      return { valid: false, message: 'File hóa đơn phải có dung lượng lớn hơn 0 và không quá 10 MB.' };
    }
  }

  return { valid: true, value: { fileName, contentType, fileSize } };
};
