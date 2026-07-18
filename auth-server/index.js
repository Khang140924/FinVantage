import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import session from 'express-session';
import { Issuer, generators } from 'openid-client';
import {
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  GetUserCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const {
  AWS_REGION,
  AWS_REGION_NAME,
  COGNITO_ISSUER,
  COGNITO_CLIENT_ID,
  COGNITO_CLIENT_SECRET,
  COGNITO_REDIRECT_URI = 'http://localhost:5174/auth/callback',
  COGNITO_LOGOUT_URI = 'http://localhost:5174/',
  COGNITO_DOMAIN = '',
  COGNITO_SCOPES = 'openid email profile',
  SESSION_SECRET = 'finvantage-dev-secret-change-me',
  AUTH_SERVER_PORT = '4000',
  USE_MOCK_AUTH = 'false',
  NODE_ENV = 'development',
} = process.env;

const isMockAuth = USE_MOCK_AUTH === 'true';
const isProduction = NODE_ENV === 'production';
const MOCK_ID_TOKEN = 'finvantage-mock-id-token';
const MOCK_CONFIRMATION_CODE = '123456';
const DEFAULT_MOCK_USER = {
  sub: 'mock-user',
  email: 'mock@example.com',
  name: 'Mock User',
  preferred_username: 'mock-user',
  email_verified: true,
};
const regionFromIssuer = COGNITO_ISSUER?.match(/cognito-idp\.([^.]+)\.amazonaws\.com/)?.[1];

const app = express();
if (isProduction) app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 24 * 60 * 60 * 1000 },
}));

const cognito = new CognitoIdentityProviderClient({
  region: AWS_REGION || AWS_REGION_NAME || regionFromIssuer || 'ap-southeast-1',
});
let oidcClient;

const saveSession = (req) => new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));

const secretHash = (username) => {
  if (!COGNITO_CLIENT_SECRET) return undefined;
  return crypto.createHmac('sha256', COGNITO_CLIENT_SECRET)
    .update(`${username}${COGNITO_CLIENT_ID}`)
    .digest('base64');
};

const attributesToUser = (attributes = [], username = '') => {
  const values = Object.fromEntries(attributes.map((item) => [item.Name, item.Value]));
  return normalizeUserClaims({ ...values, sub: values.sub || username });
};

const normalizeUserClaims = (claims = {}) => {
  const sub = claims.sub ? String(claims.sub) : null;
  if (!sub) return null;
  const email = claims.email ? String(claims.email) : null;
  const preferredUsername = claims.preferred_username ? String(claims.preferred_username) : null;
  const name = claims.name ? String(claims.name) : (preferredUsername || email);
  return {
    sub,
    email,
    name,
    preferred_username: preferredUsername,
    email_verified: claims.email_verified === true || claims.email_verified === 'true',
  };
};

const isMockSession = (req) => (
  req.session?.tokenSet?.id_token === MOCK_ID_TOKEN || req.session?.userInfo?.sub === DEFAULT_MOCK_USER.sub
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
    const claims = typeof refreshed.claims === 'function' ? refreshed.claims() : {};
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
    console.warn('[auth] Cognito session refresh failed:', error?.name || error?.message);
    return false;
  }
};

const publicAuthError = (error) => {
  if (error?.publicMessage) return [error.statusCode || 400, error.publicMessage];
  const known = {
    CodeMismatchException: [400, 'Mã xác nhận không đúng.'],
    ExpiredCodeException: [400, 'Mã xác nhận đã hết hạn.'],
    InvalidPasswordException: [400, 'Mật khẩu chưa đáp ứng chính sách của Cognito.'],
    NotAuthorizedException: [401, 'Email hoặc mật khẩu không đúng.'],
    PasswordResetRequiredException: [409, 'Tài khoản cần đặt lại mật khẩu.'],
    TooManyRequestsException: [429, 'Quá nhiều yêu cầu. Vui lòng thử lại sau.'],
    UserNotConfirmedException: [409, 'Email chưa được xác nhận.'],
    UsernameExistsException: [409, 'Email này đã được đăng ký.'],
    UserNotFoundException: [404, 'Không tìm thấy tài khoản.'],
    InvalidEmail: [400, 'Email không hợp lệ.'],
  };
  return known[error?.name] || [500, 'Không thể xử lý yêu cầu xác thực.'];
};

const authRoute = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    const [status, message] = publicAuthError(error);
    console.error('[auth] Request failed:', error?.name || error?.message);
    if (!res.headersSent) res.status(status).json({ message, code: error?.name || 'AUTH_ERROR' });
  }
};

const validateCredentials = (email, password) => {
  if (!/^\S+@\S+\.\S+$/.test(String(email || ''))) throw Object.assign(new Error(), { name: 'InvalidEmail' });
  if (String(password || '').length < 8) throw Object.assign(new Error(), { name: 'InvalidPasswordException' });
};

async function initializeClient() {
  if (isMockAuth) {
    console.log('[auth] Mock authentication enabled; skipping Cognito discovery.');
    return;
  }
  if (!COGNITO_ISSUER || !COGNITO_CLIENT_ID) throw new Error('Missing COGNITO_ISSUER or COGNITO_CLIENT_ID env vars.');
  const issuer = await Issuer.discover(COGNITO_ISSUER);
  oidcClient = new issuer.Client({
    client_id: COGNITO_CLIENT_ID,
    client_secret: COGNITO_CLIENT_SECRET,
    redirect_uris: [COGNITO_REDIRECT_URI],
    response_types: ['code'],
  });
  console.log('[auth] Cognito clients initialized.');
}

const setMockSession = async (req) => {
  req.session.userInfo = DEFAULT_MOCK_USER;
  req.session.tokenSet = { id_token: MOCK_ID_TOKEN, access_token: MOCK_ID_TOKEN };
  await saveSession(req);
};

app.get('/auth/config', (_req, res) => res.json({ mode: isMockAuth ? 'mock' : 'cognito' }));

// Hosted UI fallback for deployments that don't enable ALLOW_USER_PASSWORD_AUTH.
app.get('/auth/login', authRoute(async (req, res) => {
  if (isMockAuth) {
    await setMockSession(req);
    return res.redirect(COGNITO_LOGOUT_URI || '/');
  }
  if (!oidcClient) return res.status(503).send('Auth client not ready');
  const nonce = generators.nonce();
  const state = generators.state();
  req.session.nonce = nonce;
  req.session.state = state;
  await saveSession(req);
  return res.redirect(oidcClient.authorizationUrl({ scope: COGNITO_SCOPES, state, nonce }));
}));

app.post('/auth/login', authRoute(async (req, res) => {
  const { email, password } = req.body || {};
  validateCredentials(email, password);
  if (isMockAuth) {
    await setMockSession(req);
    return res.json({ ok: true, user: req.session.userInfo, idToken: MOCK_ID_TOKEN, mode: 'mock' });
  }
  const hash = secretHash(email);
  const result = await cognito.send(new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: COGNITO_CLIENT_ID,
    AuthParameters: { USERNAME: email, PASSWORD: password, ...(hash ? { SECRET_HASH: hash } : {}) },
  }));
  if (!result.AuthenticationResult) return res.status(409).json({ message: `Cognito challenge ${result.ChallengeName || 'required'} is not supported by this screen.` });
  const tokenSet = result.AuthenticationResult;
  const cognitoUser = await cognito.send(new GetUserCommand({ AccessToken: tokenSet.AccessToken }));
  req.session.userInfo = attributesToUser(cognitoUser.UserAttributes, cognitoUser.Username);
  req.session.username = cognitoUser.Username;
  req.session.tokenSet = {
    id_token: tokenSet.IdToken,
    access_token: tokenSet.AccessToken,
    refresh_token: tokenSet.RefreshToken,
    expires_at: Math.floor(Date.now() / 1000) + Number(tokenSet.ExpiresIn || 3600),
  };
  await saveSession(req);
  return res.json({ ok: true, user: req.session.userInfo, idToken: tokenSet.IdToken, mode: 'cognito' });
}));

app.post('/auth/signup', authRoute(async (req, res) => {
  const { email, password, displayName } = req.body || {};
  validateCredentials(email, password);
  if (!String(displayName || '').trim()) return res.status(400).json({ message: 'Tên hiển thị là bắt buộc.' });
  if (isMockAuth) return res.json({ ok: true, requiresConfirmation: true, delivery: email, developmentCode: MOCK_CONFIRMATION_CODE });
  const hash = secretHash(email);
  const result = await cognito.send(new SignUpCommand({
    ClientId: COGNITO_CLIENT_ID,
    Username: email,
    Password: password,
    ...(hash ? { SecretHash: hash } : {}),
    UserAttributes: [{ Name: 'email', Value: email }, { Name: 'name', Value: displayName.trim() }],
  }));
  return res.json({ ok: true, requiresConfirmation: !result.UserConfirmed, delivery: result.CodeDeliveryDetails?.Destination });
}));

app.post('/auth/confirm-signup', authRoute(async (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ message: 'Email và mã xác nhận là bắt buộc.' });
  if (!isMockAuth) {
    const hash = secretHash(email);
    await cognito.send(new ConfirmSignUpCommand({ ClientId: COGNITO_CLIENT_ID, Username: email, ConfirmationCode: code, ...(hash ? { SecretHash: hash } : {}) }));
  } else if (code !== MOCK_CONFIRMATION_CODE) {
    return res.status(400).json({ message: 'Mã mock là 123456.' });
  }
  return res.json({ ok: true });
}));

app.post('/auth/resend-confirmation', authRoute(async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ message: 'Email là bắt buộc.' });
  if (!isMockAuth) {
    const hash = secretHash(email);
    await cognito.send(new ResendConfirmationCodeCommand({ ClientId: COGNITO_CLIENT_ID, Username: email, ...(hash ? { SecretHash: hash } : {}) }));
  }
  return res.json({ ok: true, developmentCode: isMockAuth ? MOCK_CONFIRMATION_CODE : undefined });
}));

app.post('/auth/forgot-password', authRoute(async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ message: 'Email là bắt buộc.' });
  if (!isMockAuth) {
    const hash = secretHash(email);
    await cognito.send(new ForgotPasswordCommand({ ClientId: COGNITO_CLIENT_ID, Username: email, ...(hash ? { SecretHash: hash } : {}) }));
  }
  return res.json({ ok: true, developmentCode: isMockAuth ? MOCK_CONFIRMATION_CODE : undefined });
}));

app.post('/auth/reset-password', authRoute(async (req, res) => {
  const { email, code, newPassword } = req.body || {};
  validateCredentials(email, newPassword);
  if (!code) return res.status(400).json({ message: 'Mã xác nhận là bắt buộc.' });
  if (!isMockAuth) {
    const hash = secretHash(email);
    await cognito.send(new ConfirmForgotPasswordCommand({ ClientId: COGNITO_CLIENT_ID, Username: email, ConfirmationCode: code, Password: newPassword, ...(hash ? { SecretHash: hash } : {}) }));
  } else if (code !== MOCK_CONFIRMATION_CODE) {
    return res.status(400).json({ message: 'Mã mock là 123456.' });
  }
  return res.json({ ok: true });
}));

app.get('/auth/callback', authRoute(async (req, res) => {
  if (isMockAuth) return res.redirect(COGNITO_LOGOUT_URI || '/');
  if (!oidcClient) return res.status(503).send('Auth client not ready');
  const tokenSet = await oidcClient.callback(COGNITO_REDIRECT_URI, oidcClient.callbackParams(req), { nonce: req.session.nonce, state: req.session.state });
  const userInfo = await oidcClient.userinfo(tokenSet.access_token);
  const claims = typeof tokenSet.claims === 'function' ? tokenSet.claims() : {};
  const normalizedUser = normalizeUserClaims({ ...claims, ...userInfo });
  if (!normalizedUser) throw new Error('Cognito did not return a valid sub claim.');
  req.session.tokenSet = {
    id_token: tokenSet.id_token,
    access_token: tokenSet.access_token,
    refresh_token: tokenSet.refresh_token,
    expires_at: tokenSet.expires_at,
    token_type: tokenSet.token_type,
    scope: tokenSet.scope,
  };
  req.session.userInfo = normalizedUser;
  await saveSession(req);
  return res.redirect(COGNITO_LOGOUT_URI || '/');
}));

app.get('/auth/me', authRoute(async (req, res) => {
  if (!isMockAuth && isMockSession(req)) {
    await destroySession(req);
    return res.json({ isAuthenticated: false, user: null, idToken: null, mode: 'cognito' });
  }

  if (isMockAuth) {
    const authenticated = isMockSession(req);
    return res.json({
      isAuthenticated: authenticated,
      user: authenticated ? DEFAULT_MOCK_USER : null,
      idToken: authenticated ? MOCK_ID_TOKEN : null,
      mode: 'mock'
    });
  }

  const sessionValid = await refreshCognitoSessionIfNeeded(req);
  const user = sessionValid ? normalizeUserClaims(req.session.userInfo) : null;
  if (!sessionValid || !user) {
    await destroySession(req);
    return res.json({ isAuthenticated: false, user: null, idToken: null, mode: 'cognito' });
  }

  req.session.userInfo = user;
  return res.json({
    isAuthenticated: true,
    user,
    idToken: req.session.tokenSet.id_token,
    mode: 'cognito'
  });
}));

app.get('/auth/logout', (req, res) => req.session.destroy(() => {
  const logoutEndpoint = COGNITO_DOMAIN
    ? `${COGNITO_DOMAIN.replace(/\/$/, '')}/logout`
    : oidcClient?.issuer?.metadata?.end_session_endpoint;
  if (!isMockAuth && logoutEndpoint) {
    const url = `${logoutEndpoint}?client_id=${encodeURIComponent(COGNITO_CLIENT_ID)}&logout_uri=${encodeURIComponent(COGNITO_LOGOUT_URI)}`;
    return res.redirect(url);
  }
  return res.redirect(COGNITO_LOGOUT_URI || '/');
}));

app.get('/auth/health', (_req, res) => res.json({ ok: true, mode: isMockAuth ? 'mock' : 'cognito' }));

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ message: 'Request body must be valid JSON.' });
  console.error('[auth] Unhandled request error:', error?.name || error?.message);
  return res.status(500).json({ message: 'Authentication service error.' });
});

initializeClient().then(() => app.listen(Number(AUTH_SERVER_PORT), () => {
  console.log(`[auth] Auth BFF listening on http://localhost:${AUTH_SERVER_PORT}`);
})).catch((error) => {
  console.error('[auth] Failed to initialize:', error);
  process.exit(1);
});
