export const AUTH_MODES = Object.freeze(["mock", "cognito"]);

export function parseFrontendAuthMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (!mode) {
    return { ok: false, mode: null, code: "MISSING_AUTH_MODE", message: "VITE_AUTH_MODE must be set to mock or cognito." };
  }
  if (!AUTH_MODES.includes(mode)) {
    return { ok: false, mode: null, code: "INVALID_AUTH_MODE", message: "VITE_AUTH_MODE must be either mock or cognito." };
  }
  return { ok: true, mode, code: null, message: null };
}

export function validateAuthConfig(expectedMode, config) {
  if (!config || typeof config !== "object") {
    return { ok: false, code: "INVALID_AUTH_CONFIG", message: "The authentication server returned an invalid configuration response." };
  }
  if (config.ready === false) {
    return { ok: false, code: config.code || "AUTH_NOT_READY", message: config.message || "The authentication server is not ready." };
  }
  if (!AUTH_MODES.includes(config.mode)) {
    return { ok: false, code: "INVALID_SERVER_AUTH_MODE", message: "The authentication server returned an invalid mode." };
  }
  if (config.mode !== expectedMode) {
    return {
      ok: false,
      code: "AUTH_MODE_MISMATCH",
      message: `Frontend auth mode ${expectedMode} does not match authentication server mode ${config.mode}.`,
    };
  }
  return { ok: true, code: null, message: null };
}

export function isMockIdentity(session) {
  return session?.idToken === "finvantage-mock-id-token" || session?.user?.sub === "mock-user";
}

export function validateAuthSession(expectedMode, session) {
  if (!session || typeof session !== "object") {
    return { ok: false, code: "INVALID_AUTH_SESSION", message: "The authentication server returned an invalid session response." };
  }
  if (session.mode !== expectedMode) {
    return { ok: false, code: "AUTH_MODE_MISMATCH", message: "The authentication session mode does not match the configured frontend mode." };
  }
  if (!session.isAuthenticated) return { ok: true, authenticated: false, code: null, message: null };
  if (!session.user || !session.idToken) {
    return { ok: false, code: "INCOMPLETE_AUTH_SESSION", message: "The authenticated session is missing its user or ID token." };
  }

  const mockIdentity = isMockIdentity(session);
  if (expectedMode === "cognito" && mockIdentity) {
    return { ok: false, code: "MOCK_IDENTITY_IN_COGNITO", message: "Cognito mode rejected a development identity." };
  }
  if (expectedMode === "mock" && !mockIdentity) {
    return { ok: false, code: "NON_MOCK_IDENTITY_IN_MOCK", message: "Mock mode received a non-development identity." };
  }
  return { ok: true, authenticated: true, code: null, message: null };
}

export function shouldAutoRedirectToManagedLogin({ mode, status, redirectAttempted, logoutPending }) {
  return mode === "cognito" && status === "unauthenticated" && !redirectAttempted && !logoutPending;
}

export function canStartManagedLogin({ mode, status, automatic, redirectAttempted, logoutPending }) {
  if (mode !== "cognito" || status !== "unauthenticated") return false;
  if (!automatic) return true;
  return shouldAutoRedirectToManagedLogin({ mode, status, redirectAttempted, logoutPending });
}
