const STEP_PROGRESS = Object.freeze([0, 25, 50, 75]);
const FAILURE_STEP = Object.freeze({ import: 0, upload: 0, ocr: 1, analyze: 2, status: 0 });

export function resolveUploadProgress({ pipelineProgress, isComplete = false, stepIndex = -1 } = {}) {
  if (pipelineProgress !== null && pipelineProgress !== undefined) {
    const numericProgress = Number(pipelineProgress);
    if (Number.isFinite(numericProgress)) return Math.min(Math.max(numericProgress, 0), 100);
  }
  if (isComplete) return 100;
  return STEP_PROGRESS[stepIndex] ?? 0;
}

export const failureStepForStage = (stage) => FAILURE_STEP[stage] ?? 0;

export const isAwsConfigurationCode = (code) => [
  'AWS_CREDENTIALS_MISSING',
  'AWS_CREDENTIALS_INVALID',
  'AWS_CONFIGURATION_ERROR',
  'AWS_ACCESS_DENIED'
].includes(String(code || ''));

export const awsErrorTranslationKey = (code) => ({
  AWS_CREDENTIALS_MISSING: 'upload.errors.awsCredentialsMissing',
  AWS_CREDENTIALS_INVALID: 'upload.errors.awsCredentialsInvalid',
  AWS_CONFIGURATION_ERROR: 'upload.errors.awsConfiguration',
  AWS_ACCESS_DENIED: 'upload.errors.awsAccessDenied'
}[code] || null);

export async function continueAfterSuccessfulUpload({ upload, continuePipeline }) {
  await upload();
  return continuePipeline();
}

export function evaluateTrackedTrigger({ settled, result, error, ready, isRecoverable }) {
  if (!settled) return { shouldReturn: false, error: null };
  if (error && !isRecoverable(error)) return { shouldReturn: false, error };
  if (!error && ready(result)) return { shouldReturn: true, result, error: null };
  return { shouldReturn: false, error: null };
}
