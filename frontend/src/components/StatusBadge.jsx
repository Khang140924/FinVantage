import { useLanguage } from "../i18n/LanguageContext.jsx";

const statusClasses = {
  ANALYZED:
    "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900",
  WARNING:
    "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900",
  PENDING:
    "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
  PAID:
    "bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900",
  FAILED:
    "bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900",
};

export default function StatusBadge({ status }) {
  const { t } = useLanguage();
  const statusKey = status || "PENDING";
  const translatedStatus = t(`status.${statusKey}`);
  const label = translatedStatus === `status.${statusKey}` ? statusKey : translatedStatus;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${
        statusClasses[statusKey] ?? statusClasses.PENDING
      }`}
    >
      {label}
    </span>
  );
}
