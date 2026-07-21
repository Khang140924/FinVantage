import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  LoaderCircle,
  Pencil,
  PiggyBank,
  Save,
  Target,
  TrendingDown,
  WalletCards,
  X,
} from "lucide-react";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { getSpendingPlan, saveSpendingPlan } from "../services/api.js";
import { formatCurrency } from "../utils/format.js";
import {
  clampProgress,
  getAllocationStatus,
  sanitizeMonthlyIncome,
  spendingPlanToForm,
  validateSpendingPlanForm,
} from "../utils/spendingPlan.js";

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const statusClasses = {
  onTrack: {
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    bar: "bg-emerald-500",
  },
  warning: {
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    bar: "bg-amber-500",
  },
  overspent: {
    badge: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
    bar: "bg-rose-500",
  },
};

const statusLabelKeys = {
  onTrack: "normalStatus",
  warning: "warningStatus",
  overspent: "exceededStatus",
};

function localizeMessages(codes, fallbackMessages, t) {
  if (!Array.isArray(codes) || codes.length === 0) {
    return Array.isArray(fallbackMessages) ? fallbackMessages : [];
  }

  return codes.map((code, index) => {
    const key = `spendingPlan.messages.${code}`;
    const translated = t(key);
    return translated === key ? fallbackMessages?.[index] || code : translated;
  });
}

function getSourceLabel(source, t) {
  const normalized = String(source || "").toLowerCase();
  if (["saved", "latest", "default"].includes(normalized)) return t(`spendingPlan.sources.${normalized}`);
  return "";
}

function StatusPill({ status, usagePercent, t }) {
  const tone = getAllocationStatus(status, usagePercent);
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClasses[tone].badge}`}>
      {t(`spendingPlan.${statusLabelKeys[tone]}`)}
    </span>
  );
}

function ProgressBar({ value, status }) {
  const tone = getAllocationStatus(status, value);
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div
        className={`h-full rounded-full transition-all ${statusClasses[tone].bar}`}
        style={{ width: `${clampProgress(value)}%` }}
      />
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, tone = "emerald" }) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
    violet: "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  };
  return (
    <article className="app-card p-5">
      <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${tones[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-4 text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-950 dark:text-white">{value}</p>
    </article>
  );
}

function AllocationCard({ title, item = {}, type, currency, t }) {
  const isSavings = type === "savings";
  const usage = Number(item.usagePercent || 0);
  const status = getAllocationStatus(item.status, usage);
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-bold text-slate-950 dark:text-white">{title}</p>
          <p className="mt-1 text-sm text-slate-500">{Number(item.percent || 0)}%</p>
        </div>
        {!isSavings && <StatusPill status={status} usagePercent={usage} t={t} />}
      </div>

      {isSavings ? (
        <div className="mt-6 rounded-lg bg-slate-50 p-4 dark:bg-slate-950/60">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("spendingPlan.target")}</p>
          <p className="mt-1 text-lg font-bold text-emerald-700 dark:text-emerald-300">
            {formatCurrency(item.targetAmount, currency)}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-slate-500">{t("spendingPlan.recommendedAmount")}</p>
              <p className="mt-1 font-bold">{formatCurrency(item.recommendedAmount, currency)}</p>
            </div>
            <div>
              <p className="text-slate-500">{t("spendingPlan.actualSpent")}</p>
              <p className="mt-1 font-bold">{formatCurrency(item.actualAmount, currency)}</p>
            </div>
            <div>
              <p className="text-slate-500">{t("spendingPlan.remainingAmount")}</p>
              <p className="mt-1 font-bold">{formatCurrency(item.remainingAmount, currency)}</p>
            </div>
            <div>
              <p className="text-slate-500">{t("spendingPlan.overspentAmount")}</p>
              <p className={`mt-1 font-bold ${Number(item.overspentAmount) > 0 ? "text-rose-600 dark:text-rose-300" : ""}`}>
                {formatCurrency(item.overspentAmount, currency)}
              </p>
            </div>
          </div>
          <div className="mt-5">
            <div className="mb-2 flex justify-between text-xs font-semibold text-slate-500">
              <span>{t("spendingPlan.usage")}</span><span>{usage.toFixed(1)}%</span>
            </div>
            <ProgressBar value={usage} status={status} />
          </div>
        </>
      )}
    </article>
  );
}

function FormField({ id, label, value, onChange, error, suffix, additionalDescribedBy, ...inputProps }) {
  const errorId = error ? `${id}-error` : "";
  const describedBy = [errorId, additionalDescribedBy].filter(Boolean).join(" ") || undefined;
  return (
    <label htmlFor={id} className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
      {label}
      <div className="relative mt-1.5">
        <input
          id={id}
          className={`form-control ${suffix ? "pr-12" : ""} ${error ? "border-rose-400 focus:border-rose-500 focus:ring-rose-200" : ""}`}
          value={value}
          onChange={onChange}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          {...inputProps}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-slate-400">{suffix}</span>}
      </div>
      {error && <span id={errorId} role="alert" className="mt-1.5 block text-xs font-medium text-rose-600 dark:text-rose-300">{error}</span>}
    </label>
  );
}

export default function SpendingPlan() {
  const { t } = useLanguage();
  const [month, setMonth] = useState(getCurrentMonth);
  const [data, setData] = useState(null);
  const [form, setForm] = useState(() => spendingPlanToForm(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [success, setSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const loadId = useRef(0);

  const loadPlan = useCallback(async () => {
    const requestId = ++loadId.current;
    setLoading(true);
    setLoadError(false);
    setSuccess(false);
    setEditing(false);
    try {
      const result = await getSpendingPlan(month);
      if (requestId !== loadId.current) return;
      setData(result || null);
      setForm(spendingPlanToForm(result?.plan));
    } catch {
      if (requestId !== loadId.current) return;
      setData(null);
      setLoadError(true);
    } finally {
      if (requestId === loadId.current) setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  const plan = data?.plan || null;
  const analysis = data?.analysis || null;
  const currency = plan?.currency || "VND";

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setValidationErrors((current) => ({ ...current, [field]: undefined, totalPercent: undefined }));
    setSaveError(false);
    setSuccess(false);
  }

  function startEditing() {
    setForm(spendingPlanToForm(plan));
    setValidationErrors({});
    setSaveError(false);
    setSuccess("");
    setEditing(true);
  }

  function cancelEditing() {
    setForm(spendingPlanToForm(plan));
    setValidationErrors({});
    setSaveError("");
    setEditing(false);
  }

  async function submit(event) {
    event.preventDefault();
    const validation = validateSpendingPlanForm(form);
    setValidationErrors(validation.errors);
    if (!validation.isValid) return;

    setSaving(true);
    setSaveError(false);
    setSuccess(false);
    try {
      const result = await saveSpendingPlan({ month, ...validation.value });
      if (!result?.plan || !result?.analysis) throw new Error(t("spendingPlan.invalidResponse"));
      setData(result);
      setForm(spendingPlanToForm(result.plan));
      setEditing(false);
      setSuccess(true);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  const fieldError = (field) => {
    const code = validationErrors[field];
    if (!code) return "";
    if (code === "positiveInteger") return t("spendingPlan.incomeMustBePositive");
    if (code === "range") return t("spendingPlan.validation.percent");
    return t("spendingPlan.percentageMustEqual100");
  };

  const suggestions = Array.isArray(analysis?.suggestions) ? analysis.suggestions : [];
  const localizedSuggestions = localizeMessages(analysis?.suggestionCodes, suggestions, t);
  const warnings = localizeMessages(analysis?.warningCodes, analysis?.warnings, t);
  const unclassifiedCategories = Array.isArray(analysis?.unclassifiedCategories) ? analysis.unclassifiedCategories : [];
  const totalPercentage = ["needsPercent", "wantsPercent", "savingsPercent"].reduce((total, field) => {
    const value = Number(form[field]);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
  const validTotalPercentage = Math.abs(totalPercentage - 100) <= 0.001;
  const hasIncome = Number(plan?.monthlyIncome ?? analysis?.monthlyIncome ?? 0) > 0;
  const hasTransactions = Number(analysis?.totalSpent ?? 0) > 0;
  const sourceLabel = getSourceLabel(plan?.source, t);

  function changeMonth(event) {
    const nextMonth = event.currentTarget.value;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(nextMonth)) {
      event.currentTarget.value = month;
      return;
    }
    setMonth(nextMonth);
  }

  return (
    <div className="space-y-6">
      <section className="app-card flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><Target className="h-5 w-5" /></span>
            <div>
              <h2 className="text-xl font-bold">{t("spendingPlan.title")}</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("spendingPlan.spendingPlanDescription")}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t("spendingPlan.selectMonth")}
            <input type="month" className="form-control mt-1.5 sm:w-44" value={month} onChange={changeMonth} disabled={editing || saving} />
          </label>
          {!loading && !loadError && !editing && (
            <button type="button" className="primary-button" onClick={startEditing}>
              {plan ? <Pencil className="h-4 w-4" /> : <Target className="h-4 w-4" />}
              {t(plan ? "spendingPlan.edit" : "spendingPlan.create")}
            </button>
          )}
        </div>
      </section>

      {loading && (
        <section role="status" aria-live="polite" className="app-card flex min-h-52 items-center justify-center p-8 text-slate-500">
          <LoaderCircle className="mr-3 h-5 w-5 animate-spin" />{t("spendingPlan.loading")}
        </section>
      )}

      {!loading && loadError && (
        <section role="alert" aria-live="assertive" className="app-card p-8 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-rose-500" />
          <h3 className="mt-3 font-bold">{t("spendingPlan.loadError")}</h3>
          <button type="button" className="soft-button mt-5" onClick={loadPlan}>{t("spendingPlan.retry")}</button>
        </section>
      )}

      {success && <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"><CheckCircle2 className="h-5 w-5" />{t("spendingPlan.saved")}</div>}

      {!loading && !loadError && editing && (
        <form className="app-card p-5 sm:p-6" onSubmit={submit} noValidate aria-busy={saving}>
          <div>
            <h3 className="text-lg font-bold">{t("spendingPlan.formTitle")}</h3>
            <p className="mt-1 text-sm text-slate-500">{t("spendingPlan.formDescription")}</p>
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <FormField id="spending-plan-income" label={t("spendingPlan.monthlyIncome")} type="text" inputMode="numeric" pattern="[0-9]*" value={form.monthlyIncome} onChange={(event) => updateField("monthlyIncome", sanitizeMonthlyIncome(event.target.value))} error={fieldError("monthlyIncome")} />
            <FormField id="spending-plan-needs" label={t("spendingPlan.needsPercent")} type="number" min="0" max="100" step="0.1" suffix="%" value={form.needsPercent} onChange={(event) => updateField("needsPercent", event.target.value)} error={fieldError("needsPercent")} additionalDescribedBy={!validTotalPercentage ? "spending-plan-total-error" : undefined} />
            <FormField id="spending-plan-wants" label={t("spendingPlan.wantsPercent")} type="number" min="0" max="100" step="0.1" suffix="%" value={form.wantsPercent} onChange={(event) => updateField("wantsPercent", event.target.value)} error={fieldError("wantsPercent")} additionalDescribedBy={!validTotalPercentage ? "spending-plan-total-error" : undefined} />
            <FormField id="spending-plan-savings" label={t("spendingPlan.savingsPercent")} type="number" min="0" max="100" step="0.1" suffix="%" value={form.savingsPercent} onChange={(event) => updateField("savingsPercent", event.target.value)} error={fieldError("savingsPercent")} additionalDescribedBy={!validTotalPercentage ? "spending-plan-total-error" : undefined} />
          </div>
          <div className={`mt-5 rounded-lg border px-4 py-3 ${validTotalPercentage ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40" : "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40"}`}>
            <div className="flex items-center justify-between gap-3 text-sm font-bold">
              <span>{t("spendingPlan.totalPercentage")}</span>
              <span className={validTotalPercentage ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}>{totalPercentage.toFixed(1)}% / 100%</span>
            </div>
            {!validTotalPercentage && <p id="spending-plan-total-error" role="alert" className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-300">{t("spendingPlan.percentageMustEqual100")}</p>}
          </div>
          {saveError && <p role="alert" aria-live="assertive" className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">{t("spendingPlan.saveError")}</p>}
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">{t("spendingPlan.noAutoSave")}</p>
            <div className="flex gap-3">
              <button type="button" className="soft-button" disabled={saving} onClick={cancelEditing}><X className="h-4 w-4" />{t("spendingPlan.cancel")}</button>
              <button type="submit" className="primary-button" disabled={saving}><Save className="h-4 w-4" />{t(saving ? "spendingPlan.saving" : "spendingPlan.save")}</button>
            </div>
          </div>
        </form>
      )}

      {!loading && !loadError && !plan && !editing && (
        <section className="app-card p-10 text-center">
          <PiggyBank className="mx-auto h-10 w-10 text-slate-400" />
          <h3 className="mt-4 text-lg font-bold">{t("spendingPlan.emptyTitle")}</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">{t("spendingPlan.emptyDescription")}</p>
        </section>
      )}

      {!loading && !loadError && plan && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded-full px-3 py-1 font-bold ${plan.isSaved ? statusClasses.onTrack.badge : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{t(plan.isSaved ? "spendingPlan.savedPlan" : "spendingPlan.suggestedPlan")}</span>
            {sourceLabel && <span className="text-slate-500">{sourceLabel}</span>}
          </div>

          {!hasIncome ? (
            <section className="app-card border-emerald-200 p-10 text-center dark:border-emerald-900">
              <CircleDollarSign className="mx-auto h-10 w-10 text-emerald-600" />
              <h3 className="mt-4 text-lg font-bold">{t("spendingPlan.enterIncomeToSeeSuggestions")}</h3>
              <button type="button" className="primary-button mt-5" onClick={startEditing}><Pencil className="h-4 w-4" />{t("spendingPlan.edit")}</button>
            </section>
          ) : analysis ? (
            <>
              {!hasTransactions && (
                <section className="app-card border-blue-200 p-8 text-center dark:border-blue-900">
                  <WalletCards className="mx-auto h-9 w-9 text-blue-500" />
                  <h3 className="mt-3 text-lg font-bold">{t("spendingPlan.noTransactionsThisMonth")}</h3>
                </section>
              )}
              <section>
                <h3 className="mb-4 text-lg font-bold">{t("spendingPlan.summaryTitle")}</h3>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryCard icon={WalletCards} label={t("spendingPlan.income")} value={formatCurrency(analysis.monthlyIncome, currency)} />
                  <SummaryCard icon={CircleDollarSign} label={t("spendingPlan.totalSpent")} value={formatCurrency(analysis.totalSpent, currency)} tone="blue" />
                  <SummaryCard icon={Target} label={t("spendingPlan.remainingIncome")} value={formatCurrency(analysis.remainingIncome, currency)} tone="violet" />
                  <SummaryCard icon={PiggyBank} label={t("spendingPlan.targetSavings")} value={formatCurrency(analysis.targetSavings, currency)} tone="amber" />
                </div>
                <article className="app-card mt-4 p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{t("spendingPlan.incomeUsage")}</span>
                    <span className="font-bold">{Number(analysis.usagePercent || 0).toFixed(1)}%</span>
                  </div>
                  <ProgressBar value={analysis.usagePercent} />
                  <div className="mt-3 flex flex-wrap justify-between gap-2 text-sm text-slate-500">
                    <span>{t("spendingPlan.spendableIncome")}: {formatCurrency(analysis.spendableIncome, currency)}</span>
                    <span>{t("spendingPlan.remainingIncome")}: {formatCurrency(analysis.remainingIncome, currency)}</span>
                  </div>
                </article>
                {Number(analysis.spendingReductionNeeded) > 0 && (
                  <article className="mt-4 flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-900 dark:bg-rose-950/40">
                    <TrendingDown className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                    <div><h4 className="font-bold text-rose-700 dark:text-rose-300">{t("spendingPlan.spendingReductionNeeded")}</h4><p className="mt-1 text-lg font-bold">{formatCurrency(analysis.spendingReductionNeeded, currency)}</p></div>
                  </article>
                )}
              </section>

              <section>
                <h3 className="mb-4 text-lg font-bold">{t("spendingPlan.allocationTitle")}</h3>
                <div className="grid gap-4 lg:grid-cols-3">
                  <AllocationCard title={t("spendingPlan.essentialSpending")} type="needs" item={analysis.allocation?.needs} currency={currency} t={t} />
                  <AllocationCard title={t("spendingPlan.personalSpending")} type="wants" item={analysis.allocation?.wants} currency={currency} t={t} />
                  <AllocationCard title={t("spendingPlan.savingsTarget")} type="savings" item={analysis.allocation?.savings} currency={currency} t={t} />
                </div>
              </section>

              {(Number(analysis.unclassifiedAmount) > 0 || unclassifiedCategories.length > 0) && (
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/40">
                  <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /><div><h3 className="font-bold">{t("spendingPlan.unclassifiedTitle")}</h3><p className="mt-1 text-sm">{t("spendingPlan.unclassifiedAmount")}: {formatCurrency(analysis.unclassifiedAmount, currency)}</p>{unclassifiedCategories.length > 0 && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t("spendingPlan.unclassifiedCategories")}: {unclassifiedCategories.join(", ")}</p>}</div></div>
                </section>
              )}

              {(localizedSuggestions.length > 0 || warnings.length > 0) && (
                <section className="grid gap-4 lg:grid-cols-2">
                  {localizedSuggestions.length > 0 && <article className="app-card p-5"><h3 className="font-bold text-emerald-700 dark:text-emerald-300">{t("spendingPlan.suggestionsTitle")}</h3><ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{localizedSuggestions.map((item, index) => <li key={`${index}-${item}`} className="flex gap-2"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-500" /><span>{item}</span></li>)}</ul></article>}
                  {warnings.length > 0 && <article className="app-card p-5"><h3 className="font-bold text-amber-700 dark:text-amber-300">{t("spendingPlan.warningsTitle")}</h3><ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{warnings.map((item, index) => <li key={`${index}-${item}`} className="flex gap-2"><AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-amber-500" /><span>{item}</span></li>)}</ul></article>}
                </section>
              )}
            </>
          ) : <section className="app-card p-8 text-center text-sm text-slate-500">{t("spendingPlan.noAnalysis")}</section>}
        </>
      )}

      <p className="px-2 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">{t("spendingPlan.suggestionDisclaimer")}</p>
    </div>
  );
}
