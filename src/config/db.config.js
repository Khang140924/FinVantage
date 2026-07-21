import dotenv from 'dotenv';

const shouldLoadDotenv = process.env.FINVANTAGE_DISABLE_DOTENV !== 'true'
  && !process.env.AWS_LAMBDA_FUNCTION_NAME
  && !process.env.AWS_EXECUTION_ENV;

if (shouldLoadDotenv) dotenv.config();

export class DatabaseConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatabaseConfigurationError';
    this.code = 'DATABASE_CONFIGURATION_ERROR';
  }
}

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
};

const readBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
};

const normalizedStage = (env) => String(
  env.APP_STAGE || env.STAGE || env.NODE_ENV || ''
).trim().toLowerCase();

export const isProductionDatabaseRuntime = (env = process.env) => Boolean(
  String(env.IS_OFFLINE || env.SLS_OFFLINE || '').toLowerCase() !== 'true'
  && (
    env.AWS_LAMBDA_FUNCTION_NAME
    || env.AWS_EXECUTION_ENV
    || ['prod', 'production'].includes(normalizedStage(env))
  )
);

const isLocalHost = (host) => {
  const normalized = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(normalized);
};

const resolveCertificateAuthority = (env) => {
  const inline = String(env.DB_SSL_CA || '').trim();
  if (inline) return inline.replace(/\\n/g, '\n');

  const encoded = String(env.DB_SSL_CA_BASE64 || '').trim();
  if (!encoded) return undefined;
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8').trim();
    if (!decoded.includes('BEGIN CERTIFICATE')) throw new Error('Invalid certificate');
    return decoded;
  } catch {
    throw new DatabaseConfigurationError('DB_SSL_CA_BASE64 is not a valid PEM certificate.');
  }
};

export const createDbConfig = (env = process.env) => {
  const production = isProductionDatabaseRuntime(env);
  const proxyEndpoint = String(env.RDS_PROXY_ENDPOINT || '').trim();
  const configuredHost = String(env.DB_HOST || '').trim();
  const host = proxyEndpoint || configuredHost || (production ? '' : '127.0.0.1');
  const port = clampInteger(env.DB_PORT, production ? 5432 : 5433, 1, 65535);
  const database = String(env.DB_NAME || (production ? '' : 'finvantage')).trim();
  const user = String(env.DB_USER || (production ? '' : 'postgres')).trim();
  const password = env.DB_PASSWORD ?? (production ? undefined : 'postgres');
  const secretArn = String(env.DB_SECRET_ARN || '').trim() || null;
  const sslEnabled = readBoolean(env.DB_SSL, production);
  const rejectUnauthorized = readBoolean(env.DB_SSL_REJECT_UNAUTHORIZED, true);

  if (production) {
    if (!host) throw new DatabaseConfigurationError('RDS_PROXY_ENDPOINT is required in production.');
    if (!proxyEndpoint) {
      throw new DatabaseConfigurationError('RDS_PROXY_ENDPOINT is required in production.');
    }
    if (isLocalHost(host)) {
      throw new DatabaseConfigurationError('A local database endpoint is not allowed in production.');
    }
    if (!database) throw new DatabaseConfigurationError('DB_NAME is required in production.');
    if (!secretArn && (!user || !password)) {
      throw new DatabaseConfigurationError('DB_SECRET_ARN or DB_USER and DB_PASSWORD is required in production.');
    }
    if (!sslEnabled) throw new DatabaseConfigurationError('DB_SSL=true is required in production.');
    if (!rejectUnauthorized) {
      throw new DatabaseConfigurationError('Production database TLS certificate verification cannot be disabled.');
    }
  }

  const ca = sslEnabled ? resolveCertificateAuthority(env) : undefined;
  const stage = normalizedStage(env) || (production ? 'production' : 'local');

  return Object.freeze({
    host,
    port,
    database,
    user: user || undefined,
    password,
    secretArn,
    secretRegion: String(env.DB_SECRET_REGION || env.AWS_REGION || env.AWS_REGION_NAME || '').trim() || undefined,
    ssl: sslEnabled ? {
      rejectUnauthorized: true,
      ...(ca ? { ca } : {})
    } : false,
    pool: Object.freeze({
      max: clampInteger(env.DB_POOL_MAX, production ? 2 : 10, 1, 20),
      idleTimeoutMillis: clampInteger(
        env.DB_POOL_IDLE_TIMEOUT_MS ?? env.DB_IDLE_TIMEOUT_MS,
        production ? 10000 : 30000,
        1000,
        300000
      ),
      connectionTimeoutMillis: clampInteger(env.DB_CONNECTION_TIMEOUT_MS, 5000, 250, 30000),
      query_timeout: clampInteger(
        env.DB_QUERY_TIMEOUT_MS ?? env.DB_STATEMENT_TIMEOUT_MS,
        25000,
        1000,
        120000
      ),
      statement_timeout: clampInteger(env.DB_STATEMENT_TIMEOUT_MS, 25000, 1000, 120000),
      idle_in_transaction_session_timeout: clampInteger(
        env.DB_IDLE_TRANSACTION_TIMEOUT_MS,
        15000,
        1000,
        120000
      )
    }),
    applicationName: `finvantage-${stage}`,
    production,
    usesProxy: Boolean(proxyEndpoint)
  });
};

export const dbConfig = createDbConfig();

// Backward-compatible metadata export. Redis connection creation lives in
// shared/redisClient.js so the API pipeline and Auth BFF use identical policy.
export const redisConfig = Object.freeze({
  url: process.env.REDIS_URL,
  urlConfigured: Boolean(process.env.REDIS_URL)
});
