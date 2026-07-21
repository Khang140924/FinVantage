export const DATABASE_ROLE_BOOTSTRAP_LOCK = 'finvantage-db-role-bootstrap-v1';

const APPLICATION_ROLE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;
const MAX_POSTGRES_TIMEOUT_MS = 2_147_483_647;

export const DATABASE_ROLE_BOOTSTRAP_STARTUP_ENV = Object.freeze([
  'PGOPTIONS',
  'PGREPLICATION',
  'PGSTATEMENTTIMEOUT',
  'PGSTATEMENT_TIMEOUT',
  'PGLOCKTIMEOUT',
  'PGLOCK_TIMEOUT',
  'PGIDLE_IN_TRANSACTION_SESSION_TIMEOUT',
  'PGAPPNAME'
]);

export class DatabaseRoleBootstrapError extends Error {
  constructor(code = 'DATABASE_ROLE_BOOTSTRAP_FAILED') {
    super('Database application-role bootstrap failed.');
    this.name = 'DatabaseRoleBootstrapError';
    this.code = code;
  }
}

const BOOTSTRAP_ROLE_SQL = `
DO $finvantage_bootstrap$
DECLARE
  app_user text := current_setting('finvantage.app_user', true);
  app_password text := current_setting('finvantage.app_password', true);
BEGIN
  IF app_user IS NULL OR app_password IS NULL THEN
    RAISE EXCEPTION 'Application role settings are missing';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_user) THEN
    EXECUTE format(
      'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
      app_user,
      app_password
    );
  ELSE
    EXECUTE format(
      'CREATE ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
      app_user,
      app_password
    );
  END IF;

  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), app_user);
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app_user);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', app_user);
  EXECUTE format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %I', app_user);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
    current_user,
    app_user
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I',
    current_user,
    app_user
  );
END
$finvantage_bootstrap$;
`;

const validTimeoutMilliseconds = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_POSTGRES_TIMEOUT_MS
    ? parsed
    : null;
};

export const removeDatabaseRoleBootstrapStartupEnvironment = (env = process.env) => {
  for (const name of DATABASE_ROLE_BOOTSTRAP_STARTUP_ENV) delete env[name];
  return env;
};

export const createDatabaseRoleBootstrapConnectionConfig = (config = {}) => {
  const queryTimeout = validTimeoutMilliseconds(
    config.pool?.query_timeout ?? config.pool?.queryTimeoutMillis
  );
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
    connectionTimeoutMillis: config.pool?.connectionTimeoutMillis,
    ...(queryTimeout ? { query_timeout: queryTimeout } : {})
  };
};

export const configureDatabaseRoleBootstrapSession = async (client, config = {}) => {
  const applicationName = String(config.applicationName || '').trim();
  if (applicationName) {
    await client.query(
      "SELECT set_config('application_name', $1, false)",
      [`${applicationName}-role-bootstrap`.slice(0, 63)]
    );
  }

  const settings = [
    ['statement_timeout', validTimeoutMilliseconds(config.pool?.statement_timeout)],
    ['lock_timeout', validTimeoutMilliseconds(config.pool?.lock_timeout)],
    [
      'idle_in_transaction_session_timeout',
      validTimeoutMilliseconds(config.pool?.idle_in_transaction_session_timeout)
    ]
  ];
  for (const [name, timeout] of settings) {
    if (!timeout) continue;
    await client.query(
      `SELECT set_config('${name}', $1, false)`,
      [String(timeout)]
    );
  }
};

export async function bootstrapApplicationDatabaseRole({ client, username, password }) {
  if (!client?.query || !APPLICATION_ROLE_PATTERN.test(String(username || ''))) {
    throw new DatabaseRoleBootstrapError('DATABASE_APPLICATION_ROLE_INVALID');
  }
  if (typeof password !== 'string' || password.length < 16 || password.includes('\0')) {
    throw new DatabaseRoleBootstrapError('DATABASE_APPLICATION_PASSWORD_INVALID');
  }

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [DATABASE_ROLE_BOOTSTRAP_LOCK]);
    await client.query(
      "SELECT set_config('finvantage.app_user', $1, true), set_config('finvantage.app_password', $2, true)",
      [username, password]
    );
    await client.query(BOOTSTRAP_ROLE_SQL);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof DatabaseRoleBootstrapError) throw error;
    throw new DatabaseRoleBootstrapError();
  }
}

export const databaseRoleBootstrapSql = BOOTSTRAP_ROLE_SQL;
