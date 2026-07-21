import { createAuthApp } from "./app.js";
import { assertProductionAuthConfig } from "./authConfig.js";
import { createAuthSessionStore } from "./sessionStore.js";

const unavailableResponse = () => ({
  statusCode: 503,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  },
  body: JSON.stringify({
    code: "AUTH_SERVICE_UNAVAILABLE",
    message: "Authentication service is temporarily unavailable.",
  }),
});

const safeFailure = (error) => ({
  name: /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(String(error?.name || ""))
    ? error.name
    : "AuthLambdaError",
  code: /^[A-Z][A-Z0-9_]{0,79}$/.test(String(error?.code || ""))
    ? error.code
    : "AUTH_LAMBDA_INITIALIZATION_FAILED",
});

export function createLambdaHandler({
  env = process.env,
  logger = console,
  authAppFactory = createAuthApp,
  sessionStoreFactory = createAuthSessionStore,
  adapterFactory,
} = {}) {
  let adapterPromise;

  const initializeAdapter = async () => {
    assertProductionAuthConfig(env);
    let sessionResources;
    try {
      sessionResources = await sessionStoreFactory({ env, logger });
      const auth = authAppFactory({
        env,
        logger,
        sessionStore: sessionResources.store,
        sessionTtlSeconds: sessionResources.ttl,
      });
      await auth.initialize();
      const makeAdapter = adapterFactory || (await import("serverless-http")).default;
      if (typeof makeAdapter !== "function") {
        const error = new Error("The Lambda HTTP adapter is unavailable.");
        error.name = "AuthLambdaAdapterError";
        error.code = "AUTH_LAMBDA_ADAPTER_UNAVAILABLE";
        throw error;
      }
      return makeAdapter(auth.app);
    } catch (error) {
      await sessionResources?.close?.().catch(() => undefined);
      throw error;
    }
  };

  return async (event, context) => {
    if (context) context.callbackWaitsForEmptyEventLoop = false;
    if (!adapterPromise) adapterPromise = initializeAdapter();
    let adapter;
    try {
      adapter = await adapterPromise;
    } catch (error) {
      adapterPromise = undefined;
      logger.error?.("[auth] Lambda request unavailable", safeFailure(error));
      return unavailableResponse();
    }
    try {
      return await adapter(event, context);
    } catch (error) {
      logger.error?.("[auth] Lambda request unavailable", safeFailure(error));
      return unavailableResponse();
    }
  };
}

export const handler = createLambdaHandler();
