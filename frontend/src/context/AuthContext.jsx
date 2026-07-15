import { createContext, useContext, useCallback, useEffect, useState } from "react";

const AUTH_STORAGE_KEY = "finvantage-id-token";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [idToken, setIdToken] = useState(() => {
    try {
      return window.localStorage.getItem(AUTH_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  const loadSession = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/auth/me", { credentials: "include" });
      const data = await response.json();

      if (data.isAuthenticated && data.idToken) {
        setUser(data.user);
        setIdToken(data.idToken);
        try {
          window.localStorage.setItem(AUTH_STORAGE_KEY, data.idToken);
        } catch {
          // Ignore storage failures (private mode).
        }
      } else {
        setUser(null);
        setIdToken(null);
        try {
          window.localStorage.removeItem(AUTH_STORAGE_KEY);
        } catch {
          // Ignore storage failures.
        }
      }
    } catch {
      setUser(null);
      setIdToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const login = useCallback(() => {
    window.location.href = "/auth/login";
  }, []);

  const logout = useCallback(() => {
    try {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
    setUser(null);
    setIdToken(null);
    window.location.href = "/auth/logout";
  }, []);

  const value = {
    user,
    idToken,
    loading,
    isAuthenticated: Boolean(user),
    login,
    logout,
    refresh: loadSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return context;
}
