import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  canStartManagedLogin,
  parseFrontendAuthMode,
  validateAuthConfig,
  validateAuthSession,
} from "../utils/authMode.js";

const AUTH_STORAGE_KEY = "finvantage-id-token";
const REDIRECT_GUARD_KEY = "finvantage-cognito-redirect-attempted";
const LOGOUT_GUARD_KEY = "finvantage-cognito-logout-pending";
const configuredAuthMode = parseFrontendAuthMode(import.meta.env.VITE_AUTH_MODE);
const AuthContext = createContext(null);

class AuthRequestError extends Error {
  constructor(message, { status = 0, code = "AUTH_REQUEST_FAILED", data = null } = {}) {
    super(message);
    this.name = "AuthRequestError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

async function authRequest(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(path, {
      credentials: "include",
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AuthRequestError(data.message || "Authentication request failed.", {
        status: response.status,
        code: data.code,
        data,
      });
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new AuthRequestError("Authentication server timed out.", { code: "AUTH_TIMEOUT" });
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function persistToken(token) {
  try {
    if (token) window.localStorage.setItem(AUTH_STORAGE_KEY, token);
    else window.localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch { /* private browsing */ }
}

function hasSessionFlag(key) {
  try { return window.sessionStorage.getItem(key) === "1"; }
  catch { return false; }
}

function setSessionFlag(key, value) {
  try {
    if (value) window.sessionStorage.setItem(key, "1");
    else window.sessionStorage.removeItem(key);
  } catch { /* private browsing */ }
}

function clearLoginGuards() {
  setSessionFlag(REDIRECT_GUARD_KEY, false);
  setSessionFlag(LOGOUT_GUARD_KEY, false);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [idToken, setIdToken] = useState(null);
  const [authMode, setAuthMode] = useState(configuredAuthMode.mode || "unknown");
  const [status, setStatus] = useState("loading");
  const [authError, setAuthError] = useState(null);
  const requestEpoch = useRef(0);
  const initialized = useRef(false);
  const mounted = useRef(true);

  const clearIdentity = useCallback(() => {
    setUser(null);
    setIdToken(null);
    persistToken(null);
  }, []);

  const loadSession = useCallback(async () => {
    const epoch = ++requestEpoch.current;
    setStatus("loading");
    setAuthError(null);

    if (!configuredAuthMode.ok) {
      clearIdentity();
      setAuthMode("unavailable");
      setAuthError(configuredAuthMode.message);
      setStatus("error");
      return;
    }

    const expectedMode = configuredAuthMode.mode;
    setAuthMode(expectedMode);
    try {
      const config = await authRequest("/auth/config", { method: "GET", headers: {} });
      const configValidation = validateAuthConfig(expectedMode, config);
      if (!configValidation.ok) throw new AuthRequestError(configValidation.message, { code: configValidation.code, data: config });

      const session = await authRequest("/auth/me", { method: "GET", headers: {} });
      const sessionValidation = validateAuthSession(expectedMode, session);
      if (!sessionValidation.ok) throw new AuthRequestError(sessionValidation.message, { code: sessionValidation.code, data: session });
      if (!mounted.current || epoch !== requestEpoch.current) return;

      if (sessionValidation.authenticated) {
        setUser(session.user);
        setIdToken(session.idToken);
        persistToken(session.idToken);
        clearLoginGuards();
        setStatus("authenticated");
      } else {
        clearIdentity();
        setStatus("unauthenticated");
      }
    } catch (error) {
      if (!mounted.current || epoch !== requestEpoch.current) return;
      clearIdentity();
      setAuthError(error.message || "Authentication initialization failed.");
      setStatus("error");
    }
  }, [clearIdentity]);

  useEffect(() => {
    mounted.current = true;
    if (!initialized.current) {
      initialized.current = true;
      loadSession();
    }
    return () => { mounted.current = false; };
  }, [loadSession]);

  useEffect(() => {
    const handleUnauthorized = () => {
      requestEpoch.current += 1;
      clearIdentity();
      clearLoginGuards();
      setAuthError(null);
      setStatus("unauthenticated");
    };
    window.addEventListener("finvantage:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("finvantage:unauthorized", handleUnauthorized);
  }, [clearIdentity]);

  const login = useCallback(async (email, password) => {
    if (configuredAuthMode.mode !== "mock") throw new Error("Credential login is available only in mock mode.");
    const data = await authRequest("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    const session = { ...data, isAuthenticated: true };
    const validation = validateAuthSession("mock", session);
    if (!validation.ok) throw new Error(validation.message);
    setUser(data.user);
    setIdToken(data.idToken);
    persistToken(data.idToken);
    clearLoginGuards();
    setStatus("authenticated");
    setAuthError(null);
    return data;
  }, []);

  const signup = useCallback((payload) => authRequest("/auth/signup", { method: "POST", body: JSON.stringify(payload) }), []);
  const confirmSignup = useCallback((email, code) => authRequest("/auth/confirm-signup", { method: "POST", body: JSON.stringify({ email, code }) }), []);
  const resendConfirmation = useCallback((email) => authRequest("/auth/resend-confirmation", { method: "POST", body: JSON.stringify({ email }) }), []);
  const forgotPassword = useCallback((email) => authRequest("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }), []);
  const resetPassword = useCallback((email, code, newPassword) => authRequest("/auth/reset-password", { method: "POST", body: JSON.stringify({ email, code, newPassword }) }), []);

  const hostedLogin = useCallback((options = {}) => {
    if (configuredAuthMode.mode !== "cognito") return false;
    const automatic = options?.automatic === true;
    if (!canStartManagedLogin({
      mode: configuredAuthMode.mode,
      status,
      automatic,
      redirectAttempted: hasSessionFlag(REDIRECT_GUARD_KEY),
      logoutPending: hasSessionFlag(LOGOUT_GUARD_KEY),
    })) return false;

    if (!automatic) clearLoginGuards();
    setSessionFlag(REDIRECT_GUARD_KEY, true);
    window.location.assign("/auth/login");
    return true;
  }, [status]);

  const logout = useCallback(() => {
    requestEpoch.current += 1;
    clearIdentity();
    setAuthError(null);
    setStatus("unauthenticated");
    setSessionFlag(REDIRECT_GUARD_KEY, false);
    setSessionFlag(LOGOUT_GUARD_KEY, configuredAuthMode.mode === "cognito");
    window.location.assign("/auth/logout");
  }, [clearIdentity]);

  const value = useMemo(() => ({
    user,
    idToken,
    authMode,
    status,
    error: authError,
    loading: status === "loading",
    isAuthenticated: status === "authenticated" && Boolean(user),
    login,
    signup,
    confirmSignup,
    resendConfirmation,
    forgotPassword,
    resetPassword,
    hostedLogin,
    logout,
    refresh: loadSession,
  }), [authError, authMode, confirmSignup, forgotPassword, hostedLogin, idToken, loadSession, login, logout, resendConfirmation, resetPassword, signup, status, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
