import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertProductionConfig,
  parseCsvEnvironment,
  validateProductionConfig
} from '../src/config/production.config.js';

const testAccountId = '0'.repeat(12);

const validProductionEnv = () => ({
  NODE_ENV: 'production',
  AWS_REGION_NAME: 'ap-southeast-1',
  SERVERLESS_DEPLOYMENT_BUCKET: 'finvantage-deployment-test-bucket',
  S3_RAW_BUCKET_NAME: 'finvantage-invoice-test-bucket',
  S3_BUCKET_NAME: 'finvantage-invoice-test-bucket',
  PROFILE_AVATAR_BUCKET_NAME: 'finvantage-avatar-test-bucket',
  COGNITO_USER_POOL_ID: 'ap-southeast-1_testpool',
  COGNITO_CLIENT_ID: 'unittestclientid',
  COGNITO_CLIENT_SECRET: 'unit-test-client-secret',
  COGNITO_ISSUER: 'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_testpool',
  COGNITO_DOMAIN: 'https://auth.example.test',
  COGNITO_REDIRECT_URI: 'https://app.example.test/auth/callback',
  COGNITO_LOGOUT_URI: 'https://app.example.test/',
  SESSION_SECRET: 'unit-test-session-secret-at-least-32-characters',
  USE_MOCK_AI: 'false',
  USE_MOCK_AUTH: 'false',
  RDS_PROXY_ENDPOINT: 'proxy.example.test',
  DB_PORT: '5432',
  DB_NAME: 'finvantage',
  DB_SECRET_ARN: `arn:aws:secretsmanager:ap-southeast-1:${testAccountId}:secret:unit-test`,
  DB_SSL: 'true',
  DB_POOL_MAX: '2',
  DB_CONNECTION_TIMEOUT_MS: '5000',
  DB_IDLE_TIMEOUT_MS: '10000',
  REDIS_URL: 'rediss://cache.example.test:6379',
  REDIS_KEY_PREFIX: 'finvantage:prod',
  BEDROCK_AWS_REGION: 'ap-southeast-1',
  BEDROCK_MODEL_ID: 'provider.active-model-v1:0',
  BEDROCK_ROLE_ARN: `arn:aws:iam::${testAccountId}:role/FinVantageBedrockRole`,
  API_ALLOWED_ORIGIN: 'https://app.example.test',
  PRIVATE_SUBNET_IDS: 'subnet-aaaaaaaa,subnet-bbbbbbbb',
  LAMBDA_SECURITY_GROUP_IDS: 'sg-aaaaaaaa'
});

test('parseCsvEnvironment trims and removes empty entries', () => {
  assert.deepEqual(parseCsvEnvironment(' subnet-a, ,subnet-b '), ['subnet-a', 'subnet-b']);
});

test('development configuration remains permissive for local services', () => {
  assert.deepEqual(validateProductionConfig({ NODE_ENV: 'development' }), {
    production: false,
    valid: true,
    errors: []
  });
});

test('valid production configuration passes without exposing values', () => {
  const result = validateProductionConfig(validProductionEnv(), { stage: 'prod' });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('production rejects mock, plaintext Redis, localhost URLs and missing network config', () => {
  const env = validProductionEnv();
  env.USE_MOCK_AI = 'true';
  env.REDIS_URL = 'redis://localhost:6379';
  env.COGNITO_REDIRECT_URI = 'http://localhost:5174/auth/callback';
  env.PRIVATE_SUBNET_IDS = '';
  const result = validateProductionConfig(env, { stage: 'prod' });
  assert.equal(result.valid, false);
  const names = result.errors.map((error) => error.name);
  assert.ok(names.includes('USE_MOCK_AI'));
  assert.ok(names.includes('REDIS_URL'));
  assert.ok(names.includes('COGNITO_REDIRECT_URI'));
  assert.ok(names.includes('PRIVATE_SUBNET_IDS'));
});

test('production assertion reports names only', () => {
  const env = validProductionEnv();
  env.BEDROCK_ROLE_ARN = 'sensitive-invalid-value';
  assert.throws(
    () => assertProductionConfig(env, { stage: 'prod' }),
    (error) => error.code === 'PRODUCTION_CONFIG_INVALID'
      && error.message.includes('BEDROCK_ROLE_ARN')
      && !error.message.includes(env.BEDROCK_ROLE_ARN)
  );
});

test('production rejects local data endpoints, duplicate network IDs and legacy DB credentials', () => {
  const env = validProductionEnv();
  env.RDS_PROXY_ENDPOINT = 'localhost';
  env.REDIS_URL = 'rediss://localhost:6379';
  env.PRIVATE_SUBNET_IDS = 'subnet-aaaaaaaa,subnet-aaaaaaaa';
  env.LAMBDA_SECURITY_GROUP_IDS = 'security-group-name';
  env.DB_USER = 'legacy-user';
  env.DB_PASSWORD = 'legacy-password';
  env.API_ALLOWED_ORIGIN = 'https://app.example.test?unexpected=true';
  const result = validateProductionConfig(env, { stage: 'prod' });
  const names = result.errors.map((error) => error.name);
  for (const name of [
    'RDS_PROXY_ENDPOINT',
    'REDIS_URL',
    'PRIVATE_SUBNET_IDS',
    'LAMBDA_SECURITY_GROUP_IDS',
    'DB_USER',
    'DB_PASSWORD',
    'API_ALLOWED_ORIGIN'
  ]) assert.ok(names.includes(name));
});

test('production accepts secret references instead of materialized auth and Redis secrets', () => {
  const env = validProductionEnv();
  delete env.SESSION_SECRET;
  delete env.COGNITO_CLIENT_SECRET;
  delete env.REDIS_URL;
  env.APP_SECRET_ARN = `arn:aws:secretsmanager:ap-southeast-1:${testAccountId}:secret:runtime-test`;
  env.REDIS_URL_SECRET_ARN = `arn:aws:secretsmanager:ap-southeast-1:${testAccountId}:secret:redis-test`;
  assert.equal(validateProductionConfig(env, { stage: 'prod' }).valid, true);
});
