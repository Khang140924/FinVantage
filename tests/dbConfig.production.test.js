import test from 'node:test';
import assert from 'node:assert/strict';

process.env.FINVANTAGE_DISABLE_DOTENV = 'true';

const {
  createDbConfig,
  DatabaseConfigurationError
} = await import('../src/config/db.config.js');

test('local database config keeps explicit local defaults', () => {
  const config = createDbConfig({ NODE_ENV: 'test' });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 5433);
  assert.equal(config.database, 'finvantage');
  assert.equal(config.user, 'postgres');
  assert.equal(config.ssl, false);
  assert.equal(config.production, false);
});

test('production requires a non-local RDS Proxy with verified TLS', () => {
  const config = createDbConfig({
    NODE_ENV: 'production',
    RDS_PROXY_ENDPOINT: 'finvantage.proxy.internal',
    DB_NAME: 'finvantage',
    DB_SECRET_ARN: 'arn:aws:secretsmanager:region:account:secret:db',
    DB_SSL: 'true'
  });
  assert.equal(config.host, 'finvantage.proxy.internal');
  assert.equal(config.usesProxy, true);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(config.pool.max, 2);
  assert.equal(config.pool.query_timeout, 25000);
  assert.equal(config.password, undefined);
});

test('production rejects localhost, missing proxy and disabled certificate verification', () => {
  const common = {
    NODE_ENV: 'production',
    DB_NAME: 'finvantage',
    DB_SECRET_ARN: 'arn:aws:secretsmanager:region:account:secret:db',
    DB_SSL: 'true'
  };
  assert.throws(() => createDbConfig(common), DatabaseConfigurationError);
  assert.throws(() => createDbConfig({
    ...common,
    RDS_PROXY_ENDPOINT: 'localhost'
  }), /local database endpoint/i);
  assert.throws(() => createDbConfig({
    ...common,
    RDS_PROXY_ENDPOINT: 'finvantage.proxy.internal',
    DB_SSL_REJECT_UNAUTHORIZED: 'false'
  }), /verification cannot be disabled/i);
});

test('pool values are bounded and RDS Proxy wins over DB_HOST', () => {
  const config = createDbConfig({
    NODE_ENV: 'development',
    RDS_PROXY_ENDPOINT: 'proxy.internal',
    DB_HOST: 'database.internal',
    DB_POOL_MAX: '999',
    DB_CONNECTION_TIMEOUT_MS: '1',
    DB_QUERY_TIMEOUT_MS: '999999'
  });
  assert.equal(config.host, 'proxy.internal');
  assert.equal(config.pool.max, 20);
  assert.equal(config.pool.connectionTimeoutMillis, 250);
  assert.equal(config.pool.query_timeout, 120000);
});

test('runtime query timeout prefers its client-side setting and preserves the legacy fallback', () => {
  const explicit = createDbConfig({
    NODE_ENV: 'test',
    DB_QUERY_TIMEOUT_MS: '12000',
    DB_STATEMENT_TIMEOUT_MS: '30000'
  });
  const fallback = createDbConfig({
    NODE_ENV: 'test',
    DB_STATEMENT_TIMEOUT_MS: '18000'
  });
  assert.equal(explicit.pool.query_timeout, 12000);
  assert.equal(explicit.pool.statement_timeout, 30000);
  assert.equal(fallback.pool.query_timeout, 18000);
});

test('serverless-offline remains local even when Lambda-like variables are present', () => {
  const config = createDbConfig({
    IS_OFFLINE: 'true',
    AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs20.x',
    DB_HOST: '127.0.0.1',
    DB_PORT: '5433'
  });
  assert.equal(config.production, false);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.ssl, false);
});
