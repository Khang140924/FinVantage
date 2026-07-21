import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createNamespacedRedisClient,
  REDIS_NAMESPACES,
  RedisConfigurationError,
  resolveRedisConfig
} from '../shared/redisClient.js';

const createFakeClient = (options, state) => {
  const listeners = new Map();
  const client = {
    isOpen: false,
    on: (event, callback) => listeners.set(event, callback),
    connect: async () => {
      state.connects += 1;
      client.isOpen = true;
    },
    get: async (key) => {
      state.keys.push(key);
      return state.values.get(key) ?? null;
    },
    set: async (key, value) => {
      state.keys.push(key);
      state.values.set(key, value);
      return 'OK';
    },
    setEx: async (key, ttl, value) => {
      state.keys.push(key);
      state.ttl = ttl;
      state.values.set(key, value);
      return 'OK';
    },
    del: async (keys) => {
      state.keys.push(...keys);
      return keys.length;
    },
    expire: async () => true,
    quit: async () => {
      client.isOpen = false;
    },
    disconnect: () => {
      client.isOpen = false;
    }
  };
  state.options = options;
  state.emitError = (error) => listeners.get('error')?.(error);
  return client;
};

test('production Redis fails fast without a configured URL', () => {
  assert.throws(
    () => resolveRedisConfig({ NODE_ENV: 'production' }),
    RedisConfigurationError
  );
  assert.throws(
    () => resolveRedisConfig({ NODE_ENV: 'production', REDIS_URL: 'redis://redis.internal:6379' }),
    /rediss:\/\//i
  );
});

test('Redis accepts rediss, uses bounded reconnect and isolates pipeline keys', async () => {
  const state = { connects: 0, keys: [], values: new Map() };
  const logs = [];
  const wrapper = createNamespacedRedisClient({
    namespace: REDIS_NAMESPACES.PIPELINE,
    env: {
      NODE_ENV: 'production',
      APP_STAGE: 'prod',
      REDIS_URL: 'rediss://user:private-token@redis.internal:6380',
      REDIS_KEY_PREFIX: 'FinVantage',
      REDIS_MAX_RECONNECT_ATTEMPTS: '2'
    },
    clientFactory: (options) => createFakeClient(options, state),
    logger: { error: (...args) => logs.push(args) }
  });

  await wrapper.setEx('ocr:invoice-1', 60, '{"ok":true}');
  assert.equal(state.connects, 1);
  assert.equal(state.keys[0], 'finvantage:prod:pipeline:ocr:invoice-1');
  assert.equal(wrapper.config.tls, true);
  assert.equal(state.options.socket.reconnectStrategy(0), 100);
  assert.equal(state.options.socket.reconnectStrategy(2).code, 'REDIS_RECONNECT_EXHAUSTED');

  state.emitError(Object.assign(
    new Error('failed rediss://user:private-token@redis.internal:6380'),
    { code: 'ECONNRESET' }
  ));
  assert.equal(JSON.stringify(logs).includes('private-token'), false);
  assert.equal(JSON.stringify(wrapper.config).includes('redis.internal'), false);
});

test('auth and pipeline namespaces cannot collide and local has a safe loopback fallback', () => {
  const pipeline = createNamespacedRedisClient({
    namespace: REDIS_NAMESPACES.PIPELINE,
    env: { NODE_ENV: 'test' },
    clientFactory: () => ({ on() {} })
  });
  const auth = createNamespacedRedisClient({
    namespace: REDIS_NAMESPACES.AUTH,
    env: { NODE_ENV: 'test' },
    clientFactory: () => ({ on() {} })
  });
  assert.notEqual(pipeline.key('same'), auth.key('same'));
  assert.equal(pipeline.key('same'), 'finvantage:test:pipeline:same');
});

test('a configured stage in the root prefix is not duplicated', () => {
  const wrapper = createNamespacedRedisClient({
    namespace: REDIS_NAMESPACES.AUTH,
    env: {
      NODE_ENV: 'production',
      REDIS_URL: 'rediss://redis.internal:6380',
      REDIS_KEY_PREFIX: 'finvantage:prod'
    },
    clientFactory: () => ({ on() {} })
  });
  assert.equal(wrapper.key('session:1'), 'finvantage:prod:auth:session:1');
});
