const codeOf = (error = {}) => error.name || error.code || error.Code || '';
const messageOf = (error = {}) => String(error.message || '');

const matches = (value, candidates) => candidates.includes(String(value || ''));

const BEDROCK_SERVICE_ERROR_CODES = new Set([
  'BEDROCK_INPUT_INVALID',
  'BEDROCK_CONFIGURATION_INVALID',
  'BEDROCK_PROFILE_UNAVAILABLE',
  'BEDROCK_CREDENTIALS_UNAVAILABLE',
  'BEDROCK_ASSUME_ROLE_ACCESS_DENIED',
  'BEDROCK_ASSUME_ROLE_FAILED',
  'BEDROCK_ACCESS_DENIED',
  'BEDROCK_THROTTLED',
  'BEDROCK_VALIDATION_FAILED',
  'BEDROCK_MODEL_UNAVAILABLE',
  'BEDROCK_SERVICE_UNAVAILABLE',
  'BEDROCK_INVALID_RESPONSE',
  'BEDROCK_REQUEST_FAILED'
]);

export const classifyAwsError = (error) => {
  const code = codeOf(error);
  const message = messageOf(error);
  const applicationCode = String(error?.code || '');

  if (error?.name === 'BedrockServiceError' && BEDROCK_SERVICE_ERROR_CODES.has(applicationCode)) {
    return {
      statusCode: Number.isInteger(error.statusCode) ? error.statusCode : 502,
      code: applicationCode,
      error: applicationCode.includes('ACCESS_DENIED') ? 'AWS access denied' : 'Bedrock request failed',
      message,
      retryable: error.retryable === true
    };
  }

  if (
    matches(code, ['CredentialsProviderError', 'CredentialProviderError'])
    || /could not load credentials from any providers|missing credentials|no credential providers/i.test(message)
  ) {
    return {
      statusCode: 503,
      code: 'AWS_CREDENTIALS_MISSING',
      error: 'AWS service unavailable',
      message: 'Chưa cấu hình AWS credentials cho môi trường local.',
      retryable: false
    };
  }

  if (
    matches(code, [
      'UnrecognizedClientException',
      'InvalidClientTokenId',
      'InvalidSignatureException',
      'SignatureDoesNotMatch',
      'ExpiredToken',
      'ExpiredTokenException'
    ])
    || /security token.*invalid|credential object is not valid|token.*expired/i.test(message)
  ) {
    return {
      statusCode: 503,
      code: 'AWS_CREDENTIALS_INVALID',
      error: 'AWS service unavailable',
      message: 'Backend AWS credentials are invalid or expired.',
      retryable: false
    };
  }

  if (
    matches(code, ['AuthorizationHeaderMalformed', 'InvalidEndpointException', 'ConfigError'])
    || /region is missing|invalid region|invalid endpoint/i.test(message)
  ) {
    return {
      statusCode: 503,
      code: 'AWS_CONFIGURATION_ERROR',
      error: 'AWS service unavailable',
      message: 'Backend AWS region or service configuration is invalid.',
      retryable: false
    };
  }

  if (
    matches(code, ['AccessDenied', 'AccessDeniedException', 'UnauthorizedOperation'])
    || /access denied|not authorized to perform/i.test(message)
  ) {
    return {
      statusCode: 403,
      code: 'AWS_ACCESS_DENIED',
      error: 'AWS access denied',
      message: 'Backend AWS permissions do not allow this operation.',
      retryable: false
    };
  }

  return null;
};

export const sanitizedAwsLogError = (error, classifiedError) => {
  if (!classifiedError) return error;
  const safeError = new Error(classifiedError.message);
  safeError.name = error?.name || 'AwsServiceError';
  safeError.code = classifiedError.code;
  return safeError;
};
