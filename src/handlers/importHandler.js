import { generateUploadUrl } from '../services/s3.service.js';
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

    const { fileName, contentType } = body;

    // Sinh ra presigned URL
    logger.info(`Đang sinh presigned URL cho tệp: ${fileName}, kiểu: ${contentType}`);
    const uploadData = await generateUploadUrl(fileName, contentType);

    logger.info('Sinh presigned URL thành công', {
      fileKey: uploadData.fileKey,
      invoiceId: uploadData.invoiceId,
      cacheKey: uploadData.cacheKey
    });

    // Phản hồi thành công với uploadUrl, fileKey, invoiceId và cacheKey
    return response.success({
      message: 'Sinh đường dẫn tải lên (upload presigned URL) thành công!',
      ...uploadData
    });
  } catch (error) {
    logger.error('Lỗi nghiêm trọng khi sinh presigned URL để nhập hóa đơn', error);
    return response.serverError('Đã xảy ra lỗi hệ thống khi xử lý yêu cầu.');
  }
};

