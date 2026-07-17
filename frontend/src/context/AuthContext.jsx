import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const AUTH_STORAGE_KEY = "finvantage-id-token";
const MOCK_ID_TOKEN = "finvantage-mock-id-token";
const AuthContext = createContext(null);

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
    if (!response.ok) throw new Error(data.message || "Authentication request failed.");
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Authentication server timed out.");
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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [idToken, setIdToken] = useState(null);
  const [authMode, setAuthMode] = useState("unknown");
  const [status, setStatus] = useState("loading");
  const [authError, setAuthError] = useState(null);

  const loadSession = useCallback(async () => {
    setStatus("loading");
    setAuthError(null);
    try {
      const data = await authRequest("/auth/me", { method: "GET", headers: {} });
      setAuthMode(data.mode || "cognito");
      const invalidMockFallback = data.mode === "cognito" && (
        data.idToken === MOCK_ID_TOKEN || data.user?.sub === "mock-user"
      );
      if (data.isAuthenticated && data.idToken && !invalidMockFallback) {
        setUser(data.user); setIdToken(data.idToken); persistToken(data.idToken);
        setStatus("authenticated");
      } else {
        setUser(null); setIdToken(null); persistToken(null);
        setStatus("unauthenticated");
      }
    } catch (sessionError) {
      setUser(null); setIdToken(null); persistToken(null);
      setAuthError(sessionError.message || "Không thể khôi phục phiên đăng nhập.");
      try { const config = await authRequest("/auth/config", { method: "GET", headers: {} }); setAuthMode(config.mode); }
      catch { setAuthMode("unavailable"); }
      setStatus("error");
    }
  }, []);

  useEffect(() => { loadSession(); }, [loadSession]);
  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setIdToken(null);
      setAuthError(null);
      setStatus("unauthenticated");
      persistToken(null);
    };
    window.addEventListener("finvantage:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("finvantage:unauthorized", handleUnauthorized);
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await authRequest("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    if (data.mode === "cognito" && (data.idToken === MOCK_ID_TOKEN || data.user?.sub === "mock-user")) {
      throw new Error("Cognito authentication returned an invalid development identity.");
    }
    setUser(data.user); setIdToken(data.idToken); persistToken(data.idToken); setStatus("authenticated"); setAuthError(null);
    return data;
  }, []);

  const signup = useCallback((payload) => authRequest("/auth/signup", { method: "POST", body: JSON.stringify(payload) }), []);
  const confirmSignup = useCallback((email, code) => authRequest("/auth/confirm-signup", { method: "POST", body: JSON.stringify({ email, code }) }), []);
  const resendConfirmation = useCallback((email) => authRequest("/auth/resend-confirmation", { method: "POST", body: JSON.stringify({ email }) }), []);
  const forgotPassword = useCallback((email) => authRequest("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }), []);
  const resetPassword = useCallback((email, code, newPassword) => authRequest("/auth/reset-password", { method: "POST", body: JSON.stringify({ email, code, newPassword }) }), []);
  const hostedLogin = useCallback(() => { window.location.href = "/auth/login"; }, []);
  const logout = useCallback(() => { persistToken(null); setUser(null); setIdToken(null); setStatus("unauthenticated"); window.location.href = "/auth/logout"; }, []);

  const value = useMemo(() => ({
    user, idToken, authMode, status, error: authError, loading: status === "loading", isAuthenticated: status === "authenticated" && Boolean(user), login, signup,
    confirmSignup, resendConfirmation, forgotPassword, resetPassword,
    hostedLogin, logout, refresh: loadSession,
  }), [authError, authMode, confirmSignup, forgotPassword, hostedLogin, idToken, loadSession, login, logout, resendConfirmation, resetPassword, signup, status, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
