const PROD_STAGES = new Set(['prod', 'production']);

const text = (value) => String(value ?? '').trim();

export const parseCsvEnvironment = (value) => text(value)
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

export const isProductionEnvironment = (env = process.env, stage = '') => (
  text(env.NODE_ENV).toLowerCase() === 'production'
  || PROD_STAGES.has(text(stage || env.SLS_STAGE || env.STAGE).toLowerCase())
);

const isHttpsUrl = (value, { allowPath = true } = {}) => {
  try {
    const url = new URL(text(value));
    if (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return false;
    if (url.username || url.password || url.search || url.hash) return false;
    return allowPath || ['/', ''].includes(url.pathname);
  } catch {
    return false;
  }
};

const isRoleArn = (value) => /^arn:[a-z0-9-]+:iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]+$/.test(text(value));
const isSecretArn = (value) => /^arn:[a-z0-9-]+:secretsmanager:[a-z0-9-]+:\d{12}:secret:[^\s]+$/.test(text(value));
const isKmsArn = (value) => /^arn:[a-z0-9-]+:kms:[a-z0-9-]+:\d{12}:key\/[0-9a-f-]+$/i.test(text(value));
const isSnsArn = (value) => /^arn:[a-z0-9-]+:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]+$/.test(text(value));
const isBucketName = (value) => {
  const name = text(value);
  return name.length >= 3
    && name.length <= 63
    && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)
    && !/\.\.|\.-|-\./.test(name)
    && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(name);
};
const isPositiveInteger = (value) => Number.isInteger(Number(value)) && Number(value) > 0;
const isLocalHostname = (value) => {
  const hostname = text(value).toLowerCase().replace(/^\[|\]$/g, '');
  return ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)
    || hostname.endsWith('.localhost');
};
const isRemoteHostname = (value) => (
  /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(text(value))
  && !isLocalHostname(value)
);
const isPlaceholder = (value) => (
  /(?:placeholder|replace(?:_|-)?me|change(?:_|-)?me|your(?:_|-))/i.test(text(value))
  || /\.invalid(?:\/|$)/i.test(text(value))
  || /^<[^>]+>$/.test(text(value))
);

export function validateProductionConfig(env = process.env, { stage = '' } = {}) {
  const production = isProductionEnvironment(env, stage);
  if (!production) return { production: false, valid: true, errors: [] };

  const errors = [];
  const required = [
    'NODE_ENV',
    'AWS_REGION_NAME',
    'SERVERLESS_DEPLOYMENT_BUCKET',
    'S3_RAW_BUCKET_NAME',
    'S3_BUCKET_NAME',
    'PROFILE_AVATAR_BUCKET_NAME',
    'COGNITO_USER_POOL_ID',
    'COGNITO_CLIENT_ID',
    'COGNITO_ISSUER',
    'COGNITO_DOMAIN',
    'COGNITO_REDIRECT_URI',
    'COGNITO_LOGOUT_URI',
    'RDS_PROXY_ENDPOINT',
    'DB_PORT',
    'DB_NAME',
    'DB_SECRET_ARN',
    'REDIS_KEY_PREFIX',
    'BEDROCK_AWS_REGION',
    'BEDROCK_MODEL_ID',
    'BEDROCK_ROLE_ARN',
    'API_ALLOWED_ORIGIN',
    'PRIVATE_SUBNET_IDS',
    'LAMBDA_SECURITY_GROUP_IDS'
  ];

  for (const name of required) {
    if (!text(env[name])) errors.push({ name, code: 'REQUIRED' });
    else if (isPlaceholder(env[name])) errors.push({ name, code: 'PLACEHOLDER_NOT_ALLOWED' });
  }

  const appSecretArn = text(env.APP_SECRET_ARN);
  const redisUrlSecretArn = text(env.REDIS_URL_SECRET_ARN);
  for (const name of ['SESSION_SECRET', 'COGNITO_CLIENT_SECRET']) {
    if (!text(env[name]) && !appSecretArn) errors.push({ name, code: 'REQUIRED' });
    if (text(env[name]) && isPlaceholder(env[name])) errors.push({ name, code: 'PLACEHOLDER_NOT_ALLOWED' });
  }
  if (!text(env.REDIS_URL) && !redisUrlSecretArn) errors.push({ name: 'REDIS_URL', code: 'REQUIRED' });
  if (text(env.REDIS_URL) && isPlaceholder(env.REDIS_URL)) {
    errors.push({ name: 'REDIS_URL', code: 'PLACEHOLDER_NOT_ALLOWED' });
  }

  if (text(env.NODE_ENV).toLowerCase() !== 'production') {
    errors.push({ name: 'NODE_ENV', code: 'MUST_BE_PRODUCTION' });
  }

  if (text(env.USE_MOCK_AI).toLowerCase() !== 'false') {
    errors.push({ name: 'USE_MOCK_AI', code: 'MUST_BE_FALSE' });
  }
  if (text(env.USE_MOCK_AUTH).toLowerCase() !== 'false') {
    errors.push({ name: 'USE_MOCK_AUTH', code: 'MUST_BE_FALSE' });
  }
  if (text(env.BEDROCK_AWS_PROFILE)) {
    errors.push({ name: 'BEDROCK_AWS_PROFILE', code: 'NOT_SUPPORTED_IN_LAMBDA' });
  }
  for (const name of ['DB_USER', 'DB_PASSWORD']) {
    if (text(env[name])) errors.push({ name, code: 'NOT_ALLOWED_WITH_DB_SECRET' });
  }
  if (text(env.DB_SSL).toLowerCase() !== 'true') {
    errors.push({ name: 'DB_SSL', code: 'MUST_BE_TRUE' });
  }
  if (text(env.REDIS_URL)) {
    try {
      const redisUrl = new URL(text(env.REDIS_URL));
      if (redisUrl.protocol !== 'rediss:') errors.push({ name: 'REDIS_URL', code: 'TLS_REQUIRED' });
      if (!redisUrl.hostname || isLocalHostname(redisUrl.hostname)) {
        errors.push({ name: 'REDIS_URL', code: 'REMOTE_HOST_REQUIRED' });
      }
    } catch {
      errors.push({ name: 'REDIS_URL', code: 'INVALID_URL' });
    }
  }
  if (text(env.API_ALLOWED_ORIGIN) && !isHttpsUrl(env.API_ALLOWED_ORIGIN, { allowPath: false })) {
    errors.push({ name: 'API_ALLOWED_ORIGIN', code: 'HTTPS_ORIGIN_REQUIRED' });
  }
  for (const name of ['COGNITO_ISSUER', 'COGNITO_DOMAIN', 'COGNITO_REDIRECT_URI', 'COGNITO_LOGOUT_URI']) {
    if (text(env[name]) && !isHttpsUrl(env[name])) errors.push({ name, code: 'HTTPS_URL_REQUIRED' });
  }
  if (text(env.BEDROCK_ROLE_ARN) && !isRoleArn(env.BEDROCK_ROLE_ARN)) {
    errors.push({ name: 'BEDROCK_ROLE_ARN', code: 'INVALID_ROLE_ARN' });
  }
  if (text(env.DB_SECRET_ARN) && !isSecretArn(env.DB_SECRET_ARN)) {
    errors.push({ name: 'DB_SECRET_ARN', code: 'INVALID_SECRET_ARN' });
  }
  for (const name of ['APP_SECRET_ARN', 'REDIS_URL_SECRET_ARN']) {
    if (text(env[name]) && !isSecretArn(env[name])) errors.push({ name, code: 'INVALID_SECRET_ARN' });
  }
  for (const name of ['SERVERLESS_DEPLOYMENT_BUCKET', 'S3_RAW_BUCKET_NAME', 'S3_BUCKET_NAME', 'PROFILE_AVATAR_BUCKET_NAME']) {
    if (text(env[name]) && !isBucketName(env[name])) errors.push({ name, code: 'INVALID_BUCKET_NAME' });
  }
  if (text(env.KMS_KEY_ARN) && !isKmsArn(env.KMS_KEY_ARN)) {
    errors.push({ name: 'KMS_KEY_ARN', code: 'INVALID_KMS_ARN' });
  }
  if (text(env.SNS_BUDGET_ALERTS_TOPIC_ARN) && !isSnsArn(env.SNS_BUDGET_ALERTS_TOPIC_ARN)) {
    errors.push({ name: 'SNS_BUDGET_ALERTS_TOPIC_ARN', code: 'INVALID_SNS_ARN' });
  }
  if (text(env.RDS_PROXY_ENDPOINT) && !isRemoteHostname(env.RDS_PROXY_ENDPOINT)) {
    errors.push({ name: 'RDS_PROXY_ENDPOINT', code: 'REMOTE_HOST_REQUIRED' });
  }
  const userPoolId = text(env.COGNITO_USER_POOL_ID);
  const clientId = text(env.COGNITO_CLIENT_ID);
  if (userPoolId && !/^[a-z]{2}(?:-gov)?-[a-z]+-\d_[A-Za-z0-9]+$/i.test(userPoolId)) {
    errors.push({ name: 'COGNITO_USER_POOL_ID', code: 'INVALID_USER_POOL_ID' });
  }
  if (clientId && !/^[a-z0-9]{1,128}$/i.test(clientId)) {
    errors.push({ name: 'COGNITO_CLIENT_ID', code: 'INVALID_CLIENT_ID' });
  }
  try {
    const issuer = new URL(text(env.COGNITO_ISSUER));
    const expectedIssuerHost = `cognito-idp.${text(env.AWS_REGION_NAME)}.amazonaws.com`;
    if (issuer.hostname !== expectedIssuerHost || issuer.pathname !== `/${userPoolId}`) {
      errors.push({ name: 'COGNITO_ISSUER', code: 'ISSUER_MISMATCH' });
    }
    const domain = new URL(text(env.COGNITO_DOMAIN));
    if (!['', '/'].includes(domain.pathname)) errors.push({ name: 'COGNITO_DOMAIN', code: 'ORIGIN_REQUIRED' });
    const redirect = new URL(text(env.COGNITO_REDIRECT_URI));
    const logout = new URL(text(env.COGNITO_LOGOUT_URI));
    if (!redirect.pathname.endsWith('/auth/callback')) {
      errors.push({ name: 'COGNITO_REDIRECT_URI', code: 'CALLBACK_PATH_REQUIRED' });
    }
    if (redirect.origin !== logout.origin) {
      errors.push({ name: 'COGNITO_LOGOUT_URI', code: 'ORIGIN_MISMATCH' });
    }
  } catch {
    // URL-specific validation above already reports the relevant field names.
  }
  if (text(env.SESSION_SECRET).length > 0 && text(env.SESSION_SECRET).length < 32) {
    errors.push({ name: 'SESSION_SECRET', code: 'TOO_SHORT' });
  }
  if (text(env.DB_PORT) && !isPositiveInteger(env.DB_PORT)) {
    errors.push({ name: 'DB_PORT', code: 'INVALID_INTEGER' });
  }
  for (const name of ['DB_POOL_MAX', 'DB_CONNECTION_TIMEOUT_MS', 'DB_IDLE_TIMEOUT_MS']) {
    if (text(env[name]) && !isPositiveInteger(env[name])) errors.push({ name, code: 'INVALID_INTEGER' });
  }
  const subnetIds = parseCsvEnvironment(env.PRIVATE_SUBNET_IDS);
  const securityGroupIds = parseCsvEnvironment(env.LAMBDA_SECURITY_GROUP_IDS);
  if (new Set(subnetIds).size < 2) {
    errors.push({ name: 'PRIVATE_SUBNET_IDS', code: 'AT_LEAST_TWO_REQUIRED' });
  }
  if (subnetIds.some((id) => !/^subnet-[0-9a-f]{8,17}$/i.test(id))) {
    errors.push({ name: 'PRIVATE_SUBNET_IDS', code: 'INVALID_ID' });
  }
  if (securityGroupIds.length < 1) {
    errors.push({ name: 'LAMBDA_SECURITY_GROUP_IDS', code: 'AT_LEAST_ONE_REQUIRED' });
  }
  if (securityGroupIds.some((id) => !/^sg-[0-9a-f]{8,17}$/i.test(id))) {
    errors.push({ name: 'LAMBDA_SECURITY_GROUP_IDS', code: 'INVALID_ID' });
  }

  const uniqueErrors = [...new Map(errors.map((error) => [`${error.name}:${error.code}`, error])).values()];
  return { production: true, valid: uniqueErrors.length === 0, errors: uniqueErrors };
}

export function assertProductionConfig(env = process.env, options = {}) {
  const result = validateProductionConfig(env, options);
  if (!result.valid) {
    const names = [...new Set(result.errors.map((error) => error.name))].sort();
    const error = new Error(`Production configuration is invalid or missing: ${names.join(', ')}.`);
    error.name = 'ProductionConfigurationError';
    error.code = 'PRODUCTION_CONFIG_INVALID';
    error.fields = names;
    throw error;
  }
  return result;
}
