import { AlertTriangle, BellRing, CheckCircle2, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import DataSourceBadge from "../components/DataSourceBadge.jsx";
import { deleteBudget, saveBudget } from "../services/api.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { formatCurrency } from "../utils/format.js";

const categories = ["Ăn uống", "Di chuyển", "Mua sắm", "Giải trí", "Hóa đơn", "Sức khỏe", "Giáo dục", "Khác"];
const vnd = (value) => formatCurrency(value, "VND");

export default function BudgetAlerts({ data = { budgets: [], alerts: [] }, apiStatus = {}, onChanged }) {
  const { t } = useLanguage();
  const [category, setCategory] = useState(categories[0]);
  const [amountDigits, setAmountDigits] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const amount = Number(amountDigits || 0);
  const displayAmount = amountDigits ? vnd(amount) : "";
  const existingCategories = useMemo(() => new Set(data.budgets.map((item) => item.category)), [data.budgets]);

  async function submit(event) {
    event.preventDefault(); setError(""); setMessage("");
    if (!categories.includes(category)) return setError(t("budgets.invalidCategory"));
    if (!Number.isSafeInteger(amount) || amount <= 0) return setError(t("budgets.invalidAmount"));
    setBusy(true);
    try {
      const updating = existingCategories.has(category);
      await saveBudget(category, amount);
      setAmountDigits(""); setEditingId(null); setMessage(updating ? t("budgets.updated") : t("budgets.created"));
      await onChanged?.();
    } catch (currentError) { setError(currentError.message); }
    finally { setBusy(false); }
  }

  function edit(budget) {
    setCategory(budget.category); setAmountDigits(String(Math.round(budget.limit ?? budget.amount))); setEditingId(budget.id); setError(""); setMessage("");
  }

  async function remove(id) {
    if (!window.confirm(t("budgets.confirmDelete"))) return;
    setBusy(true); setError(""); setMessage("");
    try { await deleteBudget(id); if (editingId === id) { setEditingId(null); setAmountDigits(""); } await onChanged?.(); }
    catch (currentError) { setError(currentError.message); }
    finally { setBusy(false); }
  }

  return <div className="space-y-6">
    <section className="app-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-bold">{t("budgets.budgetLimits")}</h2><p className="mt-1 text-sm text-slate-500">{t("budgets.monthlyDescription")}</p></div><DataSourceBadge loading={apiStatus.loading} source="backend" /></section>
    {(apiStatus.error || error) && <p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error || apiStatus.error}</p>}
    {message && <p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{message}</p>}

    <section className="grid gap-4 md:grid-cols-3">{data.alerts.length ? data.alerts.map((alert) => {
      const exceeded = alert.severity === "danger"; const Icon = exceeded ? AlertTriangle : BellRing;
      return <article key={`${alert.budgetId}-${alert.severity}`} className={`rounded-lg border p-5 ${exceeded ? "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40" : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"}`}><div className="flex gap-3"><Icon className={`h-5 w-5 ${exceeded ? "text-rose-600" : "text-amber-600"}`} /><div><h3 className="font-bold">{alert.category}</h3><p className="mt-1 text-sm">{t(exceeded ? "budgets.exceededAlert" : "budgets.warningAlert", { percent: alert.percent })}</p></div></div></article>;
    }) : <article className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900 dark:bg-emerald-950/40 md:col-span-3"><div className="flex gap-3"><CheckCircle2 className="h-5 w-5 text-emerald-600" /><p className="font-semibold">{t("budgets.noAlerts")}</p></div></article>}</section>

    <section className="grid gap-6 xl:grid-cols-[1fr_380px]"><article className="app-card p-5"><div className="space-y-4">{data.budgets.length ? data.budgets.map((budget) => {
      const percentage = Number(budget.percentage ?? budget.percent ?? 0); const status = budget.status || (percentage >= 100 ? "exceeded" : percentage >= 80 ? "warning" : "normal");
      const color = status === "exceeded" ? "bg-rose-500" : status === "warning" ? "bg-amber-500" : "bg-emerald-500";
      return <div key={budget.id} className="rounded-lg border border-slate-100 p-4 dark:border-slate-800"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-bold">{budget.category}</p><p className="mt-1 text-sm text-slate-500">{t("budgets.spentOfLimit", { spent: vnd(budget.spent), limit: vnd(budget.limit ?? budget.amount) })}</p></div><div className="flex items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${status === "exceeded" ? "bg-rose-100 text-rose-700" : status === "warning" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{percentage}%</span><button className="soft-button" onClick={() => edit(budget)} disabled={busy} title={t("actions.edit")}><Pencil className="h-4 w-4" /></button><button className="soft-button text-rose-600" onClick={() => remove(budget.id)} disabled={busy} title={t("actions.delete")}><Trash2 className="h-4 w-4" /></button></div></div><div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(percentage, 100)}%` }} /></div><div className="mt-3 flex justify-between text-sm"><span className="text-slate-500">{t("budgets.remaining")}</span><span className={`font-bold ${Number(budget.remaining) < 0 ? "text-rose-600" : "text-slate-900 dark:text-white"}`}>{vnd(budget.remaining)}</span></div></div>;
    }) : <p className="py-8 text-center text-sm text-slate-500">{t("budgets.empty")}</p>}</div></article>

    <form className="app-card h-fit p-5" onSubmit={submit}><h3 className="text-lg font-bold">{editingId ? t("budgets.updateBudget") : t("budgets.setBudget")}</h3><label className="mt-4 block text-sm font-semibold">{t("transactions.fields.category")}<select className="form-control mt-1" value={category} onChange={(event) => { setCategory(event.target.value); setEditingId(data.budgets.find((item) => item.category === event.target.value)?.id || null); }} disabled={busy}>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="mt-4 block text-sm font-semibold">{t("budgets.limitLabel")}<input className="form-control mt-1" inputMode="numeric" placeholder="Ví dụ: 3.000.000 ₫" value={displayAmount} onKeyDown={(event) => { if (event.key === "Backspace" && event.currentTarget.selectionStart === displayAmount.length && event.currentTarget.selectionEnd === displayAmount.length) { event.preventDefault(); setAmountDigits((value) => value.slice(0, -1)); } }} onChange={(event) => setAmountDigits(event.target.value.replace(/\D/g, ""))} required /></label><p className="mt-2 text-xs text-slate-500">{existingCategories.has(category) ? t("budgets.existingHint") : t("budgets.newHint")}</p><button className="primary-button mt-5" disabled={busy || !amountDigits}><Plus className="h-4 w-4" />{editingId || existingCategories.has(category) ? t("budgets.update") : t("budgets.save")}</button></form></section>
  </div>;
}
