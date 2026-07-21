const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function assertLocalIntegrationEnvironment(env = process.env) {
  if (env.ALLOW_LOCAL_DB_TESTS !== 'true') {
    throw new Error('Set ALLOW_LOCAL_DB_TESTS=true to run local PostgreSQL integration tests.');
  }
  if (!LOOPBACK_HOSTS.has(String(env.DB_HOST || '').trim().toLowerCase())) {
    throw new Error('Local integration tests only permit a loopback PostgreSQL host.');
  }
  if (String(env.DB_PORT || '') !== '5433') {
    throw new Error('Local integration tests only permit PostgreSQL host port 5433.');
  }
  if (String(env.DB_NAME || '') !== 'finvantage' || env.DB_SSL === 'true') {
    throw new Error('Local integration tests require the non-TLS finvantage database.');
  }
  if (env.AWS_EXECUTION_ENV || env.AWS_LAMBDA_FUNCTION_NAME) {
    throw new Error('Local integration tests cannot run in an AWS Lambda runtime.');
  }
}
