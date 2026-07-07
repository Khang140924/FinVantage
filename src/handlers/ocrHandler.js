import { extractInvoiceData } from '../services/textract.service.js';
import { cacheInvoiceData } from '../services/db.service.js';
import { logger } from '../utils/logger.js';

// Hàm xử lý Lambda (Lambda handler) xử lý sự kiện S3 để kích hoạt quy trình OCR hóa đơn
export const handler = async (event) => {
  try {
    logger.info('Nhận sự kiện trigger OCR từ S3', { recordsCount: event.Records?.length || 0 });

    if (!event.Records || event.Records.length === 0) {
      logger.warn('Không tìm thấy bản ghi S3 event nào trong yêu cầu.');
      return;
    }

    // Lặp qua từng bản ghi sự kiện S3
    for (const record of event.Records) {
      const bucketName = record.s3.bucket.name;
      // Giải mã (decode) key để tránh các ký tự mã hóa URL (ví dụ: khoảng trắng chuyển thành +)
      const objectKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

      logger.info(`Đang xử lý bản ghi S3: Bucket [${bucketName}], Key [${objectKey}]`);

      // Bỏ qua các tệp không nằm trong thư mục uploads/
      if (!objectKey.startsWith('uploads/')) {
        logger.info(`Bỏ qua tệp tin vì không nằm trong thư mục 'uploads/': ${objectKey}`);
        continue;
      }

      logger.info(`Kích hoạt trích xuất dữ liệu OCR từ AWS Textract cho tệp: ${objectKey}`);
      const expenseDocuments = await extractInvoiceData(bucketName, objectKey);

      logger.info('Trích xuất OCR từ AWS Textract thành công!', {
        bucketName,
        objectKey,
        documentsCount: expenseDocuments.length
      });

      // Tạo khóa cache (cache key) duy nhất cho Redis
      const cacheKey = `cache:invoice:${objectKey}`;
      
      logger.info(`Đang tiến hành lưu trữ tạm thời dữ liệu OCR vào Redis với khóa: ${cacheKey}`);
      await cacheInvoiceData(cacheKey, expenseDocuments);

      logger.info(`Invoice data cached successfully in Redis with key: [${cacheKey}]. Ready for AI Analysis.`);
    }

    logger.info('Hoàn tất xử lý sự kiện OCR từ S3.');
  } catch (error) {
    logger.error('Lỗi nghiêm trọng xảy ra trong quá trình xử lý sự kiện OCR', error);
    throw error; // Ném lỗi (throw error) để AWS Lambda ghi nhận trạng thái thất bại của tác vụ nền
  }
};


