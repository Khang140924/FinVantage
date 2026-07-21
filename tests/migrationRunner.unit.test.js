import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

import {
  checksumSql,
  configureMigrationSession,
  createMigrationPoolConfig,
  loadMigrationPlan,
  MigrationExecutionError,
  MigrationValidationError,
  removeUnsupportedRdsProxyStartupEnvironment,
  runMigrationPlan,
  safeMigrationErrorFields,
  stripOuterTransaction,
  validateMigration
} from '../scripts/migrationRunner.js';

const rootDir = path.resolve('.');

test('migration plan validates deterministic order, checksum and optional baseline', async () => {
  const plan = await loadMigrationPlan({ rootDir, includeBaseline: true });
  assert.equal(plan[0].name, '00000000_schema.sql');
  assert.match(plan[0].checksum, /^[a-f0-9]{64}$/);
  assert.ok(plan.some(({ name }) => name === '20260721_harden_invoice_user_identity.sql'));
  assert.equal(plan.every(({ sql }) => !/^BEGIN\s*;/i.test(sql)), true);
  assert.match(plan[0].sql, /CREATE TABLE IF NOT EXISTS schema_migrations/i);
  assert.doesNotMatch(plan[0].sql, /user_id\s+VARCHAR\(100\)\s+NOT NULL\s+DEFAULT\s+'demo-user'/i);
});

test('migration CLI requires explicit apply and production confirmations', async () => {
  const source = await readFile(path.join(rootDir, 'scripts', 'migrate.js'), 'utf8');
  assert.match(source, /--confirm-apply=\$\{applyConfirmation\}/);
  assert.match(source, /--confirm-production=\$\{productionConfirmation\}/);
  assert.match(source, /process\.env\.FINVANTAGE_DISABLE_DOTENV\s*=\s*'true'/);
  assert.match(source, /new pg\.Pool\(createMigrationPoolConfig\(config\)\)/);
  assert.match(source, /await configureMigrationSession\(client, config\)/);
  assert.doesNotMatch(source, /new pg\.Pool\(\{[\s\S]*statement_timeout/);
});

test('RDS Proxy migration connection excludes unsupported startup parameters', async () => {
  const config = createMigrationPoolConfig({
    host: 'proxy.internal',
    port: 5432,
    database: 'finvantage',
    user: 'migration_user',
    password: 'unit-test-password',
    ssl: { rejectUnauthorized: true },
    usesProxy: true,
    applicationName: 'finvantage-production',
    options: '-c statement_timeout=1',
    replication: 'database',
    pool: {
      connectionTimeoutMillis: 5000,
      query_timeout: 20000,
      statement_timeout: 25000,
      idle_in_transaction_session_timeout: 15000,
      options: '-c statement_timeout=1',
      replication: 'database'
    }
  });

  assert.equal(config.host, 'proxy.internal');
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(config.connectionTimeoutMillis, 5000);
  assert.equal(config.query_timeout, 20000);
  for (const name of [
    'statement_timeout',
    'idle_in_transaction_session_timeout',
    'options',
    'replication',
    'application_name'
  ]) {
    assert.equal(Object.hasOwn(config, name), false, `${name} must not be a startup option`);
  }

  const ambient = {
    PGOPTIONS: '-c statement_timeout=1',
    PGREPLICATION: 'database',
    PGSTATEMENT_TIMEOUT: '1',
    PGLOCK_TIMEOUT: '1',
    PGIDLE_IN_TRANSACTION_SESSION_TIMEOUT: '1',
    SAFE_VALUE: 'preserved'
  };
  removeUnsupportedRdsProxyStartupEnvironment(ambient);
  assert.deepEqual(ambient, { SAFE_VALUE: 'preserved' });

  const savedEnvironment = {
    PGOPTIONS: process.env.PGOPTIONS,
    PGREPLICATION: process.env.PGREPLICATION,
    PGSTATEMENT_TIMEOUT: process.env.PGSTATEMENT_TIMEOUT,
    PGLOCK_TIMEOUT: process.env.PGLOCK_TIMEOUT,
    PGIDLE_IN_TRANSACTION_SESSION_TIMEOUT: process.env.PGIDLE_IN_TRANSACTION_SESSION_TIMEOUT
  };
  try {
    process.env.PGOPTIONS = '-c statement_timeout=1';
    process.env.PGREPLICATION = 'database';
    process.env.PGSTATEMENT_TIMEOUT = '1';
    process.env.PGLOCK_TIMEOUT = '1';
    process.env.PGIDLE_IN_TRANSACTION_SESSION_TIMEOUT = '1';
    removeUnsupportedRdsProxyStartupEnvironment(process.env);
    const startup = new pg.Client(config).getStartupConf();
    for (const name of [
      'statement_timeout',
      'lock_timeout',
      'idle_in_transaction_session_timeout',
      'options',
      'replication'
    ]) {
      assert.equal(Object.hasOwn(startup, name), false, `${name} reached StartupMessage`);
    }
  } finally {
    for (const [name, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('migration timeouts and application name are set only after connect', async () => {
  const calls = [];
  const client = {
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [] };
    }
  };

  await configureMigrationSession(client, {
    applicationName: 'finvantage-production',
    pool: {
      statement_timeout: 25000,
      idle_in_transaction_session_timeout: 15000
    }
  });
  assert.deepEqual(calls, [
    {
      text: "SELECT set_config('application_name', $1, false)",
      values: ['finvantage-production-migration']
    },
    {
      text: "SELECT set_config('statement_timeout', $1, false)",
      values: ['25000']
    },
    {
      text: "SELECT set_config('idle_in_transaction_session_timeout', $1, false)",
      values: ['15000']
    }
  ]);

  const invalidCalls = [];
  await configureMigrationSession({
    query: async (...args) => invalidCalls.push(args)
  }, {
    pool: {
      statement_timeout: 'invalid',
      idle_in_transaction_session_timeout: -1
    }
  });
  assert.deepEqual(invalidCalls, []);
});

test('safe migration errors preserve diagnostics and redact credentials', () => {
  const username = 'migration_admin_user';
  const password = 'unit-test-password-never-log';
  const secretArn = 'arn:aws:secretsmanager:region:000000000000:secret:unit-test';
  const cause = Object.assign(new Error(
    `RDS Proxy rejected option statement_timeout for user=${username} password=${password}`
  ), {
    code: '0A000',
    detail: `connection postgresql://${username}:${password}@proxy.internal/finvantage`,
    hint: `Read ${secretArn} and remove PGOPTIONS`,
    where: 'startup packet',
    schema: 'public',
    table: 'schema_migrations',
    constraint: 'schema_migrations_pkey'
  });
  const safe = safeMigrationErrorFields(
    new MigrationExecutionError('00000000_schema.sql', cause),
    { sensitiveValues: [username, password, secretArn] }
  );

  assert.equal(safe.code, '0A000');
  assert.match(safe.message, /RDS Proxy rejected option statement_timeout/);
  assert.equal(safe.detail.includes('postgresql://[REDACTED]@'), true);
  assert.equal(safe.migration, '00000000_schema.sql');
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes(username), false);
  assert.equal(serialized.includes(password), false);
  assert.equal(serialized.includes(secretArn), false);
  assert.equal(serialized.includes('SecretString'), false);
});

test('outer transaction is removed and unsafe database commands are rejected', () => {
  assert.equal(stripOuterTransaction('BEGIN;\nSELECT 1;\nCOMMIT;'), 'SELECT 1;');
  assert.throws(() => validateMigration({
    name: '20260721_unsafe.sql',
    sql: 'DROP DATABASE production;'
  }), MigrationValidationError);
  assert.equal(checksumSql('SELECT 1;\r\n'), checksumSql('SELECT 1;\n'));
});

const createMigrationClient = ({ ledgerRows = [], failSql = null } = {}) => {
  const calls = [];
  const client = {
    calls,
    query: async (text, values = []) => {
      const normalized = String(text).replace(/\s+/g, ' ').trim();
      calls.push({ text: normalized, values });
      if (normalized.startsWith('SELECT pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
      if (normalized.startsWith('SELECT name, checksum, status')) return { rows: ledgerRows };
      if (normalized.startsWith('SELECT pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
      if (failSql && normalized === failSql) {
        throw Object.assign(new Error('database detail must not enter ledger'), { code: 'XX001' });
      }
      return { rows: [] };
    }
  };
  return client;
};

test('runner records status and applies each migration in its own transaction', async () => {
  const migration = validateMigration({
    name: '20260721_test_success.sql',
    sql: 'SELECT 1;'
  });
  const client = createMigrationClient();
  const results = await runMigrationPlan({
    client,
    migrations: [migration],
    logger: { info() {} }
  });
  assert.deepEqual(results, [{ name: migration.name, status: 'applied' }]);
  assert.ok(client.calls.some(({ text }) => text === 'BEGIN'));
  assert.ok(client.calls.some(({ text }) => text === 'COMMIT'));
  assert.ok(client.calls.some(({ text }) => text.includes("SET status = 'applied'")));
});

test('runner refuses checksum drift and records a sanitized failure code', async () => {
  const migration = validateMigration({
    name: '20260721_test_failure.sql',
    sql: 'SELECT broken;'
  });
  await assert.rejects(runMigrationPlan({
    client: createMigrationClient({
      ledgerRows: [{ name: migration.name, checksum: '0'.repeat(64), status: 'applied' }]
    }),
    migrations: [migration],
    logger: { info() {} }
  }), MigrationValidationError);

  const failingClient = createMigrationClient({ failSql: 'SELECT broken;' });
  await assert.rejects(runMigrationPlan({
    client: failingClient,
    migrations: [migration],
    logger: { info() {} }
  }), MigrationExecutionError);
  assert.ok(failingClient.calls.some(({ text }) => text === 'ROLLBACK'));
  const failureWrite = failingClient.calls.find(({ text, values }) => (
    text.startsWith('INSERT INTO schema_migrations')
    && text.includes("'failed'")
    && values.length === 3
  ));
  assert.equal(failureWrite.values[2], 'XX001');
  assert.equal(JSON.stringify(failureWrite).includes('database detail'), false);
});

test('runner refuses removal of a migration already recorded in the ledger', async () => {
  const migration = validateMigration({
    name: '20260721_present.sql',
    sql: 'SELECT 1;'
  });
  const client = createMigrationClient({
    ledgerRows: [{
      name: '20260720_missing.sql',
      checksum: 'a'.repeat(64),
      status: 'applied'
    }]
  });
  await assert.rejects(
    runMigrationPlan({ client, migrations: [migration], logger: { info() {} } }),
    /missing from the current plan/i
  );
  assert.ok(client.calls.some(({ text }) => text.startsWith('SELECT pg_advisory_unlock')));
});
