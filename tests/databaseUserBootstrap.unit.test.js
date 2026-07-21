import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import {
  bootstrapApplicationDatabaseRole,
  configureDatabaseRoleBootstrapSession,
  createDatabaseRoleBootstrapConnectionConfig,
  DATABASE_ROLE_BOOTSTRAP_STARTUP_ENV,
  removeDatabaseRoleBootstrapStartupEnvironment,
  databaseRoleBootstrapSql
} from '../scripts/databaseUserBootstrap.js';

test('database role bootstrap uses an RDS Proxy startup-safe client config', async () => {
  const source = await readFile(
    new URL('../scripts/bootstrapDatabaseUser.js', import.meta.url),
    'utf8'
  );
  assert.match(source, /new pg\.Client\(createDatabaseRoleBootstrapConnectionConfig\(adminConfig\)\)/);
  assert.doesNotMatch(source, /new pg\.Pool/);
  assert.ok(
    source.indexOf('removeDatabaseRoleBootstrapStartupEnvironment(process.env)')
      < source.indexOf('new pg.Client')
  );
  assert.ok(
    source.indexOf('await client.connect()')
      < source.lastIndexOf('await configureDatabaseRoleBootstrapSession')
  );

  const config = createDatabaseRoleBootstrapConnectionConfig({
    host: 'proxy.internal',
    port: 5432,
    database: 'finvantage',
    user: 'finvantage_admin',
    password: 'unit-test-password',
    ssl: { rejectUnauthorized: true },
    applicationName: 'finvantage-production',
    statement_timeout: 1,
    idle_in_transaction_session_timeout: 1,
    lock_timeout: 1,
    options: '-c statement_timeout=1',
    replication: 'database',
    pool: {
      connectionTimeoutMillis: 5000,
      query_timeout: 20000,
      statement_timeout: 25000,
      idle_in_transaction_session_timeout: 15000,
      lock_timeout: 5000,
      options: '-c statement_timeout=1',
      replication: 'database'
    }
  });
  assert.deepEqual(Object.keys(config).sort(), [
    'connectionTimeoutMillis',
    'database',
    'host',
    'password',
    'port',
    'query_timeout',
    'ssl',
    'user'
  ]);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(config.query_timeout, 20000);

  const savedEnvironment = Object.fromEntries(
    DATABASE_ROLE_BOOTSTRAP_STARTUP_ENV.map((name) => [name, process.env[name]])
  );
  try {
    for (const name of DATABASE_ROLE_BOOTSTRAP_STARTUP_ENV) process.env[name] = 'unsafe-test-value';
    process.env.PGREPLICATION = 'database';
    removeDatabaseRoleBootstrapStartupEnvironment(process.env);
    const startup = new pg.Client(config).getStartupConf();
    for (const name of [
      'statement_timeout',
      'idle_in_transaction_session_timeout',
      'lock_timeout',
      'options',
      'replication',
      'application_name'
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

test('database role bootstrap configures application name and timeouts after connect', async () => {
  const calls = [];
  await configureDatabaseRoleBootstrapSession({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [] };
    }
  }, {
    applicationName: 'finvantage-production',
    pool: {
      statement_timeout: 25000,
      lock_timeout: 5000,
      idle_in_transaction_session_timeout: 15000
    }
  });

  assert.deepEqual(calls, [
    {
      text: "SELECT set_config('application_name', $1, false)",
      values: ['finvantage-production-role-bootstrap']
    },
    {
      text: "SELECT set_config('statement_timeout', $1, false)",
      values: ['25000']
    },
    {
      text: "SELECT set_config('lock_timeout', $1, false)",
      values: ['5000']
    },
    {
      text: "SELECT set_config('idle_in_transaction_session_timeout', $1, false)",
      values: ['15000']
    }
  ]);

  const invalidCalls = [];
  await configureDatabaseRoleBootstrapSession({
    query: async (...args) => invalidCalls.push(args)
  }, {
    pool: {
      statement_timeout: 'invalid',
      lock_timeout: 0,
      idle_in_transaction_session_timeout: -1
    }
  });
  assert.deepEqual(invalidCalls, []);
});

test('database role bootstrap parameterizes credentials and grants only runtime data access', async () => {
  const calls = [];
  const client = {
    query: async (text, values = []) => {
      calls.push({ text, values });
      return { rows: [] };
    }
  };
  const password = 'unit-test-password-never-in-sql';
  await bootstrapApplicationDatabaseRole({ client, username: 'finvantage_app', password });

  assert.deepEqual(calls.map(({ text }) => text), [
    'BEGIN',
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    "SELECT set_config('finvantage.app_user', $1, true), set_config('finvantage.app_password', $2, true)",
    databaseRoleBootstrapSql,
    'COMMIT'
  ]);
  assert.ok(calls.every(({ text }) => !text.includes(password)));
  assert.match(databaseRoleBootstrapSql, /NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION/);
  assert.match(databaseRoleBootstrapSql, /GRANT SELECT, INSERT, UPDATE, DELETE/);
  assert.doesNotMatch(databaseRoleBootstrapSql, /\bGRANT\s+ALL\b|\bWITH\s+SUPERUSER\b/i);
});

test('database role bootstrap rolls back and returns a sanitized error', async () => {
  const calls = [];
  const client = {
    query: async (text) => {
      calls.push(text);
      if (text === databaseRoleBootstrapSql) throw new Error('raw database detail');
      return { rows: [] };
    }
  };
  await assert.rejects(
    bootstrapApplicationDatabaseRole({
      client,
      username: 'finvantage_app',
      password: 'unit-test-password-never-in-sql'
    }),
    (error) => error.code === 'DATABASE_ROLE_BOOTSTRAP_FAILED'
      && !error.message.includes('raw database detail')
  );
  assert.equal(calls.at(-1), 'ROLLBACK');
});
