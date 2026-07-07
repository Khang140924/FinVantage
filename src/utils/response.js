// Tiện ích định dạng API Gateway response (phản hồi API Gateway) chuẩn hóa
export const sendResponse = (statusCode, data) => {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', // Hỗ trợ CORS (chia sẻ tài nguyên giữa các nguồn gốc)
      'Access-Control-Allow-Credentials': true
    },
    body: JSON.stringify(data)
  };
};

export const success = (data) => sendResponse(200, data);
export const created = (data) => sendResponse(201, data);
export const badRequest = (message) => sendResponse(400, { error: 'Bad Request (Yêu cầu không hợp lệ)', message });
export const unauthorized = (message) => sendResponse(401, { error: 'Unauthorized (Chưa được xác thực)', message });
export const notFound = (message) => sendResponse(404, { error: 'Not Found (Không tìm thấy tài nguyên)', message });
export const serverError = (message) => sendResponse(500, { error: 'Internal Server Error (Lỗi hệ thống)', message });
