import { Languages, Moon, Sun } from "lucide-react";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { languageOptions } from "../i18n/translations.js";
import UserMenu from "./UserMenu.jsx";
import NotificationMenu from "./NotificationMenu.jsx";
import GlobalSearch from "./GlobalSearch.jsx";

export default function Topbar({
  pageTitle,
  searchQuery,
  onSearchChange,
  darkMode,
  onToggleTheme,
  profile,
  onNavigate,
  onLanguageChange,
  notificationRefreshKey,
}) {
  const { language, setLanguage, t } = useLanguage();

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-4 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
            FinVantage
          </p>
          <h1 className="truncate text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
            {pageTitle}
          </h1>
        </div>

        <div className="order-last w-full sm:order-none sm:min-w-[280px] sm:max-w-md sm:flex-1">
          <GlobalSearch value={searchQuery} onChange={onSearchChange} onNavigate={onNavigate} />
        </div>

        <div
          className="hidden items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:inline-flex"
          title={t("topbar.languageTitle")}
        >
          <Languages className="ml-1 h-4 w-4 text-slate-400" />
          {languageOptions.map((option) => (
            <button
              key={option.code}
              type="button"
              onClick={() => {
                if (onLanguageChange) onLanguageChange(option.code);
                else setLanguage(option.code);
              }}
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

        <button type="button" className="icon-button hidden sm:flex" title={t("topbar.toggleTheme")} onClick={onToggleTheme}>
          {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        <NotificationMenu refreshKey={notificationRefreshKey} />

        <UserMenu profile={profile} onNavigate={onNavigate} />
      </div>
    </header>
  );
}
