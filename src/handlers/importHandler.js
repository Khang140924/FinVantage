import { generateUploadUrl } from '../services/s3.service.js';
import { cacheInvoiceData, getInvoiceById, getInvoiceFromCache } from '../services/db.service.js';
import * as response from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { requireAuth } from '../utils/cognitoAuth.js';

// Hàm xử lý Lambda (Lambda handler) để nhập hóa đơn (import invoice) và sinh presigned URL
export const handler = async (event) => {
  const auth = await requireAuth(event);
  if (auth.error) return auth.error;

  try {
    logger.info('Nhận yêu cầu sinh presigned URL để nhập hóa đơn', { event: { path: event.path, httpMethod: event.httpMethod } });

    // Phân tích cú pháp JSON an toàn từ request body (thân yêu cầu)
    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (parseError) {
      logger.error('Lỗi khi phân tích cú pháp request body JSON', parseError);
      return response.badRequest('Cấu trúc JSON trong request body không hợp lệ.');
    }

    // Kiểm tra tính đầy đủ của dữ liệu đầu vào
    if (!body || !body.fileName || !body.contentType) {
      logger.warn('Yêu cầu thiếu tham số bắt buộc', { body });
      return response.badRequest('Yêu cầu thiếu tham số bắt buộc: fileName hoặc contentType.');
    }

    const { fileName, contentType, contentSha256 } = body;

    if (contentSha256 && !/^[a-f0-9]{64}$/i.test(contentSha256)) {
      return response.badRequest('contentSha256 phải là chuỗi SHA-256 gồm 64 ký tự hexadecimal.');
    }

    // Sinh ra presigned URL
    logger.info(`Đang sinh presigned URL cho tệp: ${fileName}, kiểu: ${contentType}`);
    const uploadData = await generateUploadUrl(fileName, contentType, {
      userId: auth.user.sub,
      contentSha256
    });

    const existingInvoice = await getInvoiceById(uploadData.invoiceId, auth.user.sub);
    if (existingInvoice?.status === 'ANALYZED' || existingInvoice?.status === 'PAID') {
      return response.success({
        message: 'Hóa đơn này đã được phân tích trước đó.',
        ...uploadData,
        status: 'ANALYZED',
        progress: 100,
        existing: true,
        uploadRequired: false
      });
    }

    const cachedInvoice = await getInvoiceFromCache(uploadData.cacheKey);
    if (cachedInvoice && String(cachedInvoice.userId || auth.user.sub) === String(auth.user.sub)) {
      const uploadRequired = cachedInvoice.status === 'UPLOADED' && !cachedInvoice.uploadConfirmed;
      return response.success({
        message: 'Tiếp tục trạng thái xử lý của hóa đơn đã nhập.',
        ...uploadData,
        status: cachedInvoice.status || 'UPLOADED',
        progress: Number(cachedInvoice.progress) || 0,
        warning: cachedInvoice.warning || null,
        error: cachedInvoice.errorCode ? { code: cachedInvoice.errorCode, message: cachedInvoice.errorMessage } : null,
        existing: true,
        uploadRequired
      });
    }

    await cacheInvoiceData(uploadData.cacheKey, {
      invoiceId: uploadData.invoiceId,
      userId: auth.user.sub,
      fileKey: uploadData.fileKey,
      sourceFileKey: uploadData.fileKey,
      source_file_key: uploadData.fileKey,
      status: 'UPLOADED',
      progress: 0,
      uploadConfirmed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, 3600);

    logger.info('Sinh presigned URL thành công', {
      fileKey: uploadData.fileKey,
      invoiceId: uploadData.invoiceId,
      cacheKey: uploadData.cacheKey,
      userId: auth.user.sub
    });

    // Phản hồi thành công với uploadUrl, fileKey, invoiceId và cacheKey
    return response.success({
      message: 'Sinh đường dẫn tải lên (upload presigned URL) thành công!',
      ...uploadData,
      status: 'UPLOADED',
      progress: 0,
      existing: false,
      uploadRequired: true
    });
  } catch (error) {
    logger.error('Lỗi nghiêm trọng khi sinh presigned URL để nhập hóa đơn', error);
    return response.serverError('Đã xảy ra lỗi hệ thống khi xử lý yêu cầu.');
  }
};

