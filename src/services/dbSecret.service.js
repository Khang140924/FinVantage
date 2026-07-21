import { DatabaseConfigurationError } from '../config/db.config.js';

const defaultModuleLoader = () => import('@aws-sdk/client-secrets-manager');

const decodeSecretBinary = (value) => {
  if (typeof value === 'string') return Buffer.from(value, 'base64').toString('utf8');
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return Buffer.from(value).toString('utf8');
  return '';
};

export const parseDatabaseSecret = (secretValue) => {
  let parsed;
  try {
    parsed = JSON.parse(String(secretValue || ''));
  } catch {
    throw new DatabaseConfigurationError('The database secret must contain valid JSON.');
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new DatabaseConfigurationError('The database secret must contain a JSON object.');
  }

  const user = String(parsed.username ?? parsed.user ?? parsed.DB_USER ?? '').trim();
  const password = parsed.password ?? parsed.DB_PASSWORD;
  if (!user || typeof password !== 'string' || !password) {
    throw new DatabaseConfigurationError('The database secret must contain username and password.');
  }

  const rawPort = Number.parseInt(String(parsed.port ?? ''), 10);
  return Object.freeze({
    user,
    password,
    host: String(parsed.host || '').trim() || undefined,
    port: Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : undefined,
    database: String(parsed.dbname ?? parsed.database ?? parsed.DB_NAME ?? '').trim() || undefined
  });
};

export const mergeDatabaseSecret = (baseConfig, secret, env = process.env) => Object.freeze({
  ...baseConfig,
  // The application must always connect through RDS Proxy when one is set.
  host: baseConfig.usesProxy
    ? baseConfig.host
    : (String(env.DB_HOST || '').trim() ? baseConfig.host : (secret.host || baseConfig.host)),
  port: String(env.DB_PORT || '').trim() ? baseConfig.port : (secret.port || baseConfig.port),
  database: String(env.DB_NAME || '').trim() ? baseConfig.database : (secret.database || baseConfig.database),
  user: secret.user,
  password: secret.password
});

export const createDatabaseSecretResolver = ({
  env = process.env,
  moduleLoader = defaultModuleLoader,
  clientFactory
} = {}) => {
  let client;
  let resolvedPromise;

  const resolve = async (baseConfig) => {
    if (!baseConfig.secretArn) return baseConfig;
    if (resolvedPromise) return resolvedPromise;

    resolvedPromise = (async () => {
      const sdk = await moduleLoader();
      const SecretsManagerClient = sdk.SecretsManagerClient;
      const GetSecretValueCommand = sdk.GetSecretValueCommand;
      if (!SecretsManagerClient || !GetSecretValueCommand) {
        throw new DatabaseConfigurationError('AWS Secrets Manager client is unavailable.');
      }

      client ||= clientFactory
        ? clientFactory({ region: baseConfig.secretRegion })
        : new SecretsManagerClient(baseConfig.secretRegion ? { region: baseConfig.secretRegion } : {});

      const result = await client.send(new GetSecretValueCommand({ SecretId: baseConfig.secretArn }));
      const serialized = result?.SecretString || decodeSecretBinary(result?.SecretBinary);
      if (!serialized) {
        throw new DatabaseConfigurationError('The database secret has no usable value.');
      }
      return mergeDatabaseSecret(baseConfig, parseDatabaseSecret(serialized), env);
    })().catch((error) => {
      // Allow a later invocation to retry a transient Secrets Manager failure.
      resolvedPromise = null;
      if (error instanceof DatabaseConfigurationError) throw error;
      throw new DatabaseConfigurationError('Unable to resolve the configured database secret.');
    });

    return resolvedPromise;
  };

  return {
    resolve,
    clearCache: () => {
      resolvedPromise = null;
    }
  };
};

const defaultResolver = createDatabaseSecretResolver();

export const resolveDatabaseCredentials = (baseConfig) => defaultResolver.resolve(baseConfig);
