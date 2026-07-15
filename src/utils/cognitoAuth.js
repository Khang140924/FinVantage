import { CognitoJwtVerifier } from 'aws-jwt-verify';
import * as response from './response.js';
import { logger } from './logger.js';

const verifier = (() => {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;

  if (!userPoolId || !clientId) {
    logger.warn('Cognito verifier not configured; COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID missing');
    return null;
  }

  return CognitoJwtVerifier.create({
    userPoolId,
    clientId,
    tokenUse: 'id',
  });
})();

const extractToken = (event = {}) => {
  const header = event.headers?.Authorization || event.headers?.authorization;
  if (!header) return null;

  return header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim();
};

export const getAuthUser = async (event = {}) => {
  if (process.env.USE_MOCK_AUTH === 'true') {
    return { sub: 'mock-user', email: 'mock@example.com', name: 'Mock User' };
  }

  if (!verifier) {
    const error = new Error('Authentication is not configured on the server.');
    error.statusCode = 500;
    throw error;
  }

  const token = extractToken(event);
  if (!token) {
    const error = new Error('Thiếu Authorization token (Missing bearer token).');
    error.statusCode = 401;
    throw error;
  }

  try {
    const claims = await verifier.verify(token);

    return {
      sub: claims.sub,
      email: claims.email,
      name: claims.name || claims.email,
      emailVerified: claims.email_verified,
    };
  } catch (error) {
    logger.warn('Cognito token verification failed', { error: error.message });
    const authError = new Error('Token không hợp lệ hoặc đã hết hạn (Invalid or expired token).');
    authError.statusCode = 401;
    throw authError;
  }
};

export const requireAuth = async (event = {}) => {
  try {
    const user = await getAuthUser(event);
    return { user };
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const payload =
      statusCode === 401
        ? response.unauthorized(error.message)
        : response.serverError(error.message);

    return { error: payload };
  }
};
