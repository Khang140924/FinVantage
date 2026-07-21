import assert from "node:assert/strict";
import test from "node:test";
import {
  canStartManagedLogin,
  isMockIdentity,
  parseFrontendAuthMode,
  shouldAutoRedirectToManagedLogin,
  validateAuthConfig,
  validateAuthSession,
} from "../frontend/src/utils/authMode.js";
import { discoveryFailure, resolveAuthServerConfig } from "../auth-server/authConfig.js";

test("frontend auth mode is explicit and limited to mock or cognito", () => {
  assert.equal(parseFrontendAuthMode(undefined).code, "MISSING_AUTH_MODE");
  assert.equal(parseFrontendAuthMode("other").code, "INVALID_AUTH_MODE");
  assert.deepEqual(parseFrontendAuthMode(" MOCK "), { ok: true, mode: "mock", code: null, message: null });
  assert.equal(parseFrontendAuthMode("cognito").mode, "cognito");
});

test("frontend and BFF modes must match and the BFF must be ready", () => {
  assert.equal(validateAuthConfig("mock", { mode: "mock", ready: true }).ok, true);
  assert.equal(validateAuthConfig("cognito", { mode: "mock", ready: true }).code, "AUTH_MODE_MISMATCH");
  assert.equal(validateAuthConfig("cognito", { mode: "cognito", ready: false, code: "NO_CONFIG" }).code, "NO_CONFIG");
});

test("mock identities are accepted only in mock mode", () => {
  const mockSession = { mode: "mock", isAuthenticated: true, user: { sub: "mock-user" }, idToken: "finvantage-mock-id-token" };
  assert.equal(isMockIdentity(mockSession), true);
  assert.equal(validateAuthSession("mock", mockSession).ok, true);
  assert.equal(validateAuthSession("cognito", { ...mockSession, mode: "cognito" }).code, "MOCK_IDENTITY_IN_COGNITO");
  assert.equal(validateAuthSession("mock", { mode: "mock", isAuthenticated: true, user: { sub: "real-user" }, idToken: "real-token" }).code, "NON_MOCK_IDENTITY_IN_MOCK");
  assert.equal(validateAuthSession("cognito", { mode: "cognito", isAuthenticated: false, user: null, idToken: null }).authenticated, false);
});

test("managed login redirects once and pauses after logout", () => {
  assert.equal(shouldAutoRedirectToManagedLogin({ mode: "cognito", status: "unauthenticated", redirectAttempted: false, logoutPending: false }), true);
  assert.equal(shouldAutoRedirectToManagedLogin({ mode: "cognito", status: "unauthenticated", redirectAttempted: true, logoutPending: false }), false);
  assert.equal(shouldAutoRedirectToManagedLogin({ mode: "cognito", status: "unauthenticated", redirectAttempted: false, logoutPending: true }), false);
  assert.equal(shouldAutoRedirectToManagedLogin({ mode: "mock", status: "unauthenticated", redirectAttempted: false, logoutPending: false }), false);

  const postLogout = { mode: "cognito", status: "unauthenticated", redirectAttempted: false, logoutPending: true };
  assert.equal(canStartManagedLogin({ ...postLogout, automatic: true }), false);
  assert.equal(canStartManagedLogin({ ...postLogout, automatic: false }), true);
  const afterManualLoginStarts = { mode: "cognito", status: "unauthenticated", redirectAttempted: true, logoutPending: false };
  assert.equal(canStartManagedLogin({ ...afterManualLoginStarts, automatic: true }), false);
});

test("BFF config is finite without invoking Cognito", () => {
  const mock = resolveAuthServerConfig({ USE_MOCK_AUTH: "true", SESSION_SECRET: "test-secret" });
  assert.equal(mock.ready, true);
  assert.equal(mock.mode, "mock");

  const missingSecret = resolveAuthServerConfig({ USE_MOCK_AUTH: "true" });
  assert.equal(missingSecret.ready, false);
  assert.deepEqual(missingSecret.missing, ["SESSION_SECRET"]);

  const missing = resolveAuthServerConfig({ USE_MOCK_AUTH: "false", SESSION_SECRET: "test-secret" });
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.missing, ["COGNITO_ISSUER", "COGNITO_CLIENT_ID"]);

  const cognito = resolveAuthServerConfig({ USE_MOCK_AUTH: "false", SESSION_SECRET: "test-secret", COGNITO_ISSUER: "https://issuer.example", COGNITO_CLIENT_ID: "client" });
  assert.equal(cognito.ready, true);
  assert.equal(cognito.mode, "cognito");
  assert.equal(discoveryFailure({ name: "FetchError" }).code, "COGNITO_DISCOVERY_FAILED");
});
