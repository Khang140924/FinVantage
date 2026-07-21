const VALID_BOOLEAN_VALUES = new Set(["true", "false"]);

export class AuthConfigurationError extends Error {
  constructor(code = "AUTH_CONFIG_INVALID") {
    super("Authentication service configuration is invalid.");
    this.name = "AuthConfigurationError";
    this.code = code;
  }
}

export const isProductionAuthRuntime = (env = {}) => {
  const stage = String(env.APP_STAGE || env.STAGE || "").trim().toLowerCase();
  return Boolean(
    env.AWS_LAMBDA_FUNCTION_NAME
    || env.AWS_EXECUTION_ENV
    || String(env.NODE_ENV || "").trim().toLowerCase() === "production"
    || ["prod", "production"].includes(stage)
  );
};

const isLocalHostname = (hostname) => {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized.endsWith(".localhost");
};

const parseProductionUrl = (value) => {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:" || !parsed.hostname || isLocalHostname(parsed.hostname)) return null;
    if (parsed.username || parsed.password) return null;
    return parsed;
  } catch {
    return null;
  }
};

const isCognitoIssuer = (value) => {
  const parsed = parseProductionUrl(value);
  if (!parsed) return false;
  return /^cognito-idp\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/i.test(parsed.hostname)
    && parsed.pathname.split("/").filter(Boolean).length === 1
    && !parsed.search
    && !parsed.hash;
};

const isCognitoDomain = (value) => {
  const parsed = parseProductionUrl(value);
  return Boolean(parsed && ["", "/"].includes(parsed.pathname) && !parsed.search && !parsed.hash);
};

const addUnique = (items, name) => {
  if (!items.includes(name)) items.push(name);
};

export function resolveAuthServerConfig(env = {}) {
  const mockSetting = String(env.USE_MOCK_AUTH || "").trim().toLowerCase();
  const missing = [];
  const invalid = [];
  const isProduction = isProductionAuthRuntime(env);
  if (!VALID_BOOLEAN_VALUES.has(mockSetting)) missing.push("USE_MOCK_AUTH");
  if (!String(env.SESSION_SECRET || "").trim()) missing.push("SESSION_SECRET");

  const mode = mockSetting === "true" ? "mock" : "cognito";
  if (mode === "cognito") {
    if (!String(env.COGNITO_ISSUER || "").trim()) missing.push("COGNITO_ISSUER");
    if (!String(env.COGNITO_CLIENT_ID || "").trim()) missing.push("COGNITO_CLIENT_ID");
  }

  if (isProduction) {
    if (mode === "mock") addUnique(invalid, "USE_MOCK_AUTH");
    if (String(env.SESSION_SECRET || "").trim().length > 0
      && String(env.SESSION_SECRET).trim().length < 32) {
      addUnique(invalid, "SESSION_SECRET");
    }

    if (mode === "cognito") {
      for (const name of ["COGNITO_REDIRECT_URI", "COGNITO_LOGOUT_URI"]) {
        const value = String(env[name] || "").trim();
        if (!value) addUnique(missing, name);
        else if (!parseProductionUrl(value)) addUnique(invalid, name);
      }
      const cognitoDomain = String(env.COGNITO_DOMAIN || "").trim();
      if (!cognitoDomain) addUnique(missing, "COGNITO_DOMAIN");
      else if (!isCognitoDomain(cognitoDomain)) addUnique(invalid, "COGNITO_DOMAIN");

      const redirect = parseProductionUrl(env.COGNITO_REDIRECT_URI);
      const logout = parseProductionUrl(env.COGNITO_LOGOUT_URI);
      if (redirect && (
        !redirect.pathname.endsWith("/auth/callback")
        || redirect.search
        || redirect.hash
      )) {
        addUnique(invalid, "COGNITO_REDIRECT_URI");
      }
      if (logout && (logout.search || logout.hash)) addUnique(invalid, "COGNITO_LOGOUT_URI");
      if (redirect && logout && redirect.origin !== logout.origin) {
        addUnique(invalid, "COGNITO_LOGOUT_URI");
      }
      const scopes = String(env.COGNITO_SCOPES || "openid email profile")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (!scopes.includes("openid") || scopes.some((scope) => !/^[A-Za-z0-9._:/-]+$/.test(scope))) {
        addUnique(invalid, "COGNITO_SCOPES");
      }
      if (String(env.COGNITO_ISSUER || "").trim() && !isCognitoIssuer(env.COGNITO_ISSUER)) {
        addUnique(invalid, "COGNITO_ISSUER");
      }
    }
  }

  const ready = missing.length === 0 && invalid.length === 0;
  const code = missing.length
    ? "AUTH_CONFIG_MISSING"
    : invalid.length
      ? "AUTH_CONFIG_INVALID"
      : null;
  const messages = [];
  if (missing.length) messages.push(`Authentication configuration is missing: ${missing.join(", ")}.`);
  if (invalid.length) messages.push(`Authentication configuration is invalid: ${invalid.join(", ")}.`);

  return {
    mode,
    ready,
    code,
    message: messages.join(" ") || null,
    missing,
    invalid,
  };
}

export function assertProductionAuthConfig(env = {}) {
  const config = resolveAuthServerConfig(env);
  if (isProductionAuthRuntime(env) && !config.ready) {
    throw new AuthConfigurationError(config.code);
  }
  return config;
}

export function discoveryFailure(error) {
  return {
    ready: false,
    code: "COGNITO_DISCOVERY_FAILED",
    message: "Cognito discovery failed. Verify the issuer and network configuration.",
  };
}
