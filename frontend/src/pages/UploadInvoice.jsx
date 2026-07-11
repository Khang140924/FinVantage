import { AlertCircle, Check, CloudUpload, FileImage, Loader2, UploadCloud, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  ApiError,
  DEFAULT_USER_ID,
  analyzeInvoice,
  importInvoice,
  isApiConfigured,
  runInvoiceOcr,
  uploadInvoiceFile,
} from "../services/api.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

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

function formatFileSize(size) {
  if (!Number.isFinite(size)) return "";
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(fileName = "") {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
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

  if (error?.code === "MISSING_API_BASE_URL") {
    return t("upload.errors.apiBaseMissing");
  }

  if (error?.code === "NETWORK_ERROR") {
    return `${t("upload.errors.network")} ${t("upload.errors.backendUnavailable")}`;
  }

  if (stage === "upload" || error?.code === "S3_NETWORK_ERROR" || error?.code === "S3_UPLOAD_FAILED") {
    return t("upload.errors.s3UploadFailed");
  }

  if (error?.code === "MISSING_UPLOAD_URL" || error?.code === "INVALID_IMPORT_RESPONSE") {
    return t("upload.errors.invalidImportResponse");
  }

  if (stage === "ocr") {
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
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [stepIndex, setStepIndex] = useState(-1);
  const [error, setError] = useState(null);
  const [uploadData, setUploadData] = useState(null);
  const [analysisData, setAnalysisData] = useState(null);

  const steps = useMemo(() => stepKeys.map((key) => t(key)), [t]);
  const isComplete = Boolean(analysisData) && !isAnalyzing;
  const canClear = Boolean(selectedFile || error || uploadData || analysisData || stepIndex >= 0) && !isAnalyzing;

  const progress = useMemo(() => {
    if (isComplete) return 100;
    if (stepIndex < 0) return 0;
    return Math.round(((stepIndex + 1) / steps.length) * 100);
  }, [isComplete, stepIndex, steps.length]);

  function resetFileInput() {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function resetWorkflowState({ keepSelectedFile = false } = {}) {
    if (!keepSelectedFile) {
      setSelectedFile(null);
    }

    setStepIndex(-1);
    setError(null);
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
    setError(null);
    setUploadData(null);
    setAnalysisData(null);
    setIsAnalyzing(true);
    setStepIndex(0);

    try {
      const importedInvoice = await importInvoice(selectedFile);

      if (!importedInvoice?.invoiceId || !importedInvoice?.uploadUrl || !importedInvoice?.fileKey) {
        throw new ApiError("Import response is missing invoiceId, uploadUrl, or fileKey.", {
          code: "INVALID_IMPORT_RESPONSE",
          data: importedInvoice,
        });
      }

      const uploadIdentity = getUploadIdentity(importedInvoice);
      setUploadData(uploadIdentity);

      currentStage = "upload";
      await uploadInvoiceFile(importedInvoice.uploadUrl, selectedFile);
      setStepIndex(1);

      currentStage = "ocr";
      await runInvoiceOcr(uploadIdentity.invoiceId, {
        fileKey: uploadIdentity.fileKey,
        cacheKey: uploadIdentity.cacheKey,
      });
      setStepIndex(2);

      currentStage = "analyze";
      const analyzedInvoice = await analyzeInvoice(uploadIdentity.invoiceId, {
        cacheKey: uploadIdentity.cacheKey,
        userId: DEFAULT_USER_ID,
      });
      const payload = { ...analyzedInvoice, upload: uploadIdentity };

      setStepIndex(3);
      setAnalysisData(payload);
      onAnalysisComplete?.(payload);
    } catch (currentError) {
      setAnalysisData(null);
      setError(getDisplayError(currentError, currentStage, t));
    } finally {
      setIsAnalyzing(false);
    }
  }

  function clearSelection() {
    if (isAnalyzing) return;
    resetWorkflowState();
    resetFileInput();
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

        <label
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`flex min-h-[360px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition duration-300 ${
            isDragging
              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
              : "border-slate-200 bg-slate-50 hover:border-emerald-400 hover:bg-emerald-50/60 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/30"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            accept=".png,.jpg,.jpeg,.heic,.pdf,image/png,image/jpeg,image/heic,application/pdf"
            onChange={(event) => {
              const [file] = event.target.files;
              handleSelectedFile(file);
            }}
          />
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
          {selectedFile && (
            <span className="mt-6 inline-flex max-w-full items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">
              <FileImage className="h-4 w-4 shrink-0 text-emerald-600" />
              <span className="truncate">{selectedFile.name}</span>
              <span className="shrink-0 text-xs text-slate-400">{formatFileSize(selectedFile.size)}</span>
            </span>
          )}
        </label>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 p-3 text-sm font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
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
          {isComplete && (
            <button type="button" className="soft-button" onClick={() => onNavigate("analysis")}>
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
    </div>
  );
}
