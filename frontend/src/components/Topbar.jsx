import { Bell, Languages, Moon, Search, Sun } from "lucide-react";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { languageOptions } from "../i18n/translations.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function Topbar({
  pageTitle,
  searchQuery,
  onSearchChange,
  darkMode,
  onToggleTheme,
}) {
  const { language, setLanguage, t } = useLanguage();
  const { user } = useAuth();

  const displayName = user?.name || user?.email || t("topbar.guest");
  const initials = displayName
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-4 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1400px] items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
            FinVantage
          </p>
          <h1 className="truncate text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
            {pageTitle}
          </h1>
        </div>

        <div className="hidden min-w-[280px] max-w-md flex-1 sm:block">
          <label className="input-shell">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
              placeholder={t("topbar.searchPlaceholder")}
            />
          </label>
        </div>

        <div
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          title={t("topbar.languageTitle")}
        >
          <Languages className="ml-1 h-4 w-4 text-slate-400" />
          {languageOptions.map((option) => (
            <button
              key={option.code}
              type="button"
              onClick={() => setLanguage(option.code)}
              className={`rounded-md px-2 py-1 text-xs font-bold transition duration-200 ${
                language === option.code
                  ? "bg-emerald-600 text-white"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              }`}
              aria-pressed={language === option.code}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button type="button" className="icon-button" title={t("topbar.toggleTheme")} onClick={onToggleTheme}>
          {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        <button type="button" className="icon-button relative" title={t("topbar.notifications")}>
          <Bell className="h-5 w-5" />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white dark:ring-slate-900" />
        </button>

        <button
          type="button"
          className="hidden items-center gap-3 rounded-lg border border-slate-200 bg-white py-1.5 pl-1.5 pr-3 text-left shadow-sm transition duration-200 hover:border-emerald-200 hover:bg-emerald-50 active:scale-[0.99] dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-700 dark:hover:bg-emerald-950 sm:flex"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white dark:bg-emerald-600">
            {initials || "U"}
          </span>
          <span>
            <span className="block text-sm font-semibold text-slate-900 dark:text-white">
              {displayName}
            </span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">{t("topbar.premium")}</span>
          </span>
        </button>
      </div>
    </header>
  );
}
