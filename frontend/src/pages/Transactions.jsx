import { Download, Search } from "lucide-react";
import DataSourceBadge from "../components/DataSourceBadge.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { transactions } from "../data/mockData.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { formatCurrency } from "../utils/format.js";

function getMethodLabel(method, t) {
  if (method === "OCR Upload") return t("transactions.methods.ocrUpload");
  if (method === "AI Analysis") return t("transactions.methods.aiAnalysis");
  return method;
}

export default function Transactions({ searchQuery, invoices = [], apiStatus = {} }) {
  const { t } = useLanguage();
  const dataSource = apiStatus.source === "backend" ? "backend" : "mock";
  const sourceTransactions = dataSource === "backend" ? invoices : transactions;
  const query = searchQuery.trim().toLowerCase();
  const filteredTransactions = sourceTransactions.filter((transaction) => {
    if (!query) return true;
    return [transaction.store, transaction.category, transaction.status, transaction.method]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  return (
    <div className="space-y-6">
      <section className="app-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-950 dark:text-white">{t("transactions.title")}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {dataSource === "mock" ? t("transactions.demoDescription") : t("transactions.backendDescription")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DataSourceBadge loading={apiStatus.loading} source={dataSource} />
          <button type="button" className="soft-button">
            <Download className="h-4 w-4" />
            {t("actions.exportCsv")}
          </button>
        </div>
      </section>

      <section className="app-card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="input-shell max-w-md">
            <Search className="h-4 w-4 text-slate-400" />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {query
                ? t("transactions.resultsFor", { count: filteredTransactions.length, query: searchQuery })
                : t("transactions.searchFromTopbar")}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3 font-bold">{t("transactions.table.id")}</th>
                <th className="px-5 py-3 font-bold">{t("transactions.table.store")}</th>
                <th className="px-5 py-3 font-bold">{t("transactions.table.date")}</th>
                <th className="px-5 py-3 font-bold">{t("transactions.table.category")}</th>
                <th className="px-5 py-3 font-bold">{t("transactions.table.method")}</th>
                <th className="px-5 py-3 font-bold">{t("transactions.table.amount")}</th>
                <th className="px-5 py-3 font-bold">{t("transactions.table.status")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.length ? (
                filteredTransactions.map((transaction) => (
                  <tr key={transaction.id} className="table-row">
                    <td className="px-5 py-4 font-mono text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {transaction.id}
                    </td>
                    <td className="px-5 py-4 font-semibold text-slate-900 dark:text-white">{transaction.store}</td>
                    <td className="px-5 py-4 text-slate-500 dark:text-slate-400">{transaction.date}</td>
                    <td className="px-5 py-4">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {transaction.category}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-600 dark:text-slate-300">{getMethodLabel(transaction.method, t)}</td>
                    <td className="px-5 py-4 font-bold text-slate-950 dark:text-white">
                      {formatCurrency(transaction.amount)}
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={transaction.status} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-5 py-8 text-center text-sm font-semibold text-slate-500 dark:text-slate-400" colSpan={7}>
                    {t("transactions.noResults")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
