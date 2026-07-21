import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('production Lambda config loads the managed Amazon CA bundle for RDS TLS', () => {
  const originalArgv = [...process.argv];
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    process.argv = [...process.argv, '--stage', 'prod'];
    process.env.NODE_ENV = 'production';
    delete require.cache[require.resolve('../scripts/serverless-env.cjs')];
    const { runtime } = require('../scripts/serverless-env.cjs');
    assert.equal(runtime.nodeExtraCaCerts, '/var/runtime/ca-cert.pem');
  } finally {
    process.argv = originalArgv;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test('public handlers do not return raw exception messages or log the complete payment event', async () => {
  const files = [
    '../src/handlers/profileHandler.js',
    '../src/handlers/notificationHandler.js',
    '../src/handlers/paymentHandler.js'
  ];
  const sources = await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), 'utf8')));

  for (const source of sources) {
    assert.doesNotMatch(source, /response\.[^\n]*\$\{error\.message\}/);
    assert.doesNotMatch(source, /message\s*:\s*error\.message/);
  }
  assert.doesNotMatch(sources[2], /logger\.info\([^;]*\{\s*event\s*\}\s*\)/s);
  assert.match(sources[0], /PROFILE_REQUEST_FAILED/);
  assert.match(sources[1], /NOTIFICATION_REQUEST_FAILED/);
  assert.match(sources[2], /PAYMENT_REQUEST_FAILED/);
});
