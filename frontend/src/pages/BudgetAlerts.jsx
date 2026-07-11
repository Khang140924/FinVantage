import { AlertTriangle, BellRing, CalendarClock, CheckCircle2 } from "lucide-react";
import { budgets, subscriptionAnomalies } from "../data/mockData.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { formatCurrency } from "../utils/format.js";

const alertStyles = {
  danger: "border-rose-100 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
  warning: "border-amber-100 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  ok: "border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  pending: "border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
};

const budgetNoteKeys = {
  "Food & Coffee": "budgets.notes.food",
  Shopping: "budgets.notes.shopping",
  Transport: "budgets.notes.transport",
};

const subscriptionIssueKeys = {
  "Canva Pro": "budgets.subscriptionIssues.canva",
  Netflix: "budgets.subscriptionIssues.netflix",
  Spotify: "budgets.subscriptionIssues.spotify",
};

export default function BudgetAlerts() {
  const { t } = useLanguage();

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-lg border border-rose-100 bg-rose-50 p-5 shadow-sm dark:border-rose-900 dark:bg-rose-950/40">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-rose-600 dark:text-rose-300" />
            <div>
              <h2 className="font-bold text-slate-950 dark:text-white">{t("budgets.foodTitle")}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {t("budgets.foodDesc")}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-amber-100 bg-amber-50 p-5 shadow-sm dark:border-amber-900 dark:bg-amber-950/40">
          <div className="flex items-start gap-3">
            <BellRing className="mt-0.5 h-5 w-5 text-amber-600 dark:text-amber-300" />
            <div>
              <h2 className="font-bold text-slate-950 dark:text-white">{t("budgets.shopeeTitle")}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {t("budgets.shopeeDesc")}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-5 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/40">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600 dark:text-emerald-300" />
            <div>
              <h2 className="font-bold text-slate-950 dark:text-white">{t("budgets.transportTitle")}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {t("budgets.transportDesc")}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <article className="app-card p-5">
          <div className="mb-5">
            <h2 className="text-xl font-bold text-slate-950 dark:text-white">{t("budgets.budgetLimits")}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {t("budgets.budgetDesc")}
            </p>
          </div>

          <div className="space-y-4">
            {budgets.map((budget) => {
              const percent = Math.min(Math.round((budget.spent / budget.limit) * 100), 130);
              const barColor =
                budget.spent > budget.limit ? "bg-rose-500" : percent > 85 ? "bg-amber-500" : "bg-emerald-500";
              return (
                <div key={budget.category} className="rounded-lg border border-slate-100 p-4 transition duration-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/70">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-950 dark:text-white">{budget.category}</p>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {budgetNoteKeys[budget.category] ? t(budgetNoteKeys[budget.category]) : budget.note}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${alertStyles[budget.tone]}`}>
                      {percent}%
                    </span>
                  </div>
                  <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${Math.min(percent, 100)}%` }} />
                  </div>
                  <div className="mt-3 flex justify-between text-sm">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{formatCurrency(budget.spent)}</span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {t("budgets.limit", { amount: formatCurrency(budget.limit) })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="app-card p-5">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-xl font-bold text-slate-950 dark:text-white">{t("budgets.subscriptionWatchlist")}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t("budgets.subscriptionDesc")}</p>
            </div>
          </div>

          <div className="space-y-3">
            {subscriptionAnomalies.map((item) => (
              <div key={item.name} className="rounded-lg border border-slate-100 p-4 transition duration-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/70">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-950 dark:text-white">{item.name}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                      {subscriptionIssueKeys[item.name] ? t(subscriptionIssueKeys[item.name]) : item.issue}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${alertStyles[item.severity]}`}>
                    {item.severity.toUpperCase()}
                  </span>
                </div>
                <p className="mt-3 text-lg font-bold text-slate-950 dark:text-white">{formatCurrency(item.amount)}</p>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
