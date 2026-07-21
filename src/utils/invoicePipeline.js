export const PIPELINE_PROGRESS = Object.freeze({
  UPLOAD_PENDING: 0,
  UPLOADED: 25,
  OCR_PROCESSING: 35,
  OCR_FAILED: 25,
  ANALYZING: 75,
  ANALYZED: 100,
  ANALYSIS_FAILED: 75
});

export const resolvePipelineProgress = (cachedInvoice = {}, { ocrReady = false } = {}) => {
  const cachedProgress = Number(cachedInvoice.progress);
  if (cachedInvoice.progress !== null && cachedInvoice.progress !== undefined && Number.isFinite(cachedProgress)) {
    return Math.min(Math.max(cachedProgress, 0), 100);
  }
  if (ocrReady) return 50;
  return PIPELINE_PROGRESS[cachedInvoice.status] ?? 0;
};
