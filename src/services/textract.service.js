import { TextractClient, AnalyzeExpenseCommand } from '@aws-sdk/client-textract';

// Khởi tạo Textract Client cho các tác vụ trích xuất dữ liệu tài liệu (OCR)
export const textractClient = new TextractClient({
  region: process.env.AWS_REGION || 'ap-southeast-1'
});

/**
 * Trích xuất dữ liệu tài chính từ hóa đơn lưu trữ trên S3 bằng AWS Textract AnalyzeExpense API
 * @param {string} bucketName - Tên ngăn chứa S3 (S3 Bucket Name)
 * @param {string} fileKey - Đường dẫn/khóa tệp tin trên S3 (S3 File Key)
 * @returns {Promise<Array>} - Trả về mảng các tài liệu hóa đơn đã được phân tích (ExpenseDocuments)
 */
export const extractInvoiceData = async (bucketName, fileKey) => {
  try {
    // Khởi tạo command AnalyzeExpenseCommand với vị trí tệp tin trên S3
    const command = new AnalyzeExpenseCommand({
      Document: {
        S3Object: {
          Bucket: bucketName,
          Name: fileKey
        }
      }
    });

    // Thực thi lệnh và nhận phản hồi từ AWS Textract
    const response = await textractClient.send(command);

    // Trả về dữ liệu hóa đơn trích xuất được (ExpenseDocuments)
    return response.ExpenseDocuments || [];
  } catch (error) {
    console.error(`Lỗi khi trích xuất dữ liệu hóa đơn từ S3 (Bucket: ${bucketName}, Key: ${fileKey}):`, error);
    throw error;
  }
};

