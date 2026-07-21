import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const authServerEntry = join(repoRoot, "auth-server", "index.js");
const unusedDotenvPath = join(repoRoot, "tests", "__auth_test_no_env__.env");

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit").catch(() => undefined);
  child.kill();
  await Promise.race([exited, delay(2000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([once(child, "exit").catch(() => undefined), delay(2000)]);
  }
}

async function waitForConfig(child, baseUrl, output) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Auth BFF exited before readiness response.\n${output.text}`);
    }
    try {
      return await fetch(`${baseUrl}/auth/config`, { signal: AbortSignal.timeout(750) });
    } catch {
      await delay(50);
    }
  }
  throw new Error(`Timed out waiting for local Auth BFF.\n${output.text}`);
}

async function startBff(mode) {
  const port = await getFreePort();
  const output = { text: "" };
  const env = {
    ...process.env,
    AUTH_SERVER_PORT: String(port),
    SESSION_SECRET: randomBytes(32).toString("hex"),
    USE_MOCK_AUTH: mode === "mock" ? "true" : "false",
    NODE_ENV: "test",
    COGNITO_ISSUER: "",
    COGNITO_CLIENT_ID: "",
    COGNITO_CLIENT_SECRET: "",
    COGNITO_DOMAIN: "",
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_REGION: "ap-southeast-1",
    AWS_REGION_NAME: "ap-southeast-1",
    DOTENV_CONFIG_PATH: unusedDotenvPath,
  };
  const child = spawn(process.execPath, [authServerEntry], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => { output.text += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output.text += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const configResponse = await waitForConfig(child, baseUrl, output);
    return { baseUrl, child, configResponse, output };
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

test("local Auth BFF mock session and missing Cognito config settle without external services", async (t) => {
  await t.test("explicit mock mode creates and restores only the Mock User session", async (t) => {
    const bff = await startBff("mock");
    t.after(() => stopChild(bff.child));

    assert.equal(bff.configResponse.status, 200);
    assert.deepEqual(await bff.configResponse.json(), {
      mode: "mock",
      ready: true,
      code: null,
      message: null,
    });

    const loginResponse = await fetch(`${bff.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "mock@example.com", password: "test-password" }),
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json();
    assert.equal(login.mode, "mock");
    assert.equal(login.user.sub, "mock-user");
    assert.equal(login.user.name, "Mock User");
    assert.equal(login.idToken, "finvantage-mock-id-token");

    const setCookie = loginResponse.headers.get("set-cookie");
    assert.ok(setCookie, "mock login must set the BFF session cookie");
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.doesNotMatch(setCookie, /;\s*Secure/i);
    const cookie = setCookie.split(";", 1)[0];
    const sessionResponse = await fetch(`${bff.baseUrl}/auth/me`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json();
    assert.equal(session.isAuthenticated, true);
    assert.equal(session.mode, "mock");
    assert.equal(session.user.name, "Mock User");
    assert.equal(session.idToken, "finvantage-mock-id-token");

    const logoutResponse = await fetch(`${bff.baseUrl}/auth/logout`, {
      headers: { Cookie: cookie },
      redirect: "manual",
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(logoutResponse.status, 302);
    const clearedCookie = logoutResponse.headers.get("set-cookie") || "";
    assert.match(clearedCookie, /connect\.sid=;/);
    assert.match(clearedCookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/i);

    const afterLogoutResponse = await fetch(`${bff.baseUrl}/auth/me`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(afterLogoutResponse.status, 200);
    const afterLogout = await afterLogoutResponse.json();
    assert.equal(afterLogout.isAuthenticated, false);
    assert.equal(afterLogout.mode, "mock");
    assert.equal(afterLogout.user, null);
    assert.equal(afterLogout.idToken, null);
  });

  await t.test("Cognito mode with missing config returns a finite structured error and no Mock User", async (t) => {
    const bff = await startBff("cognito");
    t.after(() => stopChild(bff.child));

    assert.equal(bff.configResponse.status, 503);
    const config = await bff.configResponse.json();
    assert.equal(config.mode, "cognito");
    assert.equal(config.ready, false);
    assert.equal(config.code, "AUTH_CONFIG_MISSING");
    assert.deepEqual(config.missing, ["COGNITO_ISSUER", "COGNITO_CLIENT_ID"]);
    assert.doesNotMatch(JSON.stringify(config), /Mock User|mock-user|finvantage-mock-id-token/);

    const startedAt = Date.now();
    const sessionResponse = await fetch(`${bff.baseUrl}/auth/me`, { signal: AbortSignal.timeout(2000) });
    assert.equal(sessionResponse.status, 503);
    assert.ok(Date.now() - startedAt < 2000, "unready Cognito mode must settle instead of polling or loading forever");
    const session = await sessionResponse.json();
    assert.equal(session.ready, false);
    assert.equal(session.code, "AUTH_CONFIG_MISSING");
    assert.doesNotMatch(JSON.stringify(session), /Mock User|mock-user|finvantage-mock-id-token/);
    assert.equal(bff.child.exitCode, null, "BFF should remain available for readiness diagnostics");
  });
});
