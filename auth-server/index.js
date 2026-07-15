import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import { Issuer, generators } from 'openid-client';

const {
  COGNITO_ISSUER,
  COGNITO_CLIENT_ID,
  COGNITO_CLIENT_SECRET,
  COGNITO_REDIRECT_URI = 'http://localhost:5173/auth/callback',
  COGNITO_LOGOUT_URI = 'http://localhost:5173/',
  COGNITO_DOMAIN = '',
  COGNITO_SCOPES = 'openid email profile',
  SESSION_SECRET = 'finvantage-dev-secret-change-me',
  AUTH_SERVER_PORT = '4000',
} = process.env;

const app = express();

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: false },
  })
);

app.use(express.json());

let client;

async function initializeClient() {
  if (!COGNITO_ISSUER || !COGNITO_CLIENT_ID) {
    throw new Error('Missing COGNITO_ISSUER or COGNITO_CLIENT_ID env vars.');
  }

  const issuer = await Issuer.discover(COGNITO_ISSUER);
  client = new issuer.Client({
    client_id: COGNITO_CLIENT_ID,
    client_secret: COGNITO_CLIENT_SECRET,
    redirect_uris: [COGNITO_REDIRECT_URI],
    response_types: ['code'],
  });

  console.log('[auth] Cognito OIDC client initialized for', COGNITO_ISSUER);
}

app.get('/auth/login', (req, res) => {
  if (!client) {
    return res.status(500).send('Auth client not ready');
  }

  const nonce = generators.nonce();
  const state = generators.state();

  req.session.nonce = nonce;
  req.session.state = state;

  const authUrl = client.authorizationUrl({
    scope: COGNITO_SCOPES,
    state,
    nonce,
  });

  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  if (!client) {
    return res.status(500).send('Auth client not ready');
  }

  try {
    const params = client.callbackParams(req);
    const tokenSet = await client.callback(
      COGNITO_REDIRECT_URI,
      params,
      {
        nonce: req.session.nonce,
        state: req.session.state,
      }
    );

    const userInfo = await client.userinfo(tokenSet.access_token);
    req.session.tokenSet = tokenSet;
    req.session.userInfo = userInfo;

    res.redirect(COGNITO_LOGOUT_URI || '/');
  } catch (err) {
    console.error('[auth] Callback error:', err);
    res.status(400).send(`Authentication failed: ${err.message}`);
  }
});

app.get('/auth/me', (req, res) => {
  const isAuthenticated = Boolean(req.session?.userInfo);

  res.json({
    isAuthenticated,
    user: req.session?.userInfo || null,
    idToken: req.session?.tokenSet?.id_token || null,
  });
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => {});

  if (COGNITO_DOMAIN) {
    const logoutUrl = `${COGNITO_DOMAIN.replace(/\/$/, '')}/logout?client_id=${COGNITO_CLIENT_ID}&logout_uri=${encodeURIComponent(
      COGNITO_LOGOUT_URI
    )}`;
    return res.redirect(logoutUrl);
  }

  res.redirect(COGNITO_LOGOUT_URI || '/');
});

app.get('/auth/health', (_req, res) => res.json({ ok: true }));

initializeClient()
  .then(() => {
    app.listen(Number(AUTH_SERVER_PORT), () => {
      console.log(`[auth] Auth BFF listening on http://localhost:${AUTH_SERVER_PORT}`);
    });
  })
  .catch((err) => {
    console.error('[auth] Failed to initialize Cognito client:', err);
    process.exit(1);
  });
