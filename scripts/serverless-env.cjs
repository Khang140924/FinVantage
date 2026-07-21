'use strict';

const readStage = () => {
  const stageIndex = process.argv.findIndex((value) => value === '--stage' || value === '-s');
  if (stageIndex >= 0) return String(process.argv[stageIndex + 1] || 'dev').trim();
  const inline = process.argv.find((value) => value.startsWith('--stage='));
  if (inline) return inline.slice('--stage='.length).trim();
  const direct = process.env.SLS_STAGE || process.env.STAGE;
  return direct ? String(direct).trim() : 'dev';
};

const stage = readStage();
const production = ['prod', 'production'].includes(stage.toLowerCase())
  || String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const value = (name, localDefault = '') => {
  const configured = process.env[name];
  if (configured !== undefined && configured !== '') return configured;
  return production ? '' : localDefault;
};
const csv = (name) => String(process.env[name] || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const appSecretArn = value('APP_SECRET_ARN', '');
const redisUrlSecretArn = value('REDIS_URL_SECRET_ARN', '');
const secretReference = (arn, key) => `{{resolve:secretsmanager:${arn}:SecretString:${key}}}`;

const runtime = {
  stage,
  appStage: stage,
  nodeEnv: production ? 'production' : value('NODE_ENV', 'development'),
  // Safe non-secret placeholders keep Serverless configuration resolvable so the
  // production guard can report every missing variable in one actionable error.
  awsRegionName: process.env.AWS_REGION_NAME || 'ap-southeast-1',
  serverlessDeploymentBucket: value('SERVERLESS_DEPLOYMENT_BUCKET', 'finvantage-serverless-artifacts-dev') || 'missing-production-deployment-bucket',
  s3RawBucketName: value('S3_RAW_BUCKET_NAME', value('S3_BUCKET_NAME', 'finvantage-raw-invoices-dev')) || 'missing-production-raw-bucket',
  s3BucketName: value('S3_BUCKET_NAME', value('S3_RAW_BUCKET_NAME', 'finvantage-raw-invoices-dev')) || 'missing-production-raw-bucket',
  profileAvatarBucketName: value('PROFILE_AVATAR_BUCKET_NAME', value('S3_RAW_BUCKET_NAME', 'finvantage-raw-invoices-dev')) || 'missing-production-avatar-bucket',
  useMockAi: value('USE_MOCK_AI', 'true'),
  useMockAuth: value('USE_MOCK_AUTH', 'true'),
  apiAllowedOrigin: value('API_ALLOWED_ORIGIN', 'http://localhost:5174') || 'https://missing-origin.example.invalid',
  dbHost: value('DB_HOST', 'localhost'),
  dbPort: value('DB_PORT', '5433'),
  dbName: value('DB_NAME', 'finvantage'),
  dbUser: value('DB_USER', 'postgres'),
  dbPassword: value('DB_PASSWORD', 'postgres'),
  dbSsl: value('DB_SSL', 'false'),
  dbPoolMax: value('DB_POOL_MAX', '2'),
  dbConnectionTimeoutMs: value('DB_CONNECTION_TIMEOUT_MS', '5000'),
  dbIdleTimeoutMs: value('DB_IDLE_TIMEOUT_MS', '10000'),
  dbStatementTimeoutMs: value('DB_STATEMENT_TIMEOUT_MS', '25000'),
  dbIdleTransactionTimeoutMs: value('DB_IDLE_TRANSACTION_TIMEOUT_MS', '15000'),
  dbSslCaBase64: value('DB_SSL_CA_BASE64', ''),
  // Lambda Node.js 20+ no longer loads the managed Amazon CA bundle by
  // default. Keep local empty, but make RDS/RDS Proxy certificate validation
  // work out of the box in the managed production runtime.
  nodeExtraCaCerts: value('NODE_EXTRA_CA_CERTS', '')
    || (production ? '/var/runtime/ca-cert.pem' : ''),
  dbSecretRegion: value('DB_SECRET_REGION', value('AWS_REGION_NAME', 'ap-southeast-1')),
  rdsProxyEndpoint: value('RDS_PROXY_ENDPOINT', ''),
  dbSecretArn: value('DB_SECRET_ARN', ''),
  redisUrl: redisUrlSecretArn
    ? secretReference(redisUrlSecretArn, 'redisUrl')
    : value('REDIS_URL', 'redis://localhost:6379'),
  redisKeyPrefix: value('REDIS_KEY_PREFIX', `finvantage:${stage}`),
  redisConnectTimeoutMs: value('REDIS_CONNECT_TIMEOUT_MS', '3000'),
  redisCommandTimeoutMs: value('REDIS_COMMAND_TIMEOUT_MS', '3000'),
  redisMaxReconnectAttempts: value('REDIS_MAX_RECONNECT_ATTEMPTS', '3'),
  redisReconnectBaseDelayMs: value('REDIS_RECONNECT_BASE_DELAY_MS', '100'),
  redisReconnectMaxDelayMs: value('REDIS_RECONNECT_MAX_DELAY_MS', '1000'),
  authSessionRedisUrl: value('AUTH_SESSION_REDIS_URL', ''),
  authSessionTtlSeconds: value('AUTH_SESSION_TTL_SECONDS', '86400'),
  bedrockAwsRegion: value('BEDROCK_AWS_REGION', value('AWS_REGION_NAME', 'ap-southeast-1')),
  bedrockModelId: value('BEDROCK_MODEL_ID', 'anthropic.claude-3-haiku-20240307-v1:0'),
  bedrockRoleArn: value('BEDROCK_ROLE_ARN', ''),
  bedrockRoleSessionName: value('BEDROCK_ROLE_SESSION_NAME', 'finvantage-bedrock'),
  bedrockExternalId: value('BEDROCK_EXTERNAL_ID', ''),
  cognitoUserPoolId: value('COGNITO_USER_POOL_ID', ''),
  cognitoClientId: value('COGNITO_CLIENT_ID', ''),
  cognitoClientSecret: appSecretArn
    ? secretReference(appSecretArn, 'cognitoClientSecret')
    : value('COGNITO_CLIENT_SECRET', ''),
  cognitoIssuer: value('COGNITO_ISSUER', ''),
  cognitoDomain: value('COGNITO_DOMAIN', ''),
  cognitoRedirectUri: value('COGNITO_REDIRECT_URI', 'http://localhost:5174/auth/callback'),
  cognitoLogoutUri: value('COGNITO_LOGOUT_URI', 'http://localhost:5174/'),
  cognitoScopes: value('COGNITO_SCOPES', 'openid email profile'),
  sessionSecret: appSecretArn
    ? secretReference(appSecretArn, 'sessionSecret')
    : value('SESSION_SECRET', 'local-development-session-secret-change-me'),
  appSecretArn,
  redisUrlSecretArn,
  snsTopicArn: value('SNS_BUDGET_ALERTS_TOPIC_ARN', ''),
  kmsKeyArn: value('KMS_KEY_ARN', ''),
  logLevel: value('LOG_LEVEL', 'info'),
  logRetentionDays: Number(value('LOG_RETENTION_DAYS', '30')) || 30,
  privateSubnetIds: csv('PRIVATE_SUBNET_IDS'),
  lambdaSecurityGroupIds: csv('LAMBDA_SECURITY_GROUP_IDS')
};

const logStatement = {
  Effect: 'Allow',
  Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
  Resource: 'arn:aws:logs:*:*:*'
};
const databaseSecretStatements = [
  ...(runtime.dbSecretArn ? [{ Effect: 'Allow', Action: ['secretsmanager:GetSecretValue'], Resource: runtime.dbSecretArn }] : []),
  ...(runtime.kmsKeyArn ? [{ Effect: 'Allow', Action: ['kms:Decrypt'], Resource: runtime.kmsKeyArn }] : [])
];
const vpcNetworkStatements = production ? [{
  Effect: 'Allow',
  Action: [
    'ec2:CreateNetworkInterface',
    'ec2:DescribeNetworkInterfaces',
    'ec2:DeleteNetworkInterface',
    'ec2:AssignPrivateIpAddresses',
    'ec2:UnassignPrivateIpAddresses',
    'ec2:DescribeSubnets',
    'ec2:DescribeSecurityGroups',
    'ec2:DescribeVpcs',
    'ec2:GetSecurityGroupsForVpc'
  ],
  Resource: '*'
}] : [];
const notificationStatements = runtime.snsTopicArn
  ? [{ Effect: 'Allow', Action: ['sns:Publish'], Resource: runtime.snsTopicArn }]
  : [];

const iamStatements = [
  logStatement,
  ...(runtime.s3RawBucketName ? [{
    Effect: 'Allow',
    Action: ['s3:GetObject', 's3:PutObject'],
    Resource: [`arn:aws:s3:::${runtime.s3RawBucketName}/uploads/*`]
  }] : []),
  ...(runtime.profileAvatarBucketName ? [{
    Effect: 'Allow',
    Action: ['s3:GetObject', 's3:PutObject'],
    Resource: [`arn:aws:s3:::${runtime.profileAvatarBucketName}/avatars/*`]
  }] : []),
  { Effect: 'Allow', Action: ['textract:AnalyzeExpense'], Resource: '*' },
  ...notificationStatements,
  ...databaseSecretStatements,
  ...vpcNetworkStatements
];

const analysisIamStatements = [
  logStatement,
  ...notificationStatements,
  ...(runtime.bedrockRoleArn
    ? [{ Effect: 'Allow', Action: ['sts:AssumeRole'], Resource: runtime.bedrockRoleArn }]
    : []),
  ...databaseSecretStatements,
  ...vpcNetworkStatements
];

const authIamStatements = [logStatement, ...vpcNetworkStatements];

module.exports = { runtime, iamStatements, analysisIamStatements, authIamStatements };
