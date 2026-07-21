import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

process.env.FINVANTAGE_DISABLE_DOTENV = 'true';

const {
  createDeferredPgPool,
  createRuntimePgPoolOptions
} = await import('../src/services/db.service.js');

const unsupportedStartupKeys = [
  'statement_timeout',
  'idle_in_transaction_session_timeout',
  'lock_timeout',
  'options',
  'replication',
  'application_name'
];

const unsupportedStartupEnvironment = [
  'PGOPTIONS',
  'PGREPLICATION',
  'PGSTATEMENTTIMEOUT',
  'PGSTATEMENT_TIMEOUT',
  'PGLOCKTIMEOUT',
  'PGLOCK_TIMEOUT',
  'PGIDLE_IN_TRANSACTION_SESSION_TIMEOUT',
  'PGAPPNAME'
];

test('PostgreSQL pool resolves credentials lazily once before first use', async () => {
  let resolutions = 0;
  let constructions = 0;
  let receivedOptions;
  class FakePool {
    constructor(options) {
      constructions += 1;
      receivedOptions = options;
    }
    on() {}
    async query(text, values) {
      return { rows: [{ text, values }] };
    }
    async end() {}
  }
  const pool = createDeferredPgPool({
    baseConfig: { marker: true },
    resolveConfig: async () => {
      resolutions += 1;
      return {
        host: 'proxy.internal',
        port: 5432,
        database: 'finvantage',
        user: 'app_user',
        password: 'runtime-password',
        ssl: { rejectUnauthorized: true },
        pool: {
          max: 2,
          idleTimeoutMillis: 10000,
          connectionTimeoutMillis: 5000,
          query_timeout: 25000,
          statement_timeout: 25000,
          idle_in_transaction_session_timeout: 15000,
          lock_timeout: 5000,
          options: '-c search_path=public',
          replication: 'database'
        },
        applicationName: 'finvantage-production'
      };
    },
    PoolClass: FakePool
  });

  assert.equal(resolutions, 0);
  await Promise.all([pool.query('SELECT 1'), pool.query('SELECT 2')]);
  assert.equal(resolutions, 1);
  assert.equal(constructions, 1);
  assert.equal(receivedOptions.host, 'proxy.internal');
  assert.deepEqual(receivedOptions.ssl, { rejectUnauthorized: true });
  assert.equal(receivedOptions.max, 2);
  assert.equal(receivedOptions.query_timeout, 25000);
  assert.deepEqual(Object.keys(receivedOptions).sort(), [
    'connectionTimeoutMillis',
    'database',
    'host',
    'idleTimeoutMillis',
    'max',
    'password',
    'port',
    'query_timeout',
    'ssl',
    'user'
  ]);
  for (const key of unsupportedStartupKeys) {
    assert.equal(Object.hasOwn(receivedOptions, key), false);
  }
  await pool.end();
});

test('runtime pool removes ambient PostgreSQL startup parameters before clients are created', async () => {
  const originalEnvironment = new Map(
    unsupportedStartupEnvironment.map((name) => [name, process.env[name]])
  );
  let receivedOptions;
  let environmentAtConstruction;

  for (const name of unsupportedStartupEnvironment) {
    process.env[name] = `unsafe-${name.toLowerCase()}`;
  }

  class FakePool {
    constructor(options) {
      receivedOptions = options;
      environmentAtConstruction = Object.fromEntries(
        unsupportedStartupEnvironment.map((name) => [name, process.env[name]])
      );
    }
    on() {}
    async query() {
      return { rows: [] };
    }
    async end() {}
  }

  try {
    const pool = createDeferredPgPool({
      resolveConfig: async () => ({
        host: 'proxy.internal',
        port: 5432,
        database: 'finvantage',
        user: 'app_user',
        password: 'test-password',
        ssl: { rejectUnauthorized: true },
        pool: {
          max: 2,
          idleTimeoutMillis: 10000,
          connectionTimeoutMillis: 5000,
          query_timeout: 25000
        }
      }),
      PoolClass: FakePool
    });

    await pool.query('SELECT 1');
    assert.deepEqual(
      environmentAtConstruction,
      Object.fromEntries(unsupportedStartupEnvironment.map((name) => [name, undefined]))
    );

    const startupConfig = new pg.Client(receivedOptions).getStartupConf();
    assert.deepEqual(startupConfig, {
      user: 'app_user',
      database: 'finvantage'
    });
    assert.equal(receivedOptions.query_timeout, 25000);
    await pool.end();
  } finally {
    for (const [name, value] of originalEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('runtime pool omits an invalid client-side query timeout', () => {
  const options = createRuntimePgPoolOptions({
    host: 'proxy.internal',
    pool: {
      max: 2,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      query_timeout: 0
    }
  });
  assert.equal(Object.hasOwn(options, 'query_timeout'), false);
});

test('ending an unused deferred pool does not resolve credentials or connect', async () => {
  let resolutions = 0;
  const pool = createDeferredPgPool({
    resolveConfig: async () => {
      resolutions += 1;
      return {};
    },
    PoolClass: class {}
  });
  await pool.end();
  assert.equal(resolutions, 0);
  await assert.rejects(pool.query('SELECT 1'), { code: 'DATABASE_POOL_CLOSED' });
});
