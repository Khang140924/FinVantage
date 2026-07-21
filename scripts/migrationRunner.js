import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const MIGRATION_FILE_PATTERN = /^\d{8}_[a-z0-9][a-z0-9_-]*\.sql$/;
export const MIGRATION_LOCK_NAME = 'finvantage-schema-migrations-v1';

export const MIGRATION_LEDGER_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(255) PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'applied', 'failed')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_at TIMESTAMPTZ,
    error_code VARCHAR(100)
  )
`;

export class MigrationValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationValidationError';
    this.code = 'MIGRATION_VALIDATION_FAILED';
  }
}

export class MigrationExecutionError extends Error {
  constructor(migrationName, cause) {
    super(`Migration failed: ${migrationName}`);
    this.name = 'MigrationExecutionError';
    this.code = 'MIGRATION_EXECUTION_FAILED';
    this.migrationName = migrationName;
    this.cause = cause;
  }
}

const normalizeSql = (sql) => String(sql || '')
  .replace(/^\uFEFF/, '')
  .replace(/\r\n?/g, '\n')
  .trim();

export const checksumSql = (sql) => createHash('sha256')
  .update(`${normalizeSql(sql)}\n`, 'utf8')
  .digest('hex');

export const stripOuterTransaction = (sql) => {
  const normalized = normalizeSql(sql);
  const match = normalized.match(/^BEGIN\s*;([\s\S]*)COMMIT\s*;$/i);
  return match ? match[1].trim() : normalized;
};

export const validateMigration = ({ name, sql }) => {
  if (!MIGRATION_FILE_PATTERN.test(name) && name !== '00000000_schema.sql') {
    throw new MigrationValidationError(`Invalid migration filename: ${name}`);
  }
  const normalized = normalizeSql(sql);
  if (!normalized) throw new MigrationValidationError(`Migration is empty: ${name}`);
  if (/^\s*\\/m.test(normalized)) {
    throw new MigrationValidationError(`psql meta-commands are not allowed: ${name}`);
  }
  if (/\b(?:CREATE|DROP)\s+DATABASE\b|\bALTER\s+SYSTEM\b|\bCOPY\b[\s\S]*?\bPROGRAM\b/i.test(normalized)) {
    throw new MigrationValidationError(`Unsafe database-level command in migration: ${name}`);
  }

  const executableSql = stripOuterTransaction(normalized);
  if (/\b(?:BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK)\s*;/i.test(executableSql)) {
    throw new MigrationValidationError(`Transaction control must be managed by the runner: ${name}`);
  }

  return Object.freeze({
    name,
    sql: executableSql,
    checksum: checksumSql(normalized)
  });
};

export const validateMigrationOrder = (migrations) => {
  const names = migrations.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
    throw new MigrationValidationError('Migration filenames must be unique.');
  }
  const expected = [...names].sort((a, b) => a.localeCompare(b, 'en'));
  if (names.some((name, index) => name !== expected[index])) {
    throw new MigrationValidationError('Migrations must be ordered lexicographically.');
  }
  return migrations;
};

export const loadMigrationPlan = async ({
  rootDir,
  includeBaseline = false,
  readFileImpl = readFile,
  readdirImpl = readdir
}) => {
  const migrationDir = path.join(rootDir, 'migrations');
  const entries = await readdirImpl(migrationDir, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en'));

  const migrations = [];
  if (includeBaseline) {
    const sql = await readFileImpl(path.join(rootDir, 'schema.sql'), 'utf8');
    migrations.push(validateMigration({ name: '00000000_schema.sql', sql }));
  }
  for (const name of filenames) {
    const sql = await readFileImpl(path.join(migrationDir, name), 'utf8');
    migrations.push(validateMigration({ name, sql }));
  }
  return validateMigrationOrder(migrations);
};

const safeFailureCode = (error) => String(error?.code || error?.name || 'MIGRATION_FAILED')
  .replace(/[^A-Za-z0-9_.-]/g, '_')
  .slice(0, 100);

const MAX_POSTGRES_TIMEOUT_MS = 2_147_483_647;
const SAFE_ERROR_FIELDS = Object.freeze([
  'message',
  'detail',
  'hint',
  'where',
  'schema',
  'table',
  'constraint'
]);

export const UNSUPPORTED_RDS_PROXY_STARTUP_ENV = Object.freeze([
  'PGOPTIONS',
  'PGREPLICATION',
  'PGSTATEMENT_TIMEOUT',
  'PGLOCK_TIMEOUT',
  'PGIDLE_IN_TRANSACTION_SESSION_TIMEOUT'
]);

const validTimeoutMilliseconds = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_POSTGRES_TIMEOUT_MS
    ? parsed
    : null;
};

export const removeUnsupportedRdsProxyStartupEnvironment = (env = process.env) => {
  for (const name of UNSUPPORTED_RDS_PROXY_STARTUP_ENV) delete env[name];
  return env;
};

export const createMigrationPoolConfig = (config = {}) => {
  const pool = config.pool || {};
  const queryTimeout = validTimeoutMilliseconds(
    pool.query_timeout ?? pool.queryTimeoutMillis
  );
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
    max: 1,
    connectionTimeoutMillis: pool.connectionTimeoutMillis,
    ...(queryTimeout ? { query_timeout: queryTimeout } : {})
  };
};

export const configureMigrationSession = async (client, config = {}) => {
  const pool = config.pool || {};
  const settings = [
    ['statement_timeout', validTimeoutMilliseconds(pool.statement_timeout)],
    [
      'idle_in_transaction_session_timeout',
      validTimeoutMilliseconds(pool.idle_in_transaction_session_timeout)
    ]
  ];

  const applicationName = String(config.applicationName || '').trim();
  if (applicationName && applicationName.length <= 63) {
    await client.query(
      "SELECT set_config('application_name', $1, false)",
      [`${applicationName}-migration`.slice(0, 63)]
    );
  }
  for (const [name, timeout] of settings) {
    if (!timeout) continue;
    await client.query(
      `SELECT set_config('${name}', $1, false)`,
      [String(timeout)]
    );
  }
};

const escapeRegularExpression = (value) => String(value)
  .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const sanitizeMigrationErrorText = (value, sensitiveValues = []) => {
  let sanitized = String(value ?? '');
  const knownValues = [...new Set(sensitiveValues
    .map((item) => String(item ?? ''))
    .filter((item) => item.length >= 3))]
    .sort((left, right) => right.length - left.length);

  for (const sensitiveValue of knownValues) {
    sanitized = sanitized.replace(
      new RegExp(escapeRegularExpression(sensitiveValue), 'g'),
      '[REDACTED]'
    );
  }

  return sanitized
    .replace(/(postgres(?:ql)?:\/\/)([^@\s/]+)@/gi, '$1[REDACTED]@')
    .replace(/\barn:(?:aws|aws-us-gov|aws-cn):secretsmanager:[^\s,;'"}]+/gi, '[REDACTED_SECRET_ARN]')
    .replace(
      /\b(password|passwd|pwd|secret(?:string)?|username|user)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1=[REDACTED]'
    )
    .slice(0, 2000);
};

export const safeMigrationErrorFields = (error, { sensitiveValues = [] } = {}) => {
  const source = error?.cause && (error.cause.code || error.cause.message)
    ? error.cause
    : error;
  const rawCode = String(source?.code || error?.code || 'MIGRATION_FAILED');
  const result = {
    code: /^[A-Za-z0-9_.-]{1,100}$/.test(rawCode) ? rawCode : 'MIGRATION_FAILED',
    message: sanitizeMigrationErrorText(
      source?.message || error?.message || 'Migration failed.',
      sensitiveValues
    )
  };
  for (const field of SAFE_ERROR_FIELDS.slice(1)) {
    if (source?.[field] === undefined || source[field] === null || source[field] === '') continue;
    result[field] = sanitizeMigrationErrorText(source[field], sensitiveValues);
  }
  if (error?.migrationName) {
    result.migration = sanitizeMigrationErrorText(error.migrationName, sensitiveValues);
  }
  return result;
};

export const runMigrationPlan = async ({ client, migrations, logger = console }) => {
  validateMigrationOrder(migrations);
  await client.query(MIGRATION_LEDGER_SQL);

  const lock = await client.query(
    'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
    [MIGRATION_LOCK_NAME]
  );
  if (!lock.rows?.[0]?.acquired) {
    throw new MigrationExecutionError('migration-lock', { code: 'MIGRATION_LOCK_UNAVAILABLE' });
  }

  const results = [];
  try {
    const ledger = await client.query(
      'SELECT name, checksum, status FROM schema_migrations ORDER BY name'
    );
    const existing = new Map(ledger.rows.map((row) => [row.name, row]));
    const plannedNames = new Set(migrations.map(({ name }) => name));
    const missingRecordedMigration = ledger.rows.find((row) => (
      row.name !== '00000000_schema.sql'
      && MIGRATION_FILE_PATTERN.test(row.name)
      && !plannedNames.has(row.name)
    ));
    if (missingRecordedMigration) {
      throw new MigrationValidationError(
        `Recorded migration is missing from the current plan: ${missingRecordedMigration.name}`
      );
    }

    for (const migration of migrations) {
      const previous = existing.get(migration.name);
      if (previous && previous.checksum !== migration.checksum) {
        throw new MigrationValidationError(`Checksum mismatch for applied migration: ${migration.name}`);
      }
      if (previous?.status === 'applied') {
        results.push({ name: migration.name, status: 'skipped' });
        logger.info?.('Migration already applied', { name: migration.name });
        continue;
      }
      if (previous?.status === 'running') {
        throw new MigrationValidationError(`Migration is marked running and requires review: ${migration.name}`);
      }

      await client.query(`
        INSERT INTO schema_migrations (name, checksum, status, started_at, applied_at, error_code)
        VALUES ($1, $2, 'running', NOW(), NULL, NULL)
        ON CONFLICT (name) DO UPDATE SET
          checksum = EXCLUDED.checksum,
          status = 'running',
          started_at = NOW(),
          applied_at = NULL,
          error_code = NULL
      `, [migration.name, migration.checksum]);

      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(`
          UPDATE schema_migrations
          SET status = 'applied', applied_at = NOW(), error_code = NULL
          WHERE name = $1 AND checksum = $2
        `, [migration.name, migration.checksum]);
        await client.query('COMMIT');
        results.push({ name: migration.name, status: 'applied' });
        logger.info?.('Migration applied', { name: migration.name });
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the original migration failure.
        }
        try {
          await client.query(`
            INSERT INTO schema_migrations (name, checksum, status, started_at, applied_at, error_code)
            VALUES ($1, $2, 'failed', NOW(), NULL, $3)
            ON CONFLICT (name) DO UPDATE SET
              checksum = EXCLUDED.checksum,
              status = 'failed',
              applied_at = NULL,
              error_code = EXCLUDED.error_code
          `, [migration.name, migration.checksum, safeFailureCode(error)]);
        } catch {
          // A broken connection can prevent status persistence; preserve the
          // original migration error and leave the running row for review.
        }
        throw new MigrationExecutionError(migration.name, error);
      }
    }
    return results;
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_NAME]);
    } catch {
      // PostgreSQL releases session advisory locks when the connection closes.
    }
  }
};
