import { Brain, CheckCircle2, FileSearch, ReceiptText, Store, Tags, Wallet } from "lucide-react";
import DataSourceBadge from "../components/DataSourceBadge.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { formatCurrency } from "../utils/format.js";

export default function AnalysisResult({ latestAnalysis = null }) {
  const { t } = useLanguage();

  if (!latestAnalysis?.aiResult) {
    return (
      <section className="app-card flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
          <FileSearch className="h-7 w-7" />
        </span>
        <h2 className="mt-5 text-xl font-bold text-slate-950 dark:text-white">{t("analysis.emptyTitle")}</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
          {t("analysis.emptyMessage")}
        </p>
      </section>
    );
  }

  const result = latestAnalysis.aiResult;
  const rawText = latestAnalysis.rawText || "";
  const confidence = result.confidence;
  const confidenceValue = confidence == null ? t("common.notAvailable") : `${confidence}%`;
  const amountValue = result.total_amount == null ? t("analysis.notReturned") : formatCurrency(result.total_amount);
  const payload = {
    id: latestAnalysis?.invoiceId,
    store_name: result.store_name,
    total_amount: result.total_amount,
    category: result.category,
    source: latestAnalysis?.source || "backend",
    status: latestAnalysis?.transaction?.status || "ANALYZED",
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_460px]">
      <section className="app-card p-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-950 dark:text-white">{t("analysis.ocrText")}</h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {t("analysis.ocrDesc")}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <DataSourceBadge source={latestAnalysis?.source || "backend"} />
            <span className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              {t("analysis.confidence", { value: confidenceValue })}
            </span>
          </div>
        </div>

        <pre className="min-h-[540px] whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-5 font-mono text-sm leading-7 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          {rawText || t("analysis.ocrUnavailable")}
        </pre>
      </section>

      <section className="space-y-6">
        <article className="app-card p-6">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <ReceiptText className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-xl font-bold text-slate-950 dark:text-white">{t("analysis.aiResult")}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t("analysis.normalizedFields")}</p>
            </div>
          </div>

          <div className="space-y-3">
            <ResultRow icon={Store} label="store_name" value={result.store_name || t("analysis.notReturned")} />
            <ResultRow icon={Wallet} label="total_amount" value={amountValue} />
            <ResultRow icon={Tags} label="category" value={result.category || t("analysis.notReturned")} />
            <ResultRow icon={CheckCircle2} label="confidence" value={confidenceValue} />
          </div>
        </article>

        <article className="rounded-lg border border-emerald-100 bg-emerald-50 p-6 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/40">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-emerald-700 shadow-sm dark:bg-slate-900 dark:text-emerald-300">
              <Brain className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-slate-950 dark:text-white">{t("analysis.aiAdvice")}</h2>
              <p className="text-sm text-emerald-700 dark:text-emerald-300">{t("analysis.budgetRecommendation")}</p>
            </div>
          </div>
          <p className="text-sm leading-7 text-slate-700 dark:text-slate-200">
            {result.ai_advice || t("analysis.noAdvice")}
          </p>
        </article>

        <article className="app-card app-card-hover p-6">
          <h2 className="text-lg font-bold text-slate-950 dark:text-white">{t("analysis.databasePayload")}</h2>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-950 p-4 font-mono text-xs leading-6 text-emerald-200">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </article>
      </section>
    </div>
  );
}

function ResultRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800">
      <span className="flex items-center gap-3 text-sm font-semibold text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4 text-emerald-600" />
        {label}
      </span>
      <span className="text-right text-sm font-bold text-slate-950 dark:text-white">{value}</span>
    </div>
  );
}
