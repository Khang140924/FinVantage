import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyOcrError } from '../src/utils/ocrError.js';

test('unknown OCR errors return a fixed public message without raw details', () => {
  const rawMessage = 'Unexpected SDK failure at C:\\private\\credentials with secret-token-value';
  const result = classifyOcrError(new Error(rawMessage));
  assert.equal(result.statusCode, 500);
  assert.equal(result.code, 'OCR_PROCESSING_FAILED');
  assert.equal(result.message, 'Không thể xử lý OCR do lỗi hệ thống.');
  assert.doesNotMatch(JSON.stringify(result), /private|credentials|secret-token-value/i);
});

test('OCR AWS and Redis failures retain stable sanitized classifications', () => {
  const aws = classifyOcrError(Object.assign(new Error('Could not load credentials from any providers'), {
    name: 'CredentialsProviderError'
  }));
  assert.equal(aws.statusCode, 503);
  assert.equal(aws.code, 'AWS_CREDENTIALS_MISSING');
  assert.equal(aws.message, 'Chưa cấu hình AWS credentials cho môi trường local.');

  const redis = classifyOcrError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
  assert.equal(redis.statusCode, 503);
  assert.equal(redis.code, 'OCR_REDIS_UNAVAILABLE');
  assert.equal(redis.retryable, true);
});
