import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// Khởi tạo Bedrock Runtime Client để gọi các mô hình AI trên Amazon Bedrock
export const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'ap-southeast-1'
});

/**
 * Sử dụng mô hình Amazon Bedrock AI (Claude 3 Haiku) để phân tích dữ liệu hóa đơn dạng OCR
 * và chuyển đổi thành cấu trúc JSON tiêu chuẩn.
 * @param {Array} ocrData - Dữ liệu hóa đơn thô thu được từ Textract
 * @returns {Promise<{VendorName: string, TotalAmount: number, TaxAmount: number, Date: string, FinancialAdvice: string}>}
 */
export const analyzeInvoiceWithAI = async (ocrData) => {
  try {
    const modelId = 'anthropic.claude-3-haiku-20240307-v1:0';

    // Tạo prompt hướng dẫn mô hình trích xuất dữ liệu hóa đơn dạng JSON
    const prompt = `Bạn là một trợ lý AI chuyên gia phân tích tài chính. Dưới đây là dữ liệu OCR trích xuất từ một hóa đơn:
    
    ${JSON.stringify(ocrData, null, 2)}
    
    Hãy phân tích kỹ văn bản OCR trên và trích xuất các trường thông tin sau.
    BẮT BUỘC chỉ trả về duy nhất một đối tượng JSON hợp lệ (không kèm theo markdown codeblock hay bất kỳ lời giải thích nào khác), tuân thủ định dạng dưới đây:
    {
      "VendorName": "Tên nhà cung cấp hoặc công ty xuất hóa đơn",
      "TotalAmount": tổng số tiền thanh toán (dưới dạng số thực hoặc số nguyên),
      "TaxAmount": số tiền thuế VAT hoặc các loại thuế khác (dưới dạng số thực hoặc số nguyên, nếu không có hãy ghi null),
      "Date": "Ngày lập hóa đơn định dạng YYYY-MM-DD (nếu không tìm thấy hãy ghi null)",
      "FinancialAdvice": "Một câu lời khuyên tài chính ngắn gọn bằng Tiếng Việt dựa trên nội dung hóa đơn này (ví dụ: đánh giá về chi phí, tối ưu thuế hoặc ngân sách)."
    }`;

    // Khởi tạo JSON payload (khối dữ liệu JSON) theo định dạng yêu cầu của Claude 3 trên Bedrock
    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt
            }
          ]
        }
      ]
    };

    // Tạo lệnh gọi mô hình (InvokeModelCommand)
    const command = new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload)
    });

    // Thực thi lệnh và nhận phản hồi từ Bedrock
    const response = await bedrockClient.send(command);

    // Giải mã (decode) phản hồi nhận được
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const aiText = responseBody.content[0].text.trim();

    // Hậu xử lý kết quả trả về của AI để trích xuất JSON nếu AI lỡ bọc trong markdown block
    let jsonString = aiText;
    if (aiText.includes('```json')) {
      jsonString = aiText.substring(aiText.indexOf('```json') + 7, aiText.lastIndexOf('```')).trim();
    } else if (aiText.includes('```')) {
      jsonString = aiText.substring(aiText.indexOf('```') + 3, aiText.lastIndexOf('```')).trim();
    }

    // Phân tích cú pháp (parse) kết quả JSON của AI
    const parsedResult = JSON.parse(jsonString);

    return {
      VendorName: parsedResult.VendorName || 'Unknown',
      TotalAmount: Number(parsedResult.TotalAmount) || 0,
      TaxAmount: parsedResult.TaxAmount !== null ? Number(parsedResult.TaxAmount) : null,
      Date: parsedResult.Date || null,
      FinancialAdvice: parsedResult.FinancialAdvice || 'Không có lời khuyên cụ thể cho hóa đơn này.'
    };
  } catch (error) {
    console.error('Lỗi khi phân tích hóa đơn bằng Amazon Bedrock AI:', error);
    throw error;
  }
};

