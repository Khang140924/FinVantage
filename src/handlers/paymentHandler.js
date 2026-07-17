import { updateInvoicePaymentStatus } from '../services/db.service.js';
import * as response from '../utils/response.js';
import { logger } from '../utils/logger.js';

// Hàm xử lý Lambda (Lambda handler) để xử lý thanh toán (payment processing) liên quan tới hóa đơn
export const handler = async (event) => {
  try {
    logger.info('Nhận yêu cầu xử lý thanh toán hóa đơn', { event });

    // Phân tích cú pháp JSON an toàn từ request body
    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (parseError) {
      logger.error('Lỗi khi phân tích cú pháp request body JSON của thanh toán', parseError);
      return response.badRequest('Cấu trúc JSON trong request body không hợp lệ.');
    }

    // Xác thực các tham số đầu vào bắt buộc
    if (!body || !body.invoiceId || !body.paymentMethod) {
      logger.warn('Yêu cầu thanh toán thiếu tham số bắt buộc invoiceId hoặc paymentMethod', { body });
      return response.badRequest('Yêu cầu thiếu tham số bắt buộc: invoiceId hoặc paymentMethod.');
    }

    const { invoiceId, paymentMethod } = body;

    logger.info(`Bắt đầu giả lập giao dịch thanh toán cho hóa đơn [ID: ${invoiceId}] qua phương thức [${paymentMethod}]`);

    // Giả lập độ trễ xử lý thanh toán (Mock payment processing delay) 800ms
    await new Promise(resolve => setTimeout(resolve, 800));

    // Cập nhật trạng thái hóa đơn thành PAID (Đã thanh toán) trong PostgreSQL
    logger.info(`Đang cập nhật trạng thái thanh toán hóa đơn [ID: ${invoiceId}] thành PAID trong database`);
    const updatedInvoice = await updateInvoicePaymentStatus(invoiceId, 'PAID', auth.user.sub);

    // Sinh mã giao dịch giả lập (Mock Transaction ID)
    const transactionId = `tx_pay_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    logger.info('Xử lý thanh toán thành công!', { invoiceId, transactionId });

    // Trả về kết quả thành công
    return response.success({
      message: 'Giao dịch thanh toán được xử lý thành công!',
      transactionId,
      invoice: updatedInvoice
    });
  } catch (error) {
    logger.error('Lỗi nghiêm trọng xảy ra trong quá trình xử lý thanh toán', error);
    return response.serverError(`Đã xảy ra lỗi hệ thống khi xử lý thanh toán: ${error.message}`);
  }
};

