import { pathToFileURL } from "node:url";
import { createAuthApp } from "./app.js";
import {
  assertProductionAuthConfig,
  isProductionAuthRuntime,
} from "./authConfig.js";
import { createAuthSessionStore } from "./sessionStore.js";

export function isDirectExecution({ argv = process.argv, moduleUrl = import.meta.url } = {}) {
  const entryPath = argv?.[1];
  if (!entryPath) return false;
  return pathToFileURL(entryPath).href === moduleUrl;
}

const listen = (app, port) => new Promise((resolve, reject) => {
  const server = app.listen(port, () => resolve(server));
  server.once("error", reject);
});

export async function startAuthServer({
  env = process.env,
  logger = console,
  sessionStore,
  sessionResources,
  authAppFactory = createAuthApp,
  sessionStoreFactory = createAuthSessionStore,
} = {}) {
  const isProduction = isProductionAuthRuntime(env);
  let resources = sessionResources;
  let store = sessionStore;

  if (isProduction && !store) {
    assertProductionAuthConfig(env);
    resources = resources || await sessionStoreFactory({ env, logger });
    store = resources.store;
  }

  const auth = authAppFactory({
    env,
    logger,
    sessionStore: store,
    sessionTtlSeconds: resources?.ttl,
  });
  await auth.initialize();

  const port = Number.parseInt(String(env.AUTH_SERVER_PORT || "4000"), 10);
  const server = await listen(auth.app, Number.isFinite(port) ? port : 4000);
  logger.log?.(`[auth] Auth BFF listening on port ${Number.isFinite(port) ? port : 4000}.`);

  return Object.freeze({
    ...auth,
    server,
    sessionResources: resources,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await resources?.close?.();
    },
  });
}

async function startLocalEntry() {
  await import("dotenv/config");
  return startAuthServer();
}

if (isDirectExecution()) {
  startLocalEntry().catch((error) => {
    console.error("[auth] Auth BFF failed to start", {
      name: error?.name || "AuthStartupError",
      code: error?.code || "AUTH_STARTUP_FAILED",
    });
    process.exitCode = 1;
  });
}
