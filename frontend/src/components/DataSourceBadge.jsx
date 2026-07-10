import { useLanguage } from "../i18n/LanguageContext.jsx";

const toneClasses = {
  backend: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  loading: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  mock: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
};

export default function DataSourceBadge({ loading = false, source = "mock" }) {
  const { t } = useLanguage();
  const resolvedSource = source === "backend" ? "backend" : "mock";
  const label = loading
    ? t("common.syncing")
    : resolvedSource === "backend"
      ? t("common.liveBackend")
      : t("common.demoData");
  const tone = loading ? toneClasses.loading : toneClasses[resolvedSource];

  return <span className={`rounded-lg px-3 py-2 text-xs font-bold ${tone}`}>{label}</span>;
}
