import { analyzeInvoiceWithAI } from '../services/bedrock.service.js';
import { getInvoiceFromCache, saveParsedInvoice } from '../services/db.service.js';
import * as response from '../utils/response.js';
import { logger } from '../utils/logger.js';

// Hàm xử lý Lambda (Lambda handler) phân tích AI và lưu trữ thông tin hóa đơn
export const handler = async (event) => {
  try {
    logger.info('Nhận yêu cầu phân tích hóa đơn bằng AI', { event });

    // Trích xuất cacheKey linh hoạt từ event body (API Gateway) hoặc event payload trực tiếp
    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (parseError) {
      logger.error('Lỗi khi phân tích cú pháp request body JSON', parseError);
      return response.badRequest('Cấu trúc JSON trong request body không hợp lệ.');
    }

    const cacheKey = event.cacheKey || (body && body.cacheKey);

    if (!cacheKey) {
      logger.warn('Yêu cầu thiếu tham số bắt buộc cacheKey');
      return response.badRequest('Yêu cầu thiếu tham số bắt buộc: cacheKey.');
    }

    // Bước A: Lấy dữ liệu OCR từ Redis cache
    logger.info(`Đang truy vấn dữ liệu OCR từ Redis với khóa: ${cacheKey}`);
    const ocrData = await getInvoiceFromCache(cacheKey);
    
    if (!ocrData) {
      const notFoundError = new Error(`Không tìm thấy dữ liệu OCR tương ứng trong cache với khóa: [${cacheKey}]`);
      logger.error('Lỗi truy vấn cache', notFoundError);
      throw notFoundError; // Ném lỗi theo đúng yêu cầu thiết kế
    }

    // Bước B: Chuyển dữ liệu OCR qua Amazon Bedrock AI để phân tích
    logger.info('Đang gửi dữ liệu OCR sang Amazon Bedrock (Claude 3 Haiku) để phân tích...');
    const aiResult = await analyzeInvoiceWithAI(ocrData);

    // Bước C: Lưu dữ liệu có cấu trúc đã phân tích vào PostgreSQL (RDS)
    logger.info('Đang lưu thông tin hóa đơn có cấu trúc vào PostgreSQL...');
    const savedInvoice = await saveParsedInvoice(aiResult);

    logger.info('Phân tích và lưu trữ hóa đơn thành công!', { invoiceId: savedInvoice.id });

    // Phản hồi thành công về client
    return response.success({
      message: 'Phân tích hóa đơn bằng AI và lưu trữ thành công!',
      invoice: savedInvoice
    });
  } catch (error) {
    logger.error('Lỗi nghiêm trọng trong quá trình phân tích và lưu trữ hóa đơn', error);
    return response.serverError(`Đã xảy ra lỗi khi xử lý hóa đơn: ${error.message}`);
  }
};

