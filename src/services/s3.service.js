import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getInvoiceUploadIdentity } from '../utils/invoice.js';

// Khởi tạo S3 Client cho các tác vụ tương tác với Amazon S3
export const s3Client = new S3Client({
  region: process.env.AWS_REGION || process.env.AWS_REGION_NAME || 'ap-southeast-1'
});

/**
 * Sinh ra một presigned URL (đường dẫn liên kết được ký trước) để tải tệp lên trực tiếp từ frontend
 * @param {string} fileName - Tên của tệp tin hóa đơn
 * @param {string} contentType - Kiểu nội dung của tệp tin (ví dụ: application/pdf, image/png)
 * @returns {Promise<{uploadUrl: string, fileKey: string, invoiceId: string, cacheKey: string}>} - Trả về đường dẫn tải lên và thông tin OCR cache
 */
export const generateUploadUrl = async (fileName, contentType) => {
  // Tạo unique file key (khóa tệp duy nhất) và lưu trong thư mục uploads/ để kích hoạt S3 trigger
  const cleanFileName = fileName.replace(/\s+/g, '_'); // Thay thế khoảng trắng bằng dấu gạch dưới
  const fileKey = `uploads/${Date.now()}_${cleanFileName}`;
  const bucketName = process.env.S3_RAW_BUCKET_NAME || process.env.S3_BUCKET_NAME || 'finvantage-raw-invoices-dev';
  const { invoiceId, cacheKey } = getInvoiceUploadIdentity(fileKey);

  // Khởi tạo PutObjectCommand (lệnh ghi đối tượng)
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
    ContentType: contentType
  });

  // Tạo presigned URL (đường dẫn liên kết được ký trước) có hiệu lực trong 300 giây (5 phút)
  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

  return {
    uploadUrl,
    fileKey,
    invoiceId,
    cacheKey
  };
};

