import {
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  FileText,
  Plus,
  ReceiptText,
  Wallet,
} from "lucide-react";
import { CategoryDonutChart, ExpenseLineChart } from "../components/Charts.jsx";
import DataSourceBadge from "../components/DataSourceBadge.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { categorySpending, transactions } from "../data/mockData.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { buildCategorySpending } from "../utils/invoiceTransform.js";
import { formatCurrency, formatPercent } from "../utils/format.js";

const toneClasses = {
  emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  rose: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

function getStats(summary, source, t) {
  if (source === "mock") {
    return [
      {
        label: t("dashboard.stats.monthlySpending"),
        value: 9890000,
        change: -6.4,
        detail: t("dashboard.stats.plannedBudget"),
        icon: Wallet,
        tone: "emerald",
        currency: true,
      },
      {
        label: t("dashboard.stats.invoicesAnalyzed"),
        value: "128",
        change: 18.2,
        detail: t("dashboard.stats.thisMonth"),
        icon: FileText,
        tone: "blue",
      },
      {
        label: t("dashboard.stats.pendingOcr"),
        value: "7",
        change: -2.1,
        detail: t("dashboard.stats.waitingInQueue"),
        icon: ReceiptText,
        tone: "amber",
      },
      {
        label: t("dashboard.stats.riskAlerts"),
        value: "3",
        change: 1.2,
        detail: t("dashboard.stats.needReview"),
        icon: CircleDollarSign,
        tone: "rose",
      },
    ];
  }

  const safeSummary = summary || {};

  return [
    {
      label: t("dashboard.stats.totalSpending"),
      value: Number(safeSummary.total_amount || 0),
      change: 0,
      detail: t("dashboard.stats.fromAnalyzedInvoices"),
      icon: Wallet,
      tone: "emerald",
      currency: true,
    },
    {
      label: t("dashboard.stats.invoicesAnalyzed"),
      value: String(safeSummary.total_invoices || 0),
      change: 0,
      detail: t("dashboard.stats.savedInPostgresql"),
      icon: FileText,
      tone: "blue",
    },
    {
      label: t("dashboard.stats.unpaidAmount"),
      value: Number(safeSummary.unpaid_amount || 0),
      change: 0,
      detail: t("dashboard.stats.invoices", { count: safeSummary.unpaid_count || 0 }),
      icon: ReceiptText,
      tone: "amber",
      currency: true,
    },
    {
      label: t("dashboard.stats.paidInvoices"),
      value: String(safeSummary.paid_count || 0),
      change: 0,
      detail: formatCurrency(safeSummary.paid_amount || 0),
      icon: CircleDollarSign,
      tone: "rose",
    },
  ];
}

export default function Dashboard({ onNavigate, invoices = [], summary = null, apiStatus = {} }) {
  const { t } = useLanguage();
  const dataSource = apiStatus.source === "backend" ? "backend" : "mock";
  const liveCategorySpending = buildCategorySpending(summary);
  const categoryData = dataSource === "backend" ? liveCategorySpending : categorySpending;
  const visibleTransactions = dataSource === "backend" ? invoices : transactions;
  const totalCategorySpend = categoryData.reduce((sum, item) => sum + item.value, 0);
  const stats = getStats(summary, dataSource, t);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const isPositive = stat.change >= 0;
          return (
            <article key={stat.label} className="app-card app-card-hover p-5">
              <div className="flex items-start justify-between gap-4">
                <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${toneClasses[stat.tone]}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <span
                  className={`flex items-center gap-1 text-xs font-bold ${
                    isPositive ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {isPositive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                  {formatPercent(stat.change)}
                </span>
              </div>
              <p className="mt-5 text-sm font-medium text-slate-500 dark:text-slate-400">{stat.label}</p>
              <p className="mt-2 text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
                {stat.currency ? formatCurrency(stat.value) : stat.value}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{stat.detail}</p>
            </article>
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <article className="app-card p-5">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-950 dark:text-white">{t("dashboard.dailyExpenseTrend")}</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("dashboard.dailyExpenseTrendDesc")}</p>
            </div>
            <button type="button" className="soft-button">
              {t("dashboard.monthLabel")}
            </button>
          </div>
          <ExpenseLineChart />
        </article>

        <article className="app-card app-card-hover bg-gradient-to-br from-emerald-600 to-sky-600 p-5 text-white">
          <p className="text-sm font-semibold text-emerald-50">{t("dashboard.trackedSpending")}</p>
          <p className="mt-4 text-4xl font-bold tracking-tight">
            {formatCurrency(dataSource === "backend" ? summary?.total_amount ?? 0 : 48250000)}
          </p>
          <p className="mt-2 text-sm text-emerald-50">{t("dashboard.trackedSpendingDesc")}</p>
          <div className="mt-8 grid grid-cols-2 gap-3">
            <button
              type="button"
              className="rounded-lg bg-white px-4 py-3 text-sm font-bold text-slate-900 transition duration-200 hover:bg-emerald-50 active:scale-[0.98]"
              onClick={() => onNavigate("upload")}
            >
              {t("dashboard.addReceipt")}
            </button>
            <button
              type="button"
              className="rounded-lg bg-slate-950/20 px-4 py-3 text-sm font-bold text-white ring-1 ring-white/30 transition duration-200 hover:bg-slate-950/30 active:scale-[0.98]"
              onClick={() => onNavigate("budgets")}
            >
              {t("dashboard.setBudget")}
            </button>
          </div>
          <div className="mt-8 rounded-lg bg-white/10 p-4 ring-1 ring-white/20">
            <p className="text-sm leading-6 text-emerald-50">
              {dataSource === "mock" ? t("dashboard.connectBackend") : t("dashboard.backendMessage")}
            </p>
          </div>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <article className="app-card p-5">
          <div className="mb-4">
            <h2 className="text-lg font-bold text-slate-950 dark:text-white">{t("dashboard.spendingByCategory")}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {t("dashboard.categoryDesc", { amount: formatCurrency(totalCategorySpend) })}
            </p>
          </div>
          <CategoryDonutChart data={categoryData} />
          <div className="grid gap-2 sm:grid-cols-2">
            {categoryData.map((item) => (
              <div key={item.name} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
                <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  {item.name}
                </span>
                <span className="font-semibold text-slate-900 dark:text-white">{formatCurrency(item.value)}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="app-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <div>
              <h2 className="text-lg font-bold text-slate-950 dark:text-white">{t("dashboard.recentTransactions")}</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("dashboard.latestRecords")}</p>
            </div>
            <div className="flex items-center gap-2">
              <DataSourceBadge loading={apiStatus.loading} source={dataSource} />
              <button type="button" className="soft-button" onClick={() => onNavigate("transactions")}>
                {t("actions.viewAll")}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-3 font-bold">{t("dashboard.table.store")}</th>
                  <th className="px-5 py-3 font-bold">{t("dashboard.table.category")}</th>
                  <th className="px-5 py-3 font-bold">{t("dashboard.table.date")}</th>
                  <th className="px-5 py-3 font-bold">{t("dashboard.table.amount")}</th>
                  <th className="px-5 py-3 font-bold">{t("dashboard.table.status")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleTransactions.length ? (
                  visibleTransactions.slice(0, 5).map((transaction) => (
                    <tr key={transaction.id} className="table-row">
                      <td className="px-5 py-4 font-semibold text-slate-900 dark:text-white">{transaction.store}</td>
                      <td className="px-5 py-4 text-slate-600 dark:text-slate-300">{transaction.category}</td>
                      <td className="px-5 py-4 text-slate-500 dark:text-slate-400">{transaction.date}</td>
                      <td className="px-5 py-4 font-bold text-slate-950 dark:text-white">{formatCurrency(transaction.amount)}</td>
                      <td className="px-5 py-4"><StatusBadge status={transaction.status} /></td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-5 py-8 text-center text-sm font-semibold text-slate-500 dark:text-slate-400" colSpan={5}>
                      {t("dashboard.emptyTransactions")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="app-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-950 dark:text-white">{t("dashboard.readyTitle")}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t("dashboard.readyDesc")}
          </p>
        </div>
        <button type="button" className="primary-button" onClick={() => onNavigate("upload")}>
          <Plus className="h-4 w-4" />
          {t("nav.upload")}
        </button>
      </section>
    </div>
  );
}
