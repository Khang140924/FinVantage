import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePipelineProgress } from '../src/utils/invoicePipeline.js';
import {
  awsErrorTranslationKey,
  continueAfterSuccessfulUpload,
  evaluateTrackedTrigger,
  failureStepForStage,
  isAwsConfigurationCode,
  resolveUploadProgress
} from '../frontend/src/utils/uploadPipeline.js';

test('cached explicit progress zero stays zero', () => {
  assert.equal(resolvePipelineProgress({ status: 'UPLOAD_PENDING', progress: 0 }), 0);
  assert.equal(resolvePipelineProgress({ status: 'UPLOADED', progress: 0 }), 0);
  assert.equal(resolvePipelineProgress({ status: 'UPLOADED' }), 25);
});

test('resolved tracked trigger that is not ready continues polling', (t) => {
  const ready = t.mock.fn((result) => result?.status === 'ANALYZED');
  const state = evaluateTrackedTrigger({
    settled: true,
    result: { status: 'ANALYZING', progress: 75 },
    error: null,
    ready,
    isRecoverable: () => false
  });
  assert.equal(state.shouldReturn, false);
  assert.equal(state.error, null);
  assert.equal(ready.mock.calls.length, 1);

  const completed = evaluateTrackedTrigger({
    settled: true,
    result: { status: 'ANALYZED', progress: 100 },
    error: null,
    ready,
    isRecoverable: () => false
  });
  assert.equal(completed.shouldReturn, true);
  assert.equal(completed.result.status, 'ANALYZED');
});

test('non-2xx signed PUT failure stops OCR and analysis continuation', async (t) => {
  const response = { ok: false, status: 403 };
  const upload = t.mock.fn(async () => {
    if (!response.ok) {
      throw Object.assign(new Error(`S3 upload failed with status ${response.status}.`), {
        code: 'S3_UPLOAD_FAILED',
        status: response.status
      });
    }
  });
  const runOcr = t.mock.fn(async () => undefined);
  const analyze = t.mock.fn(async () => undefined);
  const continuePipeline = t.mock.fn(async () => {
    await runOcr();
    await analyze();
  });

  await assert.rejects(
    continueAfterSuccessfulUpload({ upload, continuePipeline }),
    (error) => error.code === 'S3_UPLOAD_FAILED' && error.status === 403
  );
  assert.equal(upload.mock.calls.length, 1);
  assert.equal(continuePipeline.mock.calls.length, 0);
  assert.equal(runOcr.mock.calls.length, 0);
  assert.equal(analyze.mock.calls.length, 0);
});

test('frontend starts at zero and advances to 25 only from explicit uploaded progress', () => {
  assert.equal(resolveUploadProgress({ stepIndex: 0 }), 0);
  assert.equal(resolveUploadProgress({ pipelineProgress: 0, stepIndex: 1 }), 0);
  assert.equal(resolveUploadProgress({ pipelineProgress: 25, stepIndex: 1 }), 25);
  assert.equal(resolveUploadProgress({ isComplete: true, stepIndex: 3 }), 100);
});

test('failure stages and stable AWS codes drive explicit non-downstream UI state', () => {
  assert.equal(failureStepForStage('import'), 0);
  assert.equal(failureStepForStage('upload'), 0);
  assert.equal(failureStepForStage('ocr'), 1);
  assert.equal(failureStepForStage('analyze'), 2);
  assert.equal(isAwsConfigurationCode('AWS_CREDENTIALS_MISSING'), true);
  assert.equal(isAwsConfigurationCode('AWS_CREDENTIALS_INVALID'), true);
  assert.equal(isAwsConfigurationCode('NETWORK_ERROR'), false);
  assert.equal(awsErrorTranslationKey('AWS_CREDENTIALS_MISSING'), 'upload.errors.awsCredentialsMissing');
  assert.equal(awsErrorTranslationKey('AWS_CREDENTIALS_INVALID'), 'upload.errors.awsCredentialsInvalid');
  assert.equal(awsErrorTranslationKey('AWS_CONFIGURATION_ERROR'), 'upload.errors.awsConfiguration');
  assert.equal(awsErrorTranslationKey('AWS_ACCESS_DENIED'), 'upload.errors.awsAccessDenied');
});
