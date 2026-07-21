// API Gateway responses use one configured origin. Never reflect arbitrary
// request origins and never combine a wildcard origin with credentials.
export const API_CORS_ALLOWED_HEADERS = Object.freeze([
  'Authorization',
  'Content-Type',
  'Idempotency-Key',
  'Accept'
]);
export const API_CORS_ALLOWED_METHODS = Object.freeze([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS'
]);

export const getApiAllowedOrigin = (env = process.env) => {
  const configured = String(env.API_ALLOWED_ORIGIN || '').trim();
  const origin = configured || 'http://localhost:5174';
  if (origin === '*') {
    const error = new Error('API_ALLOWED_ORIGIN must be one explicit origin.');
    error.code = 'INVALID_API_ALLOWED_ORIGIN';
    throw error;
  }
  try {
    return new URL(origin).origin;
  } catch {
    const error = new Error('API_ALLOWED_ORIGIN must be a valid HTTP(S) origin.');
    error.code = 'INVALID_API_ALLOWED_ORIGIN';
    throw error;
  }
};

export const resolveCorsOrigin = (requestOrigin, env = process.env) => {
  const allowedOrigin = getApiAllowedOrigin(env);
  if (!requestOrigin) return allowedOrigin;
  try {
    return new URL(String(requestOrigin)).origin === allowedOrigin ? allowedOrigin : null;
  } catch {
    return null;
  }
};

export const buildCorsHeaders = (env = process.env) => ({
  'Access-Control-Allow-Origin': getApiAllowedOrigin(env),
  'Access-Control-Allow-Headers': API_CORS_ALLOWED_HEADERS.join(','),
  'Access-Control-Allow-Methods': API_CORS_ALLOWED_METHODS.join(','),
  Vary: 'Origin'
});

export const sendResponse = (statusCode, data, { env = process.env } = {}) => {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...buildCorsHeaders(env)
    },
    body: JSON.stringify(data)
  };
};

export const preflight = (event = {}, env = process.env) => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin;
  const allowedOrigin = resolveCorsOrigin(requestOrigin, env);
  if (!allowedOrigin) {
    return {
      statusCode: 403,
      headers: { Vary: 'Origin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Forbidden',
        code: 'CORS_ORIGIN_DENIED',
        message: 'The request origin is not allowed.'
      })
    };
  }
  return { statusCode: 204, headers: buildCorsHeaders(env), body: '' };
};

export const success = (data) => sendResponse(200, data);
export const created = (data) => sendResponse(201, data);
export const errorResponse = (statusCode, {
  error = 'Request failed',
  code = 'REQUEST_FAILED',
  message = 'Không thể xử lý yêu cầu.'
} = {}) => sendResponse(statusCode, { error, code, message });

export const badRequest = (message, code = 'BAD_REQUEST') => errorResponse(400, {
  error: 'Bad Request (Yêu cầu không hợp lệ)', code, message
});
export const unauthorized = (message, code = 'UNAUTHORIZED') => errorResponse(401, {
  error: 'Unauthorized (Chưa được xác thực)', code, message
});
export const notFound = (message, code = 'NOT_FOUND') => errorResponse(404, {
  error: 'Not Found (Không tìm thấy tài nguyên)', code, message
});
export const conflict = (message, code = 'CONFLICT') => errorResponse(409, {
  error: 'Conflict (Xung đột dữ liệu)', code, message
});
export const serverError = (message, code = 'INTERNAL_SERVER_ERROR') => errorResponse(500, {
  error: 'Internal Server Error (Lỗi hệ thống)', code, message
});
