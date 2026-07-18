import {
  AlertCircle,
  Brain,
  CalendarDays,
  ChevronDown,
  FileSearch,
  ListOrdered,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Store,
  Tags,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { getInvoice, updateInvoice } from "../services/api.js";
import { formatCurrency } from "../utils/format.js";
import { normalizeAnalysisPayload } from "../utils/invoiceTransform.js";

function formatTransactionDate(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("vi-VN");
}

export default function AnalysisResult({ invoiceId = null, initialAnalysis = null }) {
  const { t } = useLanguage();
  const [analysisResult, setAnalysisResult] = useState(initialAnalysis);
  const [loading, setLoading] = useState(Boolean(invoiceId));
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editingItemIndex, setEditingItemIndex] = useState(null);
  const [draftItemName, setDraftItemName] = useState("");
  const [savingItem, setSavingItem] = useState(false);
  const [lineItemMessage, setLineItemMessage] = useState("");
  const [lineItemError, setLineItemError] = useState("");
  const [editingStore, setEditingStore] = useState(false);
  const [draftStore, setDraftStore] = useState("");
  const [savingStore, setSavingStore] = useState(false);
  const [storeMessage, setStoreMessage] = useState("");
  const [storeError, setStoreError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!invoiceId) {
      setAnalysisResult(null);
      setLoading(false);
      setError(null);
      return () => { cancelled = true; };
    }

    setAnalysisResult((current) => current?.invoiceId === invoiceId ? current : initialAnalysis);
    setLoading(true);
    setError(null);
    getInvoice(invoiceId)
      .then((data) => {
        if (!cancelled) setAnalysisResult(normalizeAnalysisPayload({ invoice: data.invoice, invoiceId }));
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message || t("analysis.loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [initialAnalysis, invoiceId, reloadKey, t]);

  if (!invoiceId) return <EmptyState title={t("analysis.emptyTitle")} message={t("analysis.missingInvoiceId")} />;

  if (loading && !analysisResult) {
    return (
      <section className="app-card flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        <h2 className="mt-5 text-xl font-bold text-slate-950 dark:text-white">{t("analysis.loading")}</h2>
      </section>
    );
  }

  if (error && !analysisResult) {
    return (
      <section className="app-card flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
        <AlertCircle className="h-10 w-10 text-rose-500" />
        <h2 className="mt-5 text-xl font-bold text-slate-950 dark:text-white">{t("analysis.loadErrorTitle")}</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-rose-600 dark:text-rose-300">{error}</p>
        <button type="button" className="soft-button mt-5" onClick={() => setReloadKey((value) => value + 1)}>
          <RefreshCw className="h-4 w-4" />
          {t("analysis.retry")}
        </button>
      </section>
    );
  }

  if (!analysisResult?.aiResult) return <EmptyState title={t("analysis.emptyTitle")} message={t("analysis.emptyMessage")} />;

  const result = analysisResult.aiResult;
  const lineItems = Array.isArray(result.line_items) ? result.line_items : [];
  const status = analysisResult.transaction?.status || analysisResult.invoice?.status || "ANALYZED";
  const fileKey = analysisResult.invoice?.source_file_key || analysisResult.transaction?.sourceFileKey || analysisResult.upload?.fileKey || "—";
  const cacheKey = analysisResult.upload?.cacheKey || `ocr:${analysisResult.invoiceId}`;
  const technicalAdvice = /\b(?:development|mock|ocr|textract|payload)\b/i.test(result.ai_advice || "");
  const friendlyAdvice = result.ai_advice && !technicalAdvice
    ? result.ai_advice
    : t("analysis.defaultAdvice", {
      amount: formatCurrency(result.total_amount || 0, result.currency),
      category: result.category || t("analysis.notReturned"),
    });
  const databasePayload = {
    id: analysisResult.invoiceId,
    store_name: result.store_name,
    total_amount: result.total_amount,
    currency: result.currency || "VND",
    transaction_date: result.transaction_date,
    category: result.category,
    line_items: lineItems,
    ai_advice: result.ai_advice,
    status,
    source_file_key: fileKey,
  };

  function startEditingItem(item, index) {
    setEditingItemIndex(index);
    setDraftItemName(item.normalized_item_name || item.item || item.raw_item_name || "");
    setLineItemError("");
    setLineItemMessage("");
  }

  async function saveItemName() {
    const normalizedName = draftItemName.normalize("NFC").replace(/\s+/g, " ").trim();
    if (!normalizedName) { setLineItemError(t("analysis.itemNameRequired")); return; }
    setSavingItem(true);
    setLineItemError("");
    setLineItemMessage("");
    try {
      const updatedLineItems = lineItems.map((item, index) => index === editingItemIndex
        ? { ...item, item: normalizedName, normalized_item_name: normalizedName }
        : item);
      const response = await updateInvoice(analysisResult.invoiceId, {
        lineItems: updatedLineItems,
        verifiedLineItemIndexes: [editingItemIndex],
      });
      const normalized = normalizeAnalysisPayload({ invoice: response.invoice, invoiceId: analysisResult.invoiceId });
      setAnalysisResult(normalized);
      setEditingItemIndex(null);
      setDraftItemName("");
      setLineItemMessage(t("analysis.itemNameSaved"));
    } catch (saveError) {
      setLineItemError(saveError.message || t("analysis.itemNameSaveFailed"));
    } finally {
      setSavingItem(false);
    }
  }

  async function saveStoreName(event) {
    event.preventDefault();
    const storeName = draftStore.normalize("NFC").replace(/\s+/g, " ").trim();
    if (!storeName) { setStoreError(t("analysis.storeNameRequired")); return; }
    setSavingStore(true);
    setStoreError("");
    setStoreMessage("");
    try {
      const response = await updateInvoice(analysisResult.invoiceId, { storeName });
      setAnalysisResult(normalizeAnalysisPayload({ invoice: response.invoice, invoiceId: analysisResult.invoiceId }));
      setEditingStore(false);
      setStoreMessage(t("analysis.storeNameSaved"));
    } catch (saveError) {
      setStoreError(saveError.message || t("analysis.storeNameSaveFailed"));
    } finally {
      setSavingStore(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{error}</p>}

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <article className="app-card p-6">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><Store className="h-5 w-5" /></span>
            <div>
              <h2 className="text-xl font-bold text-slate-950 dark:text-white">{t("analysis.invoiceInformation")}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t("analysis.invoiceInformationDesc")}</p>
            </div>
          </div>
          {storeError && <p className="mb-3 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{storeError}</p>}
          {storeMessage && <p className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{storeMessage}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"><Store className="h-4 w-4 text-emerald-600" />{t("analysis.labels.store")}</p>
              {editingStore ? (
                <form className="mt-2 flex flex-col gap-2" onSubmit={saveStoreName}>
                  <input className="form-control" value={draftStore} maxLength={255} onChange={(event) => setDraftStore(event.target.value)} autoFocus />
                  <div className="flex gap-2"><button type="submit" className="primary-button" disabled={savingStore}><Save className="h-4 w-4" />{t("transactions.save")}</button><button type="button" className="soft-button" disabled={savingStore} onClick={() => setEditingStore(false)}><X className="h-4 w-4" />{t("analysis.cancelEdit")}</button></div>
                </form>
              ) : (
                <div className="mt-2 flex items-center justify-between gap-2"><span className="font-bold text-slate-950 dark:text-white">{result.store_name || t("analysis.notReturned")}</span><button type="button" className="icon-button h-8 w-8" title={t("analysis.editStoreName")} aria-label={t("analysis.editStoreName")} onClick={() => { setDraftStore(result.store_name === "Không xác định" ? "" : (result.store_name || "")); setEditingStore(true); setStoreError(""); setStoreMessage(""); }}><Pencil className="h-4 w-4" /></button></div>
              )}
              {result.store_name === "Không xác định" && !editingStore && <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">{t("analysis.vendorWarning")}</p>}
            </div>
            <InfoRow icon={CalendarDays} label={t("analysis.labels.transactionDate")} value={formatTransactionDate(result.transaction_date)} />
            <InfoRow icon={Wallet} label={t("analysis.labels.totalAmount")} value={result.total_amount == null ? t("analysis.notReturned") : formatCurrency(result.total_amount, result.currency)} />
            <InfoRow icon={Tags} label={t("analysis.labels.category")} value={result.category || t("analysis.notReturned")} />
            <div className="rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800 sm:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("analysis.labels.status")}</p>
              <div className="mt-2"><StatusBadge status={status} /></div>
            </div>
          </div>
        </article>

        <article className="app-card p-6">
          <div className="mb-4 flex items-center gap-3">
            <ListOrdered className="h-5 w-5 text-emerald-600" />
            <h2 className="text-xl font-bold text-slate-950 dark:text-white">{t("analysis.lineItems")}</h2>
          </div>
          {lineItems.length ? (
            <div className="space-y-2">
              {lineItemError && <p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{lineItemError}</p>}
              {lineItemMessage && <p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{lineItemMessage}</p>}
              {lineItems.map((item, index) => (
                <div key={`${item.raw_item_name || item.item || "item"}-${index}`} className="rounded-lg bg-slate-50 px-4 py-3 text-sm dark:bg-slate-800">
                  {editingItemIndex === index ? (
                    <form className="flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(event) => { event.preventDefault(); saveItemName(); }}>
                      <input className="form-control flex-1" value={draftItemName} maxLength={255} onChange={(event) => setDraftItemName(event.target.value)} autoFocus />
                      <div className="flex gap-2"><button type="submit" className="primary-button" disabled={savingItem}><Save className="h-4 w-4" />{t("transactions.save")}</button><button type="button" className="soft-button" onClick={() => setEditingItemIndex(null)} disabled={savingItem}><X className="h-4 w-4" />{t("analysis.cancelEdit")}</button></div>
                    </form>
                  ) : (
                    <div className="flex items-center justify-between gap-4">
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
                          {item.normalized_item_name || item.item || item.raw_item_name || t("analysis.notReturned")}
                          {(item.needs_review || item.normalization_changed || (item.confidence != null && Number(item.confidence) < 80)) && !item.user_verified && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t("analysis.needsReview")}</span>}
                        </span>
                        {item.raw_item_name && item.raw_item_name !== (item.normalized_item_name || item.item) && <span className="mt-1 block text-xs text-slate-500">{t("analysis.rawItemName", { name: item.raw_item_name })}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-bold text-slate-950 dark:text-white">{(item.total_price ?? item.price) == null ? t("analysis.notReturned") : formatCurrency(item.total_price ?? item.price, result.currency)}</span>
                        <button type="button" className="icon-button h-8 w-8" title={t("analysis.editItemName")} aria-label={t("analysis.editItemName")} onClick={() => startEditingItem(item, index)}><Pencil className="h-4 w-4" /></button>
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-slate-500 dark:text-slate-400">{t("analysis.noLineItems")}</p>}
        </article>
      </section>

      <article className="rounded-xl border border-emerald-100 bg-emerald-50 p-6 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/40">
        <div className="mb-3 flex items-center gap-3">
          <Brain className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
          <h2 className="text-lg font-bold text-slate-950 dark:text-white">{t("analysis.labels.financialAdvice")}</h2>
        </div>
        <p className="text-sm leading-7 text-slate-700 dark:text-slate-200">{friendlyAdvice}</p>
      </article>

      <details className="group app-card overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-bold text-slate-800 dark:text-slate-100">
          <span className="flex items-center gap-2"><Wrench className="h-4 w-4 text-slate-500" />{t("analysis.technicalDetails")}</span>
          <ChevronDown className="h-5 w-5 text-slate-400 transition group-open:rotate-180" />
        </summary>
        <div className="space-y-5 border-t border-slate-100 p-5 dark:border-slate-800">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <TechnicalRow label="Invoice ID" value={analysisResult.invoiceId} />
            <TechnicalRow label="Pipeline status" value={status} />
            <TechnicalRow label="S3 file key" value={fileKey} />
            <TechnicalRow label="Redis cache key" value={cacheKey} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-bold text-slate-800 dark:text-slate-200">OCR raw text</h3>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-200">{analysisResult.rawText || "—"}</pre>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-bold text-slate-800 dark:text-slate-200">Database payload</h3>
            <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-emerald-200">{JSON.stringify(databasePayload, null, 2)}</pre>
          </div>
        </div>
      </details>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  return <div className="rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"><Icon className="h-4 w-4 text-emerald-600" />{label}</p><p className="mt-2 font-bold text-slate-950 dark:text-white">{value}</p></div>;
}

function TechnicalRow({ label, value }) {
  return <div className="rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 break-all font-mono text-xs text-slate-800 dark:text-slate-200">{value || "—"}</p></div>;
}

function EmptyState({ title, message }) {
  return <section className="app-card flex min-h-[360px] flex-col items-center justify-center p-8 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300"><FileSearch className="h-7 w-7" /></span><h2 className="mt-5 text-xl font-bold text-slate-950 dark:text-white">{title}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">{message}</p></section>;
}
