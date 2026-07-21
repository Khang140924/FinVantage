import assert from "node:assert/strict";
import { once } from "node:events";
import { resolve } from "node:path";
import session from "express-session";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createAuthApp } from "../auth-server/app.js";
import {
  isProductionAuthRuntime,
  resolveAuthServerConfig,
} from "../auth-server/authConfig.js";
import { isDirectExecution } from "../auth-server/index.js";
import { createLambdaHandler } from "../auth-server/lambda.js";
import {
  authSessionDefaults,
  createAuthSessionStore,
} from "../auth-server/sessionStore.js";

const silentLogger = Object.freeze({
  log() {},
  warn() {},
  error() {},
});

const validProductionEnv = (overrides = {}) => ({
  NODE_ENV: "production",
  USE_MOCK_AUTH: "false",
  SESSION_SECRET: "s".repeat(64),
  AWS_REGION: "ap-southeast-1",
  COGNITO_ISSUER: "https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_TestPool",
  COGNITO_CLIENT_ID: "public-test-client",
  COGNITO_CLIENT_SECRET: "test-client-secret",
  COGNITO_DOMAIN: "https://finvantage-test.auth.ap-southeast-1.amazoncognito.com",
  COGNITO_REDIRECT_URI: "https://app.example.com/auth/callback",
  COGNITO_LOGOUT_URI: "https://app.example.com/",
  COGNITO_SCOPES: "openid email profile",
  REDIS_URL: "rediss://cache.example.com:6379",
  ...overrides,
});

async function startTestServer(app) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    }),
  };
}

const cookiePair = (response) => String(response.headers.get("set-cookie") || "").split(";", 1)[0];

test("production Cognito config rejects mock mode, localhost URLs, weak secrets and malformed issuer/domain", () => {
  assert.equal(isProductionAuthRuntime({ AWS_EXECUTION_ENV: "AWS_Lambda_nodejs20.x" }), true);
  assert.equal(isProductionAuthRuntime({ STAGE: "prod" }), true);
  assert.equal(isProductionAuthRuntime({ NODE_ENV: "test" }), false);

  const valid = resolveAuthServerConfig(validProductionEnv());
  assert.equal(valid.ready, true);
  assert.deepEqual(valid.missing, []);
  assert.deepEqual(valid.invalid, []);

  const invalid = resolveAuthServerConfig(validProductionEnv({
    SESSION_SECRET: "short",
    COGNITO_ISSUER: "https://issuer.example.com/pool",
    COGNITO_DOMAIN: "http://localhost:4000",
    COGNITO_REDIRECT_URI: "http://localhost:5174/auth/callback",
    COGNITO_LOGOUT_URI: "http://127.0.0.1:5174/",
  }));
  assert.equal(invalid.ready, false);
  assert.equal(invalid.code, "AUTH_CONFIG_INVALID");
  assert.deepEqual(invalid.invalid, [
    "SESSION_SECRET",
    "COGNITO_REDIRECT_URI",
    "COGNITO_LOGOUT_URI",
    "COGNITO_DOMAIN",
    "COGNITO_ISSUER",
  ]);

  const mockProduction = resolveAuthServerConfig(validProductionEnv({ USE_MOCK_AUTH: "true" }));
  assert.equal(mockProduction.ready, false);
  assert.deepEqual(mockProduction.invalid, ["USE_MOCK_AUTH"]);
});

test("production auth app requires an explicit persistent session store", () => {
  assert.throws(
    () => createAuthApp({ env: validProductionEnv(), logger: silentLogger }),
    (error) => error.code === "AUTH_SESSION_STORE_REQUIRED",
  );
});

test("Redis/Valkey auth sessions use a dedicated namespace, prefix and bounded TTL", async () => {
  const calls = [];
  const rawClient = { isOpen: true };
  const wrapper = {
    keyPrefix: "finvantage:production:auth:",
    async connect() { calls.push("connect"); },
    getRawClient() { calls.push("raw"); return rawClient; },
    async quit() { calls.push("quit"); },
  };
  let storeOptions;
  class FakeRedisStore {
    constructor(options) {
      storeOptions = options;
    }
  }

  const resources = await createAuthSessionStore({
    env: validProductionEnv({
      REDIS_URL: "",
      AUTH_SESSION_REDIS_URL: "rediss://auth-cache.example.com:6379",
      AUTH_SESSION_TTL_SECONDS: "7200",
    }),
    logger: silentLogger,
    redisClientFactory(options) {
      calls.push({
        namespace: options.namespace,
        effectiveUrl: options.env.REDIS_URL,
      });
      return wrapper;
    },
    RedisStoreClass: FakeRedisStore,
  });

  assert.deepEqual(calls[0], {
    namespace: authSessionDefaults.namespace,
    effectiveUrl: "rediss://auth-cache.example.com:6379",
  });
  assert.equal(calls[1], "connect");
  assert.equal(storeOptions.client, rawClient);
  assert.equal(storeOptions.prefix, "finvantage:production:auth:session:");
  assert.equal(storeOptions.ttl, 7200);
  assert.equal(resources.ttl, 7200);
  assert.equal(resources.prefix, storeOptions.prefix);
  await resources.close();
  assert.equal(calls.at(-1), "quit");
});

test("Cognito callback and logout preserve same-origin secure session-cookie contract without AWS", async (t) => {
  let authorizationRequest;
  let callbackRequest;
  const tokenSet = {
    id_token: "test-id-token-never-log",
    access_token: "test-access-token-never-log",
    refresh_token: "test-refresh-token-never-log",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "Bearer",
    scope: "openid email profile",
    claims: () => ({ sub: "user-123", email: "user@example.com", name: "Test User" }),
  };
  const fakeOidcClient = {
    issuer: {
      metadata: {
        end_session_endpoint: "https://fallback-idp.example.com/logout",
      },
    },
    authorizationUrl(options) {
      authorizationRequest = options;
      const target = new URL("https://login.example.com/oauth2/authorize");
      target.searchParams.set("state", options.state);
      target.searchParams.set("nonce", options.nonce);
      return target.toString();
    },
    callbackParams(req) {
      return { code: req.query.code, state: req.query.state };
    },
    async callback(redirectUri, params, checks) {
      callbackRequest = { redirectUri, params, checks };
      assert.equal(params.state, checks.state);
      return tokenSet;
    },
    async userinfo(accessToken) {
      assert.equal(accessToken, tokenSet.access_token);
      return { sub: "user-123", email: "user@example.com", name: "Test User" };
    },
  };
  const logs = [];
  const logger = {
    log: (...args) => logs.push(args),
    warn: (...args) => logs.push(args),
    error: (...args) => logs.push(args),
  };
  const auth = createAuthApp({
    env: validProductionEnv(),
    logger,
    sessionStore: new session.MemoryStore(),
    oidcClient: fakeOidcClient,
    cognitoClient: {
      async send() {
        throw new Error("AWS must not be called by this test");
      },
    },
  });
  await auth.initialize();
  const server = await startTestServer(auth.app);
  t.after(server.close);

  const login = await fetch(`${server.baseUrl}/auth/login`, {
    redirect: "manual",
    headers: { "X-Forwarded-Proto": "https" },
  });
  assert.equal(login.status, 302);
  assert.ok(authorizationRequest.state);
  assert.ok(authorizationRequest.nonce);
  assert.equal(authorizationRequest.scope, "openid email profile");
  const loginCookieHeader = login.headers.get("set-cookie") || "";
  assert.match(loginCookieHeader, /HttpOnly/i);
  assert.match(loginCookieHeader, /Secure/i);
  assert.match(loginCookieHeader, /SameSite=Lax/i);
  assert.match(loginCookieHeader, /Path=\//i);
  const cookie = cookiePair(login);
  assert.ok(cookie.startsWith("connect.sid="));

  const callbackUrl = new URL(`${server.baseUrl}/auth/callback`);
  callbackUrl.searchParams.set("code", "test-code");
  callbackUrl.searchParams.set("state", authorizationRequest.state);
  const callback = await fetch(callbackUrl, {
    redirect: "manual",
    headers: {
      Cookie: cookie,
      "X-Forwarded-Proto": "https",
    },
  });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "https://app.example.com/");
  assert.equal(callbackRequest.redirectUri, "https://app.example.com/auth/callback");
  assert.equal(callbackRequest.checks.state, authorizationRequest.state);
  assert.equal(callbackRequest.checks.nonce, authorizationRequest.nonce);
  const authenticatedCookie = cookiePair(callback);
  assert.ok(authenticatedCookie.startsWith("connect.sid="));
  assert.notEqual(authenticatedCookie, cookie);

  const sessionResponse = await fetch(`${server.baseUrl}/auth/me`, {
    headers: {
      Cookie: authenticatedCookie,
      "X-Forwarded-Proto": "https",
    },
  });
  assert.equal(sessionResponse.status, 200);
  const sessionPayload = await sessionResponse.json();
  assert.equal(sessionPayload.isAuthenticated, true);
  assert.equal(sessionPayload.user.sub, "user-123");
  assert.equal(sessionPayload.idToken, tokenSet.id_token);

  const logout = await fetch(`${server.baseUrl}/auth/logout`, {
    redirect: "manual",
    headers: {
      Cookie: authenticatedCookie,
      "X-Forwarded-Proto": "https",
    },
  });
  assert.equal(logout.status, 302);
  const logoutLocation = new URL(logout.headers.get("location"));
  assert.equal(logoutLocation.origin, "https://finvantage-test.auth.ap-southeast-1.amazoncognito.com");
  assert.equal(logoutLocation.pathname, "/logout");
  assert.equal(logoutLocation.searchParams.get("client_id"), "public-test-client");
  assert.equal(logoutLocation.searchParams.get("logout_uri"), "https://app.example.com/");
  const clearedCookie = logout.headers.get("set-cookie") || "";
  assert.match(clearedCookie, /connect\.sid=;/);
  assert.match(clearedCookie, /HttpOnly/i);
  assert.match(clearedCookie, /Secure/i);
  assert.match(clearedCookie, /SameSite=Lax/i);

  const serializedLogs = JSON.stringify(logs);
  assert.doesNotMatch(serializedLogs, /test-id-token|test-access-token|test-refresh-token/);
});

test("Lambda adapter initializes once, reuses the persistent store and hides initialization errors", async () => {
  let storeInitializations = 0;
  let appInitializations = 0;
  let adapterInitializations = 0;
  const context = { callbackWaitsForEmptyEventLoop: true };
  const handler = createLambdaHandler({
    env: validProductionEnv(),
    logger: silentLogger,
    async sessionStoreFactory() {
      storeInitializations += 1;
      return { store: { name: "persistent-test-store" }, ttl: 3600 };
    },
    authAppFactory({ sessionStore, sessionTtlSeconds }) {
      assert.equal(sessionStore.name, "persistent-test-store");
      assert.equal(sessionTtlSeconds, 3600);
      return {
        app: { name: "auth-app" },
        async initialize() { appInitializations += 1; },
      };
    },
    adapterFactory(app) {
      adapterInitializations += 1;
      assert.equal(app.name, "auth-app");
      return async (event) => ({ statusCode: 200, body: JSON.stringify({ path: event.path }) });
    },
  });

  const first = await handler({ path: "/auth/config" }, context);
  const second = await handler({ path: "/auth/me" }, context);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(storeInitializations, 1);
  assert.equal(appInitializations, 1);
  assert.equal(adapterInitializations, 1);
  assert.equal(context.callbackWaitsForEmptyEventLoop, false);

  const capturedLogs = [];
  const unavailable = createLambdaHandler({
    env: validProductionEnv(),
    logger: { error: (...args) => capturedLogs.push(args) },
    async sessionStoreFactory() {
      const error = new Error("rediss://user:do-not-log@example.com");
      error.name = "RedisConnectionError";
      throw error;
    },
    adapterFactory() {
      throw new Error("adapter should not be reached");
    },
  });
  const failure = await unavailable({ path: "/auth/me" }, {});
  assert.equal(failure.statusCode, 503);
  assert.deepEqual(JSON.parse(failure.body), {
    code: "AUTH_SERVICE_UNAVAILABLE",
    message: "Authentication service is temporarily unavailable.",
  });
  assert.doesNotMatch(JSON.stringify(capturedLogs), /rediss:|do-not-log/);

  let invalidConfigStoreCalls = 0;
  const invalidConfiguration = createLambdaHandler({
    env: validProductionEnv({
      COGNITO_REDIRECT_URI: "http://localhost:5174/auth/callback",
    }),
    logger: silentLogger,
    async sessionStoreFactory() {
      invalidConfigStoreCalls += 1;
      throw new Error("session store must not initialize for invalid production auth config");
    },
  });
  const invalidConfigResponse = await invalidConfiguration({ path: "/auth/config" }, {});
  assert.equal(invalidConfigResponse.statusCode, 503);
  assert.equal(invalidConfigStoreCalls, 0);
});

test("local listen entry is guarded and imports do not impersonate direct execution", () => {
  const entryPath = resolve("auth-server/index.js");
  const moduleUrl = pathToFileURL(entryPath).href;
  assert.equal(isDirectExecution({ argv: [process.execPath, entryPath], moduleUrl }), true);
  assert.equal(isDirectExecution({ argv: [process.execPath, resolve("tests/importer.js")], moduleUrl }), false);
  assert.equal(isDirectExecution({ argv: [process.execPath], moduleUrl }), false);
});
