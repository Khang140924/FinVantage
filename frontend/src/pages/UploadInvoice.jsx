import { AlertCircle, Check, CloudUpload, FileImage, FileText, Loader2, RefreshCw, UploadCloud, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  analyzeInvoice,
  getInvoiceStatus,
  importInvoice,
  isApiConfigured,
  runInvoiceOcr,
  uploadInvoiceFile,
} from "../services/api.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { createImagePreview, getFileExtension, isPreviewableImage } from "../utils/uploadPreview.js";

const stepKeys = [
  "upload.steps.uploading",
  "upload.steps.ocr",
  "upload.steps.analyzing",
  "upload.steps.saved",
];

const maxFileSize = 10 * 1024 * 1024;
const supportedExtensions = [".png", ".jpg", ".jpeg", ".heic", ".pdf"];
const supportedMimeTypes = new Set([
  "application/pdf",
  "image/heic",
  "image/jpeg",
  "image/jpg",
  "image/png",
]);
const pollIntervalMs = 1500;
const maxPollAttempts = 80;
const terminalFailureStatuses = new Set(["OCR_FAILED", "ANALYSIS_FAILED"]);

function waitForPoll(signal) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, pollIntervalMs);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Polling cancelled", "AbortError"));
    }, { once: true });
  });
}

function isRecoverableRequestError(error) {
  return ["REQUEST_TIMEOUT", "NETWORK_ERROR"].includes(error?.code);
}

function pipelineFailure(statusData) {
  return new ApiError(statusData?.error?.message || "Không thể xử lý hóa đơn.", {
    code: statusData?.error?.code || statusData?.status || "PIPELINE_FAILED",
    data: { ...statusData, code: statusData?.error?.code, message: statusData?.error?.message },
  });
}

function formatFileSize(size) {
  if (!Number.isFinite(size)) return "";
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isSupportedFile(file) {
  return supportedMimeTypes.has(file.type) || supportedExtensions.includes(getFileExtension(file.name));
}

function getBackendMessage(error) {
  return error?.data?.message || error?.data?.error || error?.message || "";
}

function isCachePendingError(error) {
  const message = getBackendMessage(error);
  return error?.status === 404 || /cache|redis|ocr/i.test(message);
}

function getUploadIdentity(data = {}) {
  return {
    invoiceId: data.invoiceId || data.id || null,
    cacheKey: data.cacheKey || null,
    fileKey: data.fileKey || null,
  };
}

function getDisplayError(error, stage, t) {
  const backendMessage = getBackendMessage(error);
  const backendCode = error?.data?.code || error?.code;

  if (error?.code === "MISSING_API_BASE_URL") {
    return t("upload.errors.apiBaseMissing");
  }

  if (error?.code === "NETWORK_ERROR") {
    return `${t("upload.errors.network")} ${t("upload.errors.backendUnavailable")}`;
  }

  if (error?.code === "REQUEST_TIMEOUT" || error?.code === "PIPELINE_POLL_TIMEOUT") {
    return t("upload.errors.pollTimeout");
  }

  if (stage === "upload" || error?.code === "S3_NETWORK_ERROR" || error?.code === "S3_UPLOAD_FAILED") {
    return t("upload.errors.s3UploadFailed");
  }

  if (error?.code === "MISSING_UPLOAD_URL" || error?.code === "INVALID_IMPORT_RESPONSE") {
    return t("upload.errors.invalidImportResponse");
  }

  if (stage === "ocr") {
    if (["OCR_EMPTY_RESULT", "OCR_TOTAL_NOT_FOUND"].includes(backendCode)) {
      return `${backendCode}: ${backendMessage || t("upload.errors.ocrFailed")}`;
    }

    if (/redis/i.test(backendMessage)) {
      return t("upload.errors.redisUnavailable");
    }

    if (/aws|s3|textract|credential|accessdenied|bucket|region|signature/i.test(backendMessage)) {
      return backendMessage
        ? `${t("upload.errors.ocrAwsFailed")} ${backendMessage}`
        : t("upload.errors.ocrAwsFailed");
    }

    return backendMessage
      ? `${t("upload.errors.ocrFailed")} ${backendMessage}`
      : t("upload.errors.ocrFailed");
  }

  if (stage === "analyze") {
    if (isCachePendingError(error)) {
      return backendMessage
        ? `${t("upload.errors.ocrCacheNotReady")} ${backendMessage}`
        : t("upload.errors.ocrCacheNotReady");
    }

    return backendMessage
      ? `${t("upload.errors.analyzeFailed")} ${backendMessage}`
      : t("upload.errors.analyzeFailed");
  }

  if (stage === "import") {
    return backendMessage ? `${t("upload.errors.importFailed")} ${backendMessage}` : t("upload.errors.importFailed");
  }

  return backendMessage || t("upload.errors.network");
}

function sanitizeAnalysisPayload(payload) {
  if (!payload) return null;
  const { upload, uploadUrl, ...safePayload } = payload;
  return safePayload;
}

export default function UploadInvoice({ onNavigate, onAnalysisComplete }) {
  const { t } = useLanguage();
  const inputRef = useRef(null);
  const pollingControllerRef = useRef(null);
  const previewTriggerRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [stepIndex, setStepIndex] = useState(-1);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const [uploadData, setUploadData] = useState(null);
  const [analysisData, setAnalysisData] = useState(null);

  const steps = useMemo(() => stepKeys.map((key) => t(key)), [t]);
  const isComplete = pipelineStatus?.status === "ANALYZED" && Boolean(analysisData) && !isAnalyzing;
  const canClear = Boolean(selectedFile || error || uploadData || analysisData || stepIndex >= 0) && !isAnalyzing;

  const progress = useMemo(() => {
    if (Number.isFinite(Number(pipelineStatus?.progress))) return Number(pipelineStatus.progress);
    if (isComplete) return 100;
    if (stepIndex < 0) return 0;
    return Math.round(((stepIndex + 1) / steps.length) * 100);
  }, [isComplete, pipelineStatus?.progress, stepIndex, steps.length]);

  useEffect(() => () => pollingControllerRef.current?.abort(), []);
  useEffect(() => {
    if (!isPreviewableImage(selectedFile)) {
      setPreviewUrl(null);
      return undefined;
    }

    const preview = createImagePreview(selectedFile);
    setPreviewUrl(preview.url);
    return preview.revoke;
  }, [selectedFile]);

  useEffect(() => {
    if (!isPreviewOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsPreviewOpen(false);
        window.requestAnimationFrame(() => previewTriggerRef.current?.focus());
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPreviewOpen]);

  function applyPipelineStatus(statusData = {}) {
    setPipelineStatus(statusData);
    if (statusData.warning) setWarning(statusData.warning);
    const status = statusData.status;
    const statusProgress = Number(statusData.progress) || 0;
    if (status === "ANALYZED") setStepIndex(3);
    else if (status === "ANALYZING") setStepIndex(2);
    else if (status === "OCR_PROCESSING") setStepIndex(statusProgress >= 50 ? 2 : 1);
    else if (status === "OCR_FAILED") setStepIndex(1);
    else if (status === "ANALYSIS_FAILED") setStepIndex(2);
    else if (status === "UPLOADED") setStepIndex(1);
  }

  async function pollUntil(invoiceId, ready, signal) {
    let lastPollError = null;
    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      await waitForPoll(signal);
      try {
        const statusData = await getInvoiceStatus(invoiceId, { signal });
        lastPollError = null;
        applyPipelineStatus(statusData);
        if (terminalFailureStatuses.has(statusData.status)) throw pipelineFailure(statusData);
        if (ready(statusData)) return statusData;
      } catch (pollError) {
        if (pollError?.name === "AbortError") throw pollError;
        if (terminalFailureStatuses.has(pollError?.data?.status)) throw pollError;
        lastPollError = pollError;
      }
    }
    throw new ApiError(lastPollError?.message || t("upload.errors.pollTimeout"), {
      code: "PIPELINE_POLL_TIMEOUT",
      data: lastPollError?.data,
    });
  }

  async function runTrackedStage(invoiceId, trigger, ready, signal) {
    let triggerSettled = false;
    let triggerResult = null;
    let triggerError = null;
    trigger()
      .then((result) => { triggerSettled = true; triggerResult = result; })
      .catch((currentError) => { triggerSettled = true; triggerError = currentError; });

    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      if (triggerSettled && !triggerError) {
        applyPipelineStatus(triggerResult || {});
        return triggerResult;
      }
      if (triggerSettled && triggerError && !isRecoverableRequestError(triggerError)) throw triggerError;

      await waitForPoll(signal);
      let statusData;
      try {
        statusData = await getInvoiceStatus(invoiceId, { signal });
        applyPipelineStatus(statusData);
      } catch (pollError) {
        if (pollError?.name === "AbortError") throw pollError;
        if (triggerSettled && triggerError && attempt >= 2) throw triggerError;
        continue;
      }

      if (terminalFailureStatuses.has(statusData.status)) throw pipelineFailure(statusData);
      if (ready(statusData)) return statusData;
    }
    throw new ApiError(triggerError?.message || t("upload.errors.pollTimeout"), {
      code: "PIPELINE_POLL_TIMEOUT",
      data: triggerError?.data,
    });
  }

  function resetFileInput() {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function resetWorkflowState({ keepSelectedFile = false } = {}) {
    pollingControllerRef.current?.abort();
    setIsPreviewOpen(false);
    if (!keepSelectedFile) {
      setSelectedFile(null);
    }

    setStepIndex(-1);
    setError(null);
    setWarning(null);
    setPipelineStatus(null);
    setUploadData(null);
    setAnalysisData(null);
  }

  function handleSelectedFile(file) {
    resetWorkflowState({ keepSelectedFile: true });

    if (!file) return;

    if (!isSupportedFile(file)) {
      setSelectedFile(null);
      resetFileInput();
      setError(t("upload.validation.invalidType"));
      return;
    }

    if (file.size > maxFileSize) {
      setSelectedFile(null);
      resetFileInput();
      setError(t("upload.validation.tooLarge"));
      return;
    }

    setSelectedFile(file);
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    const [file] = event.dataTransfer.files;
    handleSelectedFile(file);
  }

  async function handleAnalyze() {
    if (isAnalyzing) return;

    if (!selectedFile) {
      setError(t("upload.validation.selectFileFirst"));
      return;
    }

    if (!isApiConfigured) {
      setError(t("upload.errors.apiBaseMissing"));
      return;
    }

    let currentStage = "import";
    let completedInvoiceId = null;
    const pollingController = new AbortController();
    pollingControllerRef.current?.abort();
    pollingControllerRef.current = pollingController;
    setError(null);
    setWarning(null);
    setPipelineStatus(null);
    setUploadData(null);
    setAnalysisData(null);
    setIsAnalyzing(true);
    setStepIndex(0);

    try {
      const importedInvoice = await importInvoice(selectedFile);

      if (!importedInvoice?.invoiceId || !importedInvoice?.fileKey) {
        throw new ApiError("Import response is missing invoiceId or fileKey.", {
          code: "INVALID_IMPORT_RESPONSE",
          data: importedInvoice,
        });
      }

      const uploadIdentity = getUploadIdentity(importedInvoice);
      setUploadData(uploadIdentity);
      applyPipelineStatus(importedInvoice);

      if (importedInvoice.status === "ANALYZED") {
        const payload = { invoiceId: uploadIdentity.invoiceId, status: "ANALYZED", upload: uploadIdentity, existing: true };
        setAnalysisData(payload);
        completedInvoiceId = uploadIdentity.invoiceId;
      } else {
        let observedStatus = importedInvoice;

        if (importedInvoice.uploadRequired !== false) {
          if (!importedInvoice.uploadUrl) {
            throw new ApiError("Import response is missing uploadUrl.", {
              code: "MISSING_UPLOAD_URL",
              data: importedInvoice,
            });
          }
          currentStage = "upload";
          await uploadInvoiceFile(importedInvoice.uploadUrl, selectedFile);
          observedStatus = { invoiceId: uploadIdentity.invoiceId, status: "UPLOADED", progress: 25 };
          applyPipelineStatus(observedStatus);
        }

        if (importedInvoice.existing && importedInvoice.status === "OCR_PROCESSING") {
          currentStage = "ocr";
          observedStatus = await pollUntil(
            uploadIdentity.invoiceId,
            (statusData) => statusData.status === "ANALYZED"
              || statusData.status === "ANALYZING"
              || (statusData.status === "OCR_PROCESSING" && Number(statusData.progress) >= 50),
            pollingController.signal,
          );
        }

        if (observedStatus.status === "ANALYZING") {
          currentStage = "analyze";
          observedStatus = await pollUntil(
            uploadIdentity.invoiceId,
            (statusData) => statusData.status === "ANALYZED",
            pollingController.signal,
          );
        }

        const ocrReady = observedStatus.status === "ANALYSIS_FAILED"
          || (observedStatus.status === "OCR_PROCESSING" && Number(observedStatus.progress) >= 50);
        if (observedStatus.status !== "ANALYZED" && observedStatus.status !== "ANALYZING" && !ocrReady) {
          currentStage = "ocr";
          observedStatus = await runTrackedStage(
            uploadIdentity.invoiceId,
            () => runInvoiceOcr(uploadIdentity.invoiceId, {
              fileKey: uploadIdentity.fileKey,
              cacheKey: uploadIdentity.cacheKey,
            }),
            (statusData) => statusData.status === "ANALYZED"
              || (statusData.status === "OCR_PROCESSING" && Number(statusData.progress) >= 50),
            pollingController.signal,
          );
        }

        if (observedStatus.status !== "ANALYZED") {
          currentStage = "analyze";
          observedStatus = await runTrackedStage(
            uploadIdentity.invoiceId,
            () => analyzeInvoice(uploadIdentity.invoiceId, { cacheKey: uploadIdentity.cacheKey }),
            (statusData) => statusData.status === "ANALYZED",
            pollingController.signal,
          );
        }

        if (observedStatus?.status !== "ANALYZED") {
          observedStatus = await pollUntil(
            uploadIdentity.invoiceId,
            (statusData) => statusData.status === "ANALYZED",
            pollingController.signal,
          );
        }

        const savedInvoiceId = observedStatus?.invoice?.id || observedStatus?.invoiceId || uploadIdentity.invoiceId;
        if (String(savedInvoiceId) !== String(uploadIdentity.invoiceId)) {
          throw new ApiError("Analysis response contains an unexpected invoiceId.", {
            code: "INVALID_ANALYSIS_RESPONSE",
            data: observedStatus,
          });
        }
        const payload = { ...observedStatus, invoiceId: uploadIdentity.invoiceId, status: "ANALYZED", upload: uploadIdentity };
        applyPipelineStatus({ ...observedStatus, invoiceId: uploadIdentity.invoiceId, status: "ANALYZED", progress: 100 });
        setAnalysisData(payload);
        completedInvoiceId = uploadIdentity.invoiceId;
      }
    } catch (currentError) {
      if (currentError?.name === "AbortError") return;
      setAnalysisData(null);
      setError(getDisplayError(currentError, currentStage, t));
    } finally {
      if (!pollingController.signal.aborted) setIsAnalyzing(false);
    }

    if (completedInvoiceId && !pollingController.signal.aborted) {
      try {
        onAnalysisComplete?.({ invoiceId: completedInvoiceId, status: "ANALYZED" });
      } catch (navigationError) {
        setError(navigationError.message || t("upload.errors.invalidAnalysisResponse"));
      }
    }
  }

  async function checkCurrentStatus() {
    if (!uploadData?.invoiceId || isAnalyzing) return;
    setError(null);
    try {
      const statusData = await getInvoiceStatus(uploadData.invoiceId);
      applyPipelineStatus(statusData);
      if (terminalFailureStatuses.has(statusData.status)) {
        setError(statusData.error?.message || t("upload.errors.pipelineFailed"));
        return;
      }
      if (statusData.status === "ANALYZED") {
        setAnalysisData({ invoiceId: uploadData.invoiceId, status: "ANALYZED", upload: uploadData });
        onAnalysisComplete?.({ invoiceId: uploadData.invoiceId, status: "ANALYZED" });
      } else {
        setWarning(statusData.warning || { message: t("upload.statusStillProcessing") });
      }
    } catch (statusError) {
      setError(getDisplayError(statusError, "status", t));
    }
  }

  function clearSelection() {
    if (isAnalyzing) return;
    resetWorkflowState();
    resetFileInput();
  }

  function closePreview() {
    setIsPreviewOpen(false);
    window.requestAnimationFrame(() => previewTriggerRef.current?.focus());
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <section className="app-card p-6">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-slate-950 dark:text-white">{t("upload.title")}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            {t("upload.subtitle")}
          </p>
          <p className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm font-semibold leading-6 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {t("upload.note")}
          </p>
        </div>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`upload-dropzone ${
            isDragging
              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
              : "border-slate-200 bg-slate-50 hover:border-emerald-400 hover:bg-emerald-50/60 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/30"
          }`}
        >
          <label
            htmlFor="invoice-file-input"
            className={`upload-dropzone-picker ${selectedFile ? "upload-dropzone-picker-selected" : ""}`}
          >
            <input
              ref={inputRef}
              id="invoice-file-input"
              type="file"
              className="sr-only"
              accept=".png,.jpg,.jpeg,.heic,.pdf,image/png,image/jpeg,image/heic,application/pdf"
              onChange={(event) => {
                const [file] = event.target.files;
                handleSelectedFile(file);
              }}
            />
            {selectedFile ? (
              <>
                <span className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                  <CloudUpload className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                  {t("upload.chooseFile")}
                </span>
                <span className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {t("upload.fileHint")}
                </span>
              </>
            ) : (
              <>
                <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-white text-emerald-600 shadow-sm dark:bg-slate-950 dark:text-emerald-300">
                  <CloudUpload className="h-8 w-8" />
                </span>
                <span className="mt-5 text-lg font-bold text-slate-950 dark:text-white">
                  {t("upload.uploadDrop")}
                </span>
                <span className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  {t("upload.fileHint")}
                </span>
                <span className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                  {t("upload.chooseFile")}
                </span>
              </>
            )}
          </label>

          {selectedFile && (
            <div className="upload-file-preview">
              {isPreviewableImage(selectedFile) ? (
                previewUrl && (
                  <button
                    ref={previewTriggerRef}
                    type="button"
                    className="upload-image-preview-trigger"
                    onClick={() => setIsPreviewOpen(true)}
                    aria-label={t("upload.openPreview", { fileName: selectedFile.name })}
                  >
                    <img
                      className="upload-image-preview"
                      src={previewUrl}
                      alt={t("upload.previewAlt", { fileName: selectedFile.name })}
                    />
                    <span className="upload-image-preview-hint">{t("upload.openPreviewHint")}</span>
                  </button>
                )
              ) : (
                <div className="upload-pdf-preview">
                  <FileText className="h-9 w-9" />
                  <span>{t("upload.pdfPreview")}</span>
                </div>
              )}
              <div className="upload-file-details">
                <div className="flex min-w-0 items-center gap-2">
                  {isPreviewableImage(selectedFile)
                    ? <FileImage className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
                    : <FileText className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-300" />}
                  <span className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{selectedFile.name}</span>
                </div>
                <span className="text-xs text-slate-400">{formatFileSize(selectedFile.size)}</span>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 p-3 text-sm font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {warning && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{warning.message || String(warning)}</span>
          </div>
        )}

        {isComplete && (
          <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            {t("upload.success", { invoiceId: uploadData?.invoiceId || t("common.notAvailable") })}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" className="primary-button" onClick={handleAnalyze} disabled={!selectedFile || isAnalyzing}>
            {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {t("actions.uploadAnalyze")}
          </button>
          <button type="button" className="soft-button" onClick={clearSelection} disabled={!canClear}>
            <X className="h-4 w-4" />
            {t("actions.clear")}
          </button>
          {uploadData?.invoiceId && !isAnalyzing && !isComplete && (
            <button type="button" className="soft-button" onClick={checkCurrentStatus}>
              <RefreshCw className="h-4 w-4" />
              {t("upload.checkStatus")}
            </button>
          )}
          {isComplete && (
            <button type="button" className="soft-button" onClick={() => onNavigate("analysis", null, { invoiceId: uploadData?.invoiceId })}>
              {t("actions.viewAiResult")}
            </button>
          )}
        </div>
      </section>

      <aside className="space-y-6">
        <section className="app-card p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-950 dark:text-white">{t("upload.progressTitle")}</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {t("upload.progressCompleted", { progress })}
              </p>
            </div>
            {isAnalyzing && <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />}
          </div>

          <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="mt-6 space-y-4">
            {steps.map((step, index) => {
              const isDone = index < stepIndex || (isComplete && index === stepIndex);
              const isCurrent = index === stepIndex && isAnalyzing;
              return (
                <div key={stepKeys[index]} className="flex items-center gap-3">
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-lg transition duration-300 ${
                      isDone
                        ? "bg-emerald-600 text-white"
                        : isCurrent
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900"
                          : "bg-slate-100 text-slate-400 dark:bg-slate-800"
                    }`}
                  >
                    {isCurrent ? <Loader2 className="h-4 w-4 animate-spin" /> : isDone ? <Check className="h-4 w-4" /> : index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{step}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {isDone ? t("common.completed") : isCurrent ? t("common.processing") : t("common.waiting")}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="app-card app-card-hover p-5">
          <h2 className="text-lg font-bold text-slate-950 dark:text-white">{t("upload.identityTitle")}</h2>
          <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <p className="break-all">invoiceId: {uploadData?.invoiceId || t("common.pending")}</p>
            <p className="break-all">cacheKey: {uploadData?.cacheKey || t("common.pending")}</p>
            <p className="break-all">fileKey: {uploadData?.fileKey || t("common.pending")}</p>
          </div>
        </section>

        {analysisData && (
          <section className="app-card p-5">
            <h2 className="text-lg font-bold text-slate-950 dark:text-white">{t("upload.responseTitle")}</h2>
            <pre className="mt-4 max-h-80 overflow-auto rounded-lg bg-slate-950 p-4 font-mono text-xs leading-6 text-emerald-200">
              {JSON.stringify(sanitizeAnalysisPayload(analysisData), null, 2)}
            </pre>
          </section>
        )}
      </aside>

      {isPreviewOpen && previewUrl && (
        <div className="upload-preview-modal" onClick={closePreview}>
          <div
            className="upload-preview-modal-content"
            role="dialog"
            aria-modal="true"
            aria-label={t("upload.openPreview", { fileName: selectedFile?.name || "" })}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="upload-preview-modal-close"
              onClick={closePreview}
              aria-label={t("upload.closePreview")}
              autoFocus
            >
              <X className="h-5 w-5" />
            </button>
            <img
              className="upload-preview-modal-image"
              src={previewUrl}
              alt={t("upload.previewAlt", { fileName: selectedFile?.name || "" })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
