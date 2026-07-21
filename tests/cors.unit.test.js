import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCorsHeaders,
  getApiAllowedOrigin,
  preflight,
  resolveCorsOrigin,
  sendResponse
} from '../src/utils/response.js';

test('local CORS uses the Vite origin and includes idempotency preflight headers', () => {
  const headers = buildCorsHeaders({});
  assert.equal(headers['Access-Control-Allow-Origin'], 'http://localhost:5174');
  assert.match(headers['Access-Control-Allow-Headers'], /Idempotency-Key/);
  assert.match(headers['Access-Control-Allow-Methods'], /PATCH/);
  assert.equal(headers['Access-Control-Allow-Credentials'], undefined);
});

test('production CORS uses exactly the configured origin', () => {
  const env = { API_ALLOWED_ORIGIN: 'https://app.example.invalid' };
  assert.equal(getApiAllowedOrigin(env), 'https://app.example.invalid');
  assert.equal(resolveCorsOrigin('https://app.example.invalid', env), 'https://app.example.invalid');
  assert.equal(resolveCorsOrigin('https://attacker.example.invalid', env), null);
});

test('wildcard CORS configuration is rejected', () => {
  assert.throws(
    () => sendResponse(200, {}, { env: { API_ALLOWED_ORIGIN: '*' } }),
    (error) => error.code === 'INVALID_API_ALLOWED_ORIGIN'
  );
});

test('preflight allows the configured origin and rejects an unknown origin', () => {
  const env = { API_ALLOWED_ORIGIN: 'https://app.example.invalid' };
  assert.equal(preflight({ headers: { origin: 'https://app.example.invalid' } }, env).statusCode, 204);
  const denied = preflight({ headers: { origin: 'https://attacker.example.invalid' } }, env);
  assert.equal(denied.statusCode, 403);
  assert.match(denied.body, /CORS_ORIGIN_DENIED/);
});
