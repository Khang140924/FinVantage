import { classifyAwsError } from './awsError.js';
import { OcrResultError } from './textractExpense.js';

export const classifyOcrError = (error) => {
  if (error instanceof OcrResultError) {
    return { statusCode: 422, code: error.code, message: error.message, retryable: false };
  }

  const awsFailure = classifyAwsError(error);
  if (awsFailure) return awsFailure;

  if (
    error?.name === 'InvalidS3ObjectException' || error?.name === 'NoSuchKey'
    || error?.Code === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404
    || /unable to get object metadata|not found|no such key/i.test(error?.message || '')
  ) {
    return {
      statusCode: 404,
      code: 'OCR_S3_OBJECT_NOT_FOUND',
      message: 'Không tìm thấy file hóa đơn trong S3.',
      retryable: false
    };
  }

  if (
    error?.code === 'ECONNREFUSED' || error?.cause?.code === 'ECONNREFUSED'
    || /redis|econnrefused/i.test(error?.message || '')
  ) {
    return {
      statusCode: 503,
      code: 'OCR_REDIS_UNAVAILABLE',
      message: 'Redis chưa sẵn sàng để lưu trạng thái OCR.',
      retryable: true
    };
  }

  return {
    statusCode: 500,
    code: 'OCR_PROCESSING_FAILED',
    message: 'Không thể xử lý OCR do lỗi hệ thống.',
    retryable: false
  };
};
