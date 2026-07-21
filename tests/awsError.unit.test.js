import assert from 'node:assert/strict';
import test from 'node:test';
import { BedrockServiceError } from '../src/services/bedrock.service.js';
import { classifyAwsError, sanitizedAwsLogError } from '../src/utils/awsError.js';

test('missing AWS credentials use a sanitized stable 503 response', () => {
  const raw = Object.assign(new Error('Could not load credentials from any providers at C:\\private\\profile'), {
    name: 'CredentialsProviderError'
  });
  const result = classifyAwsError(raw);
  assert.deepEqual(result, {
    statusCode: 503,
    code: 'AWS_CREDENTIALS_MISSING',
    error: 'AWS service unavailable',
    message: 'Chưa cấu hình AWS credentials cho môi trường local.',
    retryable: false
  });
  const safeError = sanitizedAwsLogError(raw, result);
  assert.equal(safeError.message, result.message);
  assert.doesNotMatch(safeError.stack, /private|profile/i);
});

test('invalid credentials and AWS configuration have distinct stable codes', () => {
  assert.equal(classifyAwsError({ name: 'ExpiredTokenException' }).code, 'AWS_CREDENTIALS_INVALID');
  assert.equal(classifyAwsError({ name: 'AuthorizationHeaderMalformed' }).code, 'AWS_CONFIGURATION_ERROR');
});

test('AWS access denied stays distinct and unknown errors are not misclassified', () => {
  const denied = classifyAwsError({ name: 'AccessDeniedException', message: 'Access denied' });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.code, 'AWS_ACCESS_DENIED');
  assert.equal(classifyAwsError(new Error('Database unavailable')), null);
});

test('typed Bedrock and STS failures retain only their sanitized public contract', () => {
  for (const code of [
    'BEDROCK_ASSUME_ROLE_ACCESS_DENIED',
    'BEDROCK_THROTTLED',
    'BEDROCK_VALIDATION_FAILED',
    'BEDROCK_MODEL_UNAVAILABLE',
    'BEDROCK_INVALID_RESPONSE',
  ]) {
    const error = new BedrockServiceError(code);
    const result = classifyAwsError(error);
    assert.equal(result.code, code);
    assert.equal(result.message, error.message);
    assert.equal(result.retryable, error.retryable);
    assert.doesNotMatch(JSON.stringify(result), /credential|role\/|arn:aws|stack/i);

    const safeLogError = sanitizedAwsLogError(error, result);
    assert.equal(safeLogError.message, result.message);
    assert.equal(safeLogError.code, code);
  }
});
