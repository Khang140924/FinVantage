import {
  REDIS_NAMESPACES,
  createNamespacedRedisClient,
} from "../shared/redisClient.js";

const DEFAULT_SESSION_TTL_SECONDS = 24 * 60 * 60;
const MIN_SESSION_TTL_SECONDS = 5 * 60;
const MAX_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
};

const resolveSessionRedisEnv = (env) => ({
  ...env,
  REDIS_URL: String(env.AUTH_SESSION_REDIS_URL || env.REDIS_URL || "").trim(),
});

export async function createAuthSessionStore({
  env = process.env,
  logger = console,
  redisClientFactory = createNamespacedRedisClient,
  RedisStoreClass,
} = {}) {
  const redisEnv = resolveSessionRedisEnv(env);
  const redis = redisClientFactory({
    namespace: REDIS_NAMESPACES.AUTH,
    env: redisEnv,
    logger,
  });

  await redis.connect();
  const redisStoreModule = RedisStoreClass ? null : await import("connect-redis");
  const Store = RedisStoreClass || redisStoreModule.RedisStore || redisStoreModule.default;
  if (typeof Store !== "function") {
    const error = new Error("The Redis session store is unavailable.");
    error.code = "AUTH_SESSION_STORE_UNAVAILABLE";
    throw error;
  }

  const ttl = clampInteger(
    env.AUTH_SESSION_TTL_SECONDS,
    DEFAULT_SESSION_TTL_SECONDS,
    MIN_SESSION_TTL_SECONDS,
    MAX_SESSION_TTL_SECONDS,
  );
  const prefix = `${redis.keyPrefix}session:`;
  const store = new Store({
    client: redis.getRawClient(),
    prefix,
    ttl,
  });

  return Object.freeze({
    store,
    redis,
    ttl,
    prefix,
    async close() {
      await redis.quit();
    },
  });
}

export const authSessionDefaults = Object.freeze({
  ttlSeconds: DEFAULT_SESSION_TTL_SECONDS,
  namespace: REDIS_NAMESPACES.AUTH,
  suffix: "session:",
});
