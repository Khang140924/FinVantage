import { createClient } from 'redis';

export const REDIS_NAMESPACES = Object.freeze({
  PIPELINE: 'pipeline',
  AUTH: 'auth'
});

export class RedisConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RedisConfigurationError';
    this.code = 'REDIS_CONFIGURATION_ERROR';
  }
}

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
};

const sanitizeSegment = (value, fallback) => {
  const sanitized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return sanitized || fallback;
};

const sanitizePrefix = (value, fallback) => String(value || fallback)
  .split(':')
  .map((segment) => sanitizeSegment(segment, ''))
  .filter(Boolean)
  .join(':') || fallback;

export const isProductionRuntime = (env = process.env) => {
  if (String(env.IS_OFFLINE || env.SLS_OFFLINE || '').toLowerCase() === 'true') return false;
  const stage = String(env.APP_STAGE || env.STAGE || '').trim().toLowerCase();
  return Boolean(
    env.AWS_LAMBDA_FUNCTION_NAME
    || env.AWS_EXECUTION_ENV
    || env.NODE_ENV === 'production'
    || ['prod', 'production'].includes(stage)
  );
};

export const resolveRedisConfig = (env = process.env) => {
  const production = isProductionRuntime(env);
  const configuredUrl = String(env.REDIS_URL || '').trim();
  if (production && !configuredUrl) {
    throw new RedisConfigurationError('REDIS_URL is required in production.');
  }

  const url = configuredUrl || 'redis://127.0.0.1:6379';
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new RedisConfigurationError('REDIS_URL must be a valid redis:// or rediss:// URL.');
  }
  if (!['redis:', 'rediss:'].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
    throw new RedisConfigurationError('REDIS_URL must be a valid redis:// or rediss:// URL.');
  }
  if (production && parsedUrl.protocol !== 'rediss:') {
    throw new RedisConfigurationError('REDIS_URL must use rediss:// in production.');
  }

  let stage = sanitizeSegment(
    env.APP_STAGE || env.STAGE || env.NODE_ENV,
    production ? 'prod' : 'local'
  );
  if (stage === 'production') stage = 'prod';
  if (stage === 'development') stage = 'dev';
  const keyRoot = sanitizePrefix(env.REDIS_KEY_PREFIX, 'finvantage');

  return Object.freeze({
    url,
    production,
    stage,
    keyRoot,
    connectTimeoutMs: clampInteger(env.REDIS_CONNECT_TIMEOUT_MS, 3000, 250, 30000),
    commandTimeoutMs: clampInteger(env.REDIS_COMMAND_TIMEOUT_MS, 3000, 250, 30000),
    maxReconnectAttempts: clampInteger(env.REDIS_MAX_RECONNECT_ATTEMPTS, 3, 0, 20),
    reconnectBaseDelayMs: clampInteger(env.REDIS_RECONNECT_BASE_DELAY_MS, 100, 25, 5000),
    reconnectMaxDelayMs: clampInteger(env.REDIS_RECONNECT_MAX_DELAY_MS, 1000, 100, 10000)
  });
};

const safeRedisError = (error) => ({
  name: error?.name || 'RedisError',
  code: error?.code || 'REDIS_CLIENT_ERROR'
});

const withTimeout = async (operation, timeoutMs, operationName) => {
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(`Redis ${operationName} timed out.`);
          error.name = 'RedisTimeoutError';
          error.code = 'REDIS_COMMAND_TIMEOUT';
          reject(error);
        }, timeoutMs);
        timeout.unref?.();
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

export const createNamespacedRedisClient = ({
  namespace,
  env = process.env,
  clientFactory = createClient,
  logger = console
} = {}) => {
  const safeNamespace = sanitizeSegment(namespace, 'default');
  const config = resolveRedisConfig(env);
  const stageRoot = config.keyRoot === config.stage || config.keyRoot.endsWith(`:${config.stage}`)
    ? config.keyRoot
    : `${config.keyRoot}:${config.stage}`;
  const keyPrefix = `${stageRoot}:${safeNamespace}:`;
  let client = null;
  let connectPromise = null;

  const reconnectStrategy = (retries) => {
    if (retries >= config.maxReconnectAttempts) {
      const error = new Error('Redis reconnect attempts exhausted.');
      error.name = 'RedisReconnectError';
      error.code = 'REDIS_RECONNECT_EXHAUSTED';
      return error;
    }
    return Math.min(
      config.reconnectBaseDelayMs * (2 ** retries),
      config.reconnectMaxDelayMs
    );
  };

  const getRawClient = () => {
    if (client) return client;
    client = clientFactory({
      url: config.url,
      disableOfflineQueue: config.production,
      socket: {
        connectTimeout: config.connectTimeoutMs,
        reconnectStrategy
      }
    });
    client.on?.('error', (error) => {
      logger.error?.('Redis client error', safeRedisError(error));
    });
    return client;
  };

  const connect = async () => {
    const rawClient = getRawClient();
    if (rawClient.isOpen) return rawClient;
    if (!connectPromise) {
      connectPromise = withTimeout(
        () => rawClient.connect(),
        config.connectTimeoutMs,
        'connect'
      ).then(() => rawClient).catch((error) => {
        if (rawClient.isOpen) rawClient.disconnect?.();
        throw error;
      }).finally(() => {
        connectPromise = null;
      });
    }
    return connectPromise;
  };

  const key = (rawKey) => `${keyPrefix}${String(rawKey)}`;
  const run = async (operationName, operation) => {
    const rawClient = await connect();
    return withTimeout(() => operation(rawClient), config.commandTimeoutMs, operationName);
  };

  return {
    namespace: safeNamespace,
    keyPrefix,
    config: Object.freeze({
      production: config.production,
      stage: config.stage,
      connectTimeoutMs: config.connectTimeoutMs,
      commandTimeoutMs: config.commandTimeoutMs,
      maxReconnectAttempts: config.maxReconnectAttempts,
      tls: new URL(config.url).protocol === 'rediss:'
    }),
    key,
    getRawClient,
    connect,
    get isOpen() {
      return Boolean(client?.isOpen);
    },
    get: (rawKey) => run('get', (rawClient) => rawClient.get(key(rawKey))),
    set: (rawKey, value, options) => run(
      'set',
      (rawClient) => options
        ? rawClient.set(key(rawKey), value, options)
        : rawClient.set(key(rawKey), value)
    ),
    setEx: (rawKey, ttlSeconds, value) => run(
      'setEx',
      (rawClient) => rawClient.setEx(key(rawKey), ttlSeconds, value)
    ),
    del: (...rawKeys) => {
      const flattened = rawKeys.flat();
      if (!flattened.length) return Promise.resolve(0);
      return run('del', (rawClient) => rawClient.del(flattened.map(key)));
    },
    expire: (rawKey, ttlSeconds) => run(
      'expire',
      (rawClient) => rawClient.expire(key(rawKey), ttlSeconds)
    ),
    quit: async () => {
      if (!client?.isOpen) return;
      await withTimeout(() => client.quit(), config.commandTimeoutMs, 'quit');
    },
    disconnect: () => {
      if (client?.isOpen) client.disconnect();
    }
  };
};
