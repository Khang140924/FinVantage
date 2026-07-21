import crypto from "node:crypto";
import express from "express";
import session from "express-session";
import { Issuer, generators } from "openid-client";
import {
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  GetUserCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  AuthConfigurationError,
  discoveryFailure,
  isProductionAuthRuntime,
  resolveAuthServerConfig,
} from "./authConfig.js";

const MOCK_ID_TOKEN = "finvantage-mock-id-token";
const MOCK_CONFIRMATION_CODE = "123456";
const DEFAULT_MOCK_USER = Object.freeze({
  sub: "mock-user",
  email: "mock@example.com",
  name: "Mock User",
  preferred_username: "mock-user",
  email_verified: true,
});
const DEFAULT_SESSION_TTL_SECONDS = 24 * 60 * 60;

const boundedSessionTtlSeconds = (value) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SESSION_TTL_SECONDS;
  return Math.min(Math.max(parsed, 5 * 60), 30 * 24 * 60 * 60);
};

const safeErrorName = (error) => {
  const name = String(error?.name || "AuthError");
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(name) ? name : "AuthError";
};

const sessionStoreError = () => {
  const error = new Error("A persistent authentication session store is required in production.");
  error.name = "AuthSessionStoreError";
  error.code = "AUTH_SESSION_STORE_REQUIRED";
  return error;
};

export function createAuthApp({
  env = process.env,
  logger = console,
  sessionStore,
  sessionTtlSeconds,
  issuerDiscover = Issuer.discover.bind(Issuer),
  oidcClient: initialOidcClient,
  cognitoClient,
} = {}) {
  const serverConfig = resolveAuthServerConfig(env);
  const isMockAuth = serverConfig.mode === "mock";
  const isProduction = isProductionAuthRuntime(env);

  if (isProduction && !serverConfig.ready) {
    throw new AuthConfigurationError(serverConfig.code);
  }
  if (isProduction && !sessionStore) throw sessionStoreError();

  const AWS_REGION = env.AWS_REGION;
  const AWS_REGION_NAME = env.AWS_REGION_NAME;
  const COGNITO_ISSUER = String(env.COGNITO_ISSUER || "").trim();
  const COGNITO_CLIENT_ID = String(env.COGNITO_CLIENT_ID || "").trim();
  const COGNITO_CLIENT_SECRET = String(env.COGNITO_CLIENT_SECRET || "").trim();
  const COGNITO_REDIRECT_URI = String(
    env.COGNITO_REDIRECT_URI || "http://localhost:5174/auth/callback",
  ).trim();
  const COGNITO_LOGOUT_URI = String(
    env.COGNITO_LOGOUT_URI || "http://localhost:5174/",
  ).trim();
  const COGNITO_DOMAIN = String(env.COGNITO_DOMAIN || "").trim();
  const COGNITO_SCOPES = String(env.COGNITO_SCOPES || "openid email profile").trim();
  const sessionSecret = String(env.SESSION_SECRET || "").trim()
    || crypto.randomBytes(32).toString("hex");
  const cookieTtlSeconds = boundedSessionTtlSeconds(
    sessionTtlSeconds ?? env.AUTH_SESSION_TTL_SECONDS,
  );
  const sessionCookieName = "connect.sid";
  const sessionCookieOptions = Object.freeze({
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: cookieTtlSeconds * 1000,
  });
  const regionFromIssuer = COGNITO_ISSUER
    .match(/cognito-idp\.([^.]+)\.amazonaws\.com/)?.[1];

  let authReadiness = {
    ready: serverConfig.ready,
    code: serverConfig.code,
    message: serverConfig.message,
    missing: serverConfig.missing,
    invalid: serverConfig.invalid,
  };
  let oidcClient = initialOidcClient;
  let initializePromise;

  const app = express();
  if (isProduction) app.set("trust proxy", 1);
  app.use(express.json({ limit: "32kb" }));
  app.use(session({
    name: sessionCookieName,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: isProduction,
    ...(sessionStore ? { store: sessionStore } : {}),
    cookie: sessionCookieOptions,
  }));

  const cognito = cognitoClient || new CognitoIdentityProviderClient({
    region: AWS_REGION || AWS_REGION_NAME || regionFromIssuer || "ap-southeast-1",
  });

  const saveSession = (req) => new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });

  const regenerateSession = (req) => new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });

  const secretHash = (username) => {
    if (!COGNITO_CLIENT_SECRET) return undefined;
    return crypto.createHmac("sha256", COGNITO_CLIENT_SECRET)
      .update(`${username}${COGNITO_CLIENT_ID}`)
      .digest("base64");
  };

  const normalizeUserClaims = (claims = {}) => {
    const sub = claims.sub ? String(claims.sub) : null;
    if (!sub) return null;
    const email = claims.email ? String(claims.email) : null;
    const preferredUsername = claims.preferred_username
      ? String(claims.preferred_username)
      : null;
    const name = claims.name ? String(claims.name) : (preferredUsername || email);
    return {
      sub,
      email,
      name,
      preferred_username: preferredUsername,
      email_verified: claims.email_verified === true || claims.email_verified === "true",
    };
  };

  const attributesToUser = (attributes = [], username = "") => {
    const values = Object.fromEntries(attributes.map((item) => [item.Name, item.Value]));
    return normalizeUserClaims({ ...values, sub: values.sub || username });
  };

  const isMockSession = (req) => (
    req.session?.tokenSet?.id_token === MOCK_ID_TOKEN
    || req.session?.userInfo?.sub === DEFAULT_MOCK_USER.sub
  );

  const destroySession = (req) => new Promise((resolve) => {
    if (!req.session) return resolve();
    return req.session.destroy(() => resolve());
  });

  const refreshCognitoSessionIfNeeded = async (req) => {
    const tokenSet = req.session?.tokenSet;
    if (!tokenSet?.id_token) return false;
    const expiresAt = Number(tokenSet.expires_at || 0);
    if (!expiresAt || expiresAt > Math.floor(Date.now() / 1000) + 60) return true;
    if (!tokenSet.refresh_token || !oidcClient) return false;

    try {
      const refreshed = await oidcClient.refresh(tokenSet.refresh_token);
      const claims = typeof refreshed.claims === "function" ? refreshed.claims() : {};
      const userInfo = normalizeUserClaims({ ...req.session.userInfo, ...claims });
      if (!userInfo) return false;
      req.session.tokenSet = {
        id_token: refreshed.id_token,
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token || tokenSet.refresh_token,
        expires_at: refreshed.expires_at,
        token_type: refreshed.token_type,
        scope: refreshed.scope,
      };
      req.session.userInfo = userInfo;
      await saveSession(req);
      return true;
    } catch (error) {
      logger.warn?.("[auth] Cognito session refresh failed", { name: safeErrorName(error) });
      return false;
    }
  };

  const publicAuthError = (error) => {
    if (error?.publicMessage) {
      return {
        status: error.statusCode || 400,
        message: error.publicMessage,
        code: error.publicCode || "AUTH_REQUEST_REJECTED",
      };
    }
    const known = {
      CodeMismatchException: [400, "Mã xác nhận không đúng.", "AUTH_CODE_MISMATCH"],
      ExpiredCodeException: [400, "Mã xác nhận đã hết hạn.", "AUTH_CODE_EXPIRED"],
      InvalidPasswordException: [400, "Mật khẩu chưa đáp ứng chính sách của Cognito.", "AUTH_PASSWORD_INVALID"],
      NotAuthorizedException: [401, "Email hoặc mật khẩu không đúng.", "AUTH_INVALID_CREDENTIALS"],
      PasswordResetRequiredException: [409, "Tài khoản cần đặt lại mật khẩu.", "AUTH_PASSWORD_RESET_REQUIRED"],
      TooManyRequestsException: [429, "Quá nhiều yêu cầu. Vui lòng thử lại sau.", "AUTH_RATE_LIMITED"],
      UserNotConfirmedException: [409, "Email chưa được xác nhận.", "AUTH_USER_NOT_CONFIRMED"],
      UsernameExistsException: [409, "Email này đã được đăng ký.", "AUTH_USERNAME_EXISTS"],
      UserNotFoundException: [404, "Không tìm thấy tài khoản.", "AUTH_USER_NOT_FOUND"],
      InvalidEmail: [400, "Email không hợp lệ.", "AUTH_EMAIL_INVALID"],
    };
    const [status, message, code] = known[error?.name]
      || [500, "Không thể xử lý yêu cầu xác thực.", "AUTH_REQUEST_FAILED"];
    return { status, message, code };
  };

  const authRoute = (handler) => async (req, res) => {
    if (!authReadiness.ready) {
      return res.status(503).json({
        mode: serverConfig.mode,
        ready: false,
        code: authReadiness.code || "AUTH_NOT_READY",
        message: authReadiness.message || "Authentication service is not ready.",
      });
    }
    try {
      return await handler(req, res);
    } catch (error) {
      const publicError = publicAuthError(error);
      logger.error?.("[auth] Request failed", { name: safeErrorName(error) });
      if (!res.headersSent) {
        return res.status(publicError.status).json({
          message: publicError.message,
          code: publicError.code,
        });
      }
      return undefined;
    }
  };

  const validateCredentials = (email, password) => {
    if (!/^\S+@\S+\.\S+$/.test(String(email || ""))) {
      throw Object.assign(new Error(), { name: "InvalidEmail" });
    }
    if (String(password || "").length < 8) {
      throw Object.assign(new Error(), { name: "InvalidPasswordException" });
    }
  };

  const initializeClient = async () => {
    if (!serverConfig.ready || isMockAuth || oidcClient) {
      if (serverConfig.ready && isMockAuth) {
        logger.log?.("[auth] Mock authentication enabled; skipping Cognito discovery.");
      }
      return;
    }
    const issuer = await issuerDiscover(COGNITO_ISSUER);
    oidcClient = new issuer.Client({
      client_id: COGNITO_CLIENT_ID,
      client_secret: COGNITO_CLIENT_SECRET || undefined,
      redirect_uris: [COGNITO_REDIRECT_URI],
      response_types: ["code"],
    });
    logger.log?.("[auth] Cognito clients initialized.");
  };

  const initialize = async () => {
    if (!initializePromise) {
      initializePromise = (async () => {
        if (!serverConfig.ready) return;
        try {
          await initializeClient();
        } catch (error) {
          authReadiness = discoveryFailure(error);
          logger.error?.("[auth] Cognito initialization failed", { name: safeErrorName(error) });
        }
      })();
    }
    await initializePromise;
  };

  const setMockSession = async (req) => {
    await regenerateSession(req);
    req.session.userInfo = DEFAULT_MOCK_USER;
    req.session.tokenSet = { id_token: MOCK_ID_TOKEN, access_token: MOCK_ID_TOKEN };
    await saveSession(req);
  };

  app.get("/auth/config", (_req, res) => {
    const payload = {
      mode: serverConfig.mode,
      ready: authReadiness.ready,
      code: authReadiness.code,
      message: authReadiness.message,
      ...(authReadiness.missing?.length ? { missing: authReadiness.missing } : {}),
      ...(authReadiness.invalid?.length ? { invalid: authReadiness.invalid } : {}),
    };
    return res.status(authReadiness.ready ? 200 : 503).json(payload);
  });

  app.get("/auth/login", authRoute(async (req, res) => {
    if (isMockAuth) {
      await setMockSession(req);
      return res.redirect(COGNITO_LOGOUT_URI || "/");
    }
    if (!oidcClient) {
      return res.status(503).json({
        code: "AUTH_NOT_READY",
        message: "Authentication service is not ready.",
      });
    }
    const nonce = generators.nonce();
    const state = generators.state();
    req.session.nonce = nonce;
    req.session.state = state;
    await saveSession(req);
    return res.redirect(oidcClient.authorizationUrl({
      scope: COGNITO_SCOPES,
      state,
      nonce,
    }));
  }));

  app.post("/auth/login", authRoute(async (req, res) => {
    const { email, password } = req.body || {};
    validateCredentials(email, password);
    if (isMockAuth) {
      await setMockSession(req);
      return res.json({
        ok: true,
        user: req.session.userInfo,
        idToken: MOCK_ID_TOKEN,
        mode: "mock",
      });
    }
    const hash = secretHash(email);
    const result = await cognito.send(new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
        ...(hash ? { SECRET_HASH: hash } : {}),
      },
    }));
    if (!result.AuthenticationResult) {
      return res.status(409).json({
        message: "Cognito requires an authentication step that this screen does not support.",
        code: "AUTH_CHALLENGE_UNSUPPORTED",
      });
    }
    const tokenSet = result.AuthenticationResult;
    const cognitoUser = await cognito.send(new GetUserCommand({
      AccessToken: tokenSet.AccessToken,
    }));
    await regenerateSession(req);
    req.session.userInfo = attributesToUser(cognitoUser.UserAttributes, cognitoUser.Username);
    req.session.username = cognitoUser.Username;
    req.session.tokenSet = {
      id_token: tokenSet.IdToken,
      access_token: tokenSet.AccessToken,
      refresh_token: tokenSet.RefreshToken,
      expires_at: Math.floor(Date.now() / 1000) + Number(tokenSet.ExpiresIn || 3600),
    };
    await saveSession(req);
    return res.json({
      ok: true,
      user: req.session.userInfo,
      idToken: tokenSet.IdToken,
      mode: "cognito",
    });
  }));

  app.post("/auth/signup", authRoute(async (req, res) => {
    const { email, password, displayName } = req.body || {};
    validateCredentials(email, password);
    if (!String(displayName || "").trim()) {
      return res.status(400).json({
        message: "Tên hiển thị là bắt buộc.",
        code: "AUTH_DISPLAY_NAME_REQUIRED",
      });
    }
    if (isMockAuth) {
      return res.json({
        ok: true,
        requiresConfirmation: true,
        delivery: email,
        developmentCode: MOCK_CONFIRMATION_CODE,
      });
    }
    const hash = secretHash(email);
    const result = await cognito.send(new SignUpCommand({
      ClientId: COGNITO_CLIENT_ID,
      Username: email,
      Password: password,
      ...(hash ? { SecretHash: hash } : {}),
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "name", Value: displayName.trim() },
      ],
    }));
    return res.json({
      ok: true,
      requiresConfirmation: !result.UserConfirmed,
      delivery: result.CodeDeliveryDetails?.Destination,
    });
  }));

  app.post("/auth/confirm-signup", authRoute(async (req, res) => {
    const { email, code } = req.body || {};
    if (!email || !code) {
      return res.status(400).json({
        message: "Email và mã xác nhận là bắt buộc.",
        code: "AUTH_CONFIRMATION_REQUIRED",
      });
    }
    if (!isMockAuth) {
      const hash = secretHash(email);
      await cognito.send(new ConfirmSignUpCommand({
        ClientId: COGNITO_CLIENT_ID,
        Username: email,
        ConfirmationCode: code,
        ...(hash ? { SecretHash: hash } : {}),
      }));
    } else if (code !== MOCK_CONFIRMATION_CODE) {
      return res.status(400).json({ message: "Mã mock là 123456.", code: "AUTH_CODE_MISMATCH" });
    }
    return res.json({ ok: true });
  }));

  app.post("/auth/resend-confirmation", authRoute(async (req, res) => {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ message: "Email là bắt buộc.", code: "AUTH_EMAIL_REQUIRED" });
    }
    if (!isMockAuth) {
      const hash = secretHash(email);
      await cognito.send(new ResendConfirmationCodeCommand({
        ClientId: COGNITO_CLIENT_ID,
        Username: email,
        ...(hash ? { SecretHash: hash } : {}),
      }));
    }
    return res.json({
      ok: true,
      developmentCode: isMockAuth ? MOCK_CONFIRMATION_CODE : undefined,
    });
  }));

  app.post("/auth/forgot-password", authRoute(async (req, res) => {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ message: "Email là bắt buộc.", code: "AUTH_EMAIL_REQUIRED" });
    }
    if (!isMockAuth) {
      const hash = secretHash(email);
      await cognito.send(new ForgotPasswordCommand({
        ClientId: COGNITO_CLIENT_ID,
        Username: email,
        ...(hash ? { SecretHash: hash } : {}),
      }));
    }
    return res.json({
      ok: true,
      developmentCode: isMockAuth ? MOCK_CONFIRMATION_CODE : undefined,
    });
  }));

  app.post("/auth/reset-password", authRoute(async (req, res) => {
    const { email, code, newPassword } = req.body || {};
    validateCredentials(email, newPassword);
    if (!code) {
      return res.status(400).json({
        message: "Mã xác nhận là bắt buộc.",
        code: "AUTH_CONFIRMATION_REQUIRED",
      });
    }
    if (!isMockAuth) {
      const hash = secretHash(email);
      await cognito.send(new ConfirmForgotPasswordCommand({
        ClientId: COGNITO_CLIENT_ID,
        Username: email,
        ConfirmationCode: code,
        Password: newPassword,
        ...(hash ? { SecretHash: hash } : {}),
      }));
    } else if (code !== MOCK_CONFIRMATION_CODE) {
      return res.status(400).json({ message: "Mã mock là 123456.", code: "AUTH_CODE_MISMATCH" });
    }
    return res.json({ ok: true });
  }));

  app.get("/auth/callback", authRoute(async (req, res) => {
    if (isMockAuth) return res.redirect(COGNITO_LOGOUT_URI || "/");
    if (!oidcClient) {
      return res.status(503).json({
        code: "AUTH_NOT_READY",
        message: "Authentication service is not ready.",
      });
    }
    const tokenSet = await oidcClient.callback(
      COGNITO_REDIRECT_URI,
      oidcClient.callbackParams(req),
      { nonce: req.session.nonce, state: req.session.state },
    );
    const userInfo = await oidcClient.userinfo(tokenSet.access_token);
    const claims = typeof tokenSet.claims === "function" ? tokenSet.claims() : {};
    const normalizedUser = normalizeUserClaims({ ...claims, ...userInfo });
    if (!normalizedUser) {
      const error = new Error("Cognito did not return a valid subject claim.");
      error.name = "InvalidCognitoClaims";
      throw error;
    }
    await regenerateSession(req);
    req.session.tokenSet = {
      id_token: tokenSet.id_token,
      access_token: tokenSet.access_token,
      refresh_token: tokenSet.refresh_token,
      expires_at: tokenSet.expires_at,
      token_type: tokenSet.token_type,
      scope: tokenSet.scope,
    };
    req.session.userInfo = normalizedUser;
    delete req.session.nonce;
    delete req.session.state;
    await saveSession(req);
    return res.redirect(COGNITO_LOGOUT_URI || "/");
  }));

  app.get("/auth/me", authRoute(async (req, res) => {
    if (!isMockAuth && isMockSession(req)) {
      await destroySession(req);
      return res.json({
        isAuthenticated: false,
        user: null,
        idToken: null,
        mode: "cognito",
      });
    }

    if (isMockAuth) {
      const authenticated = isMockSession(req);
      return res.json({
        isAuthenticated: authenticated,
        user: authenticated ? DEFAULT_MOCK_USER : null,
        idToken: authenticated ? MOCK_ID_TOKEN : null,
        mode: "mock",
      });
    }

    const sessionValid = await refreshCognitoSessionIfNeeded(req);
    const user = sessionValid ? normalizeUserClaims(req.session.userInfo) : null;
    if (!sessionValid || !user) {
      await destroySession(req);
      return res.json({
        isAuthenticated: false,
        user: null,
        idToken: null,
        mode: "cognito",
      });
    }

    req.session.userInfo = user;
    return res.json({
      isAuthenticated: true,
      user,
      idToken: req.session.tokenSet.id_token,
      mode: "cognito",
    });
  }));

  app.get("/auth/logout", (req, res) => req.session.destroy(() => {
    res.clearCookie(sessionCookieName, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      path: "/",
    });
    const logoutEndpoint = COGNITO_DOMAIN
      ? `${COGNITO_DOMAIN.replace(/\/$/, "")}/logout`
      : oidcClient?.issuer?.metadata?.end_session_endpoint;
    if (!isMockAuth && logoutEndpoint) {
      const url = `${logoutEndpoint}?client_id=${encodeURIComponent(COGNITO_CLIENT_ID)}`
        + `&logout_uri=${encodeURIComponent(COGNITO_LOGOUT_URI)}`;
      return res.redirect(url);
    }
    return res.redirect(COGNITO_LOGOUT_URI || "/");
  }));

  app.get("/auth/health", (_req, res) => res
    .status(authReadiness.ready ? 200 : 503)
    .json({
      ok: authReadiness.ready,
      mode: serverConfig.mode,
      ready: authReadiness.ready,
      code: authReadiness.code,
    }));

  app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError && error.status === 400) {
      return res.status(400).json({
        message: "Request body must be valid JSON.",
        code: "INVALID_JSON",
      });
    }
    logger.error?.("[auth] Unhandled request error", { name: safeErrorName(error) });
    return res.status(500).json({
      message: "Authentication service error.",
      code: "AUTH_SERVICE_ERROR",
    });
  });

  return Object.freeze({
    app,
    initialize,
    mode: serverConfig.mode,
    getReadiness: () => ({ ...authReadiness }),
  });
}
