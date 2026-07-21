import assert from 'node:assert/strict';
import test from 'node:test';
import { createImportHandler } from '../src/handlers/createImportHandler.js';

const identity = Object.freeze({
  bucketName: 'test-bucket',
  invoiceId: 'invoice-mock-user-hash',
  fileKey: 'uploads/mock-user/hash_bill.jpg',
  cacheKey: 'ocr:invoice-mock-user-hash'
});

const event = {
  path: '/invoices/import',
  httpMethod: 'POST',
  body: JSON.stringify({ fileName: 'bill.jpg', contentType: 'image/jpeg', fileSize: 12345 })
};

const parse = async (handler) => {
  const result = await handler(event);
  return { statusCode: result.statusCode, body: JSON.parse(result.body) };
};

const dependencies = (t, overrides = {}) => ({
  authenticate: t.mock.fn(async () => ({ user: { sub: 'mock-user' } })),
  buildUploadIdentity: t.mock.fn(() => ({ ...identity })),
  signUploadUrl: t.mock.fn(async () => 'https://s3.example.test/signed-upload'),
  findInvoice: t.mock.fn(async () => null),
  getCachedInvoice: t.mock.fn(async () => null),
  cacheUpload: t.mock.fn(async () => undefined),
  log: {
    info: t.mock.fn(),
    warn: t.mock.fn(),
    error: t.mock.fn()
  },
  ...overrides
});

test('new import returns UPLOAD_PENDING zero progress and caches no completed upload', async (t) => {
  const deps = dependencies(t);
  const result = await parse(createImportHandler(deps));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, 'UPLOAD_PENDING');
  assert.equal(result.body.progress, 0);
  assert.equal(result.body.uploadRequired, true);
  assert.equal(result.body.uploadConfirmed, false);
  assert.equal(result.body.uploadUrl, 'https://s3.example.test/signed-upload');
  assert.equal(result.body.invoiceId, identity.invoiceId);
  assert.equal(result.body.fileKey, identity.fileKey);
  assert.equal(result.body.cacheKey, identity.cacheKey);
  assert.equal(deps.signUploadUrl.mock.calls[0].arguments[2].fileSize, 12345);
  assert.equal(deps.cacheUpload.mock.calls.length, 1);
  assert.equal(deps.cacheUpload.mock.calls[0].arguments[1].status, 'UPLOAD_PENDING');
  assert.equal(deps.cacheUpload.mock.calls[0].arguments[1].progress, 0);
  assert.equal(deps.cacheUpload.mock.calls[0].arguments[1].fileSize, 12345);
});

test('missing signer credentials return sanitized 503 without caching', async (t) => {
  const rawMessage = 'Could not load credentials from any providers at C:\\private\\profile';
  const deps = dependencies(t, {
    signUploadUrl: t.mock.fn(async () => {
      throw Object.assign(new Error(rawMessage), { name: 'CredentialsProviderError' });
    })
  });
  const result = await parse(createImportHandler(deps));
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.code, 'AWS_CREDENTIALS_MISSING');
  assert.equal(result.body.message, 'Chưa cấu hình AWS credentials cho môi trường local.');
  assert.equal(result.body.stage, 'IMPORT_PRESIGN');
  assert.equal(result.body.retryable, false);
  assert.doesNotMatch(result.body.message, /private|profile/i);
  assert.equal(deps.cacheUpload.mock.calls.length, 0);
});

test('an analyzed invoice returns without invoking the AWS signer', async (t) => {
  const deps = dependencies(t, {
    findInvoice: t.mock.fn(async () => ({ id: identity.invoiceId, status: 'ANALYZED' }))
  });
  const result = await parse(createImportHandler(deps));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, 'ANALYZED');
  assert.equal(result.body.uploadRequired, false);
  assert.equal(result.body.uploadUrl, undefined);
  assert.equal(deps.signUploadUrl.mock.calls.length, 0);
  assert.equal(deps.getCachedInvoice.mock.calls.length, 0);
});

test('resumable uploaded work returns without invoking the AWS signer', async (t) => {
  const deps = dependencies(t, {
    getCachedInvoice: t.mock.fn(async () => ({
      userId: 'mock-user',
      status: 'OCR_PROCESSING',
      progress: 35,
      uploadConfirmed: true
    }))
  });
  const result = await parse(createImportHandler(deps));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, 'OCR_PROCESSING');
  assert.equal(result.body.progress, 35);
  assert.equal(result.body.uploadRequired, false);
  assert.equal(deps.signUploadUrl.mock.calls.length, 0);
});

test('cached pending work receives a fresh signed URL and remains at zero', async (t) => {
  const deps = dependencies(t, {
    getCachedInvoice: t.mock.fn(async () => ({
      userId: 'mock-user',
      status: 'UPLOAD_PENDING',
      progress: 0,
      uploadConfirmed: false
    }))
  });
  const result = await parse(createImportHandler(deps));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, 'UPLOAD_PENDING');
  assert.equal(result.body.progress, 0);
  assert.equal(result.body.uploadRequired, true);
  assert.equal(result.body.uploadUrl, 'https://s3.example.test/signed-upload');
  assert.equal(deps.signUploadUrl.mock.calls.length, 1);
});
