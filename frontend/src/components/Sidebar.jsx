import {
  BarChart3,
  BellRing,
  FileSearch,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  Settings,
  UploadCloud,
  WalletCards,
} from "lucide-react";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const navItems = [
  { id: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { id: "upload", labelKey: "nav.upload", icon: UploadCloud },
  { id: "analysis", labelKey: "nav.analysis", icon: FileSearch },
  { id: "transactions", labelKey: "nav.transactions", icon: ReceiptText },
  { id: "budgets", labelKey: "nav.budgets", icon: BellRing },
  { id: "settings", labelKey: "nav.settings", icon: Settings },
];

function NavButton({ item, isActive, onNavigate }) {
  const Icon = item.icon;
  const { t } = useLanguage();
  const label = t(item.labelKey);

  return (
    <button
      type="button"
      onClick={() => onNavigate(item.id)}
      data-testid={`nav-${item.id}`}
      className={`group flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-semibold transition duration-200 ease-out ${
        isActive
          ? "bg-emerald-50 text-emerald-700 shadow-sm ring-1 ring-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-900"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-white"
      }`}
    >
      <Icon
        className={`h-5 w-5 transition duration-200 ${
          isActive ? "text-emerald-600" : "text-slate-400 group-hover:text-emerald-600"
        }`}
      />
      <span>{label}</span>
    </button>
  );
}

export default function Sidebar({ activePage, onNavigate, monthlyUsage = 0 }) {
  const { t } = useLanguage();
  const { logout } = useAuth();

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-slate-200 bg-white px-5 py-6 dark:border-slate-800 dark:bg-slate-950 lg:flex">
        <button
          type="button"
          onClick={() => onNavigate("dashboard")}
          className="flex items-center gap-3 rounded-lg px-2 py-1 text-left transition duration-200 hover:bg-slate-50 dark:hover:bg-slate-900"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm">
            <WalletCards className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-xl font-bold tracking-tight text-slate-950 dark:text-white">
              FinVantage
            </span>
            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">
              {t("sidebar.tagline")}
            </span>
          </span>
        </button>

        <nav className="mt-8 space-y-2">
          {navItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              isActive={activePage === item.id}
              onNavigate={onNavigate}
            />
          ))}
        </nav>

        <div className="mt-auto">
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/50">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-white text-emerald-700 shadow-sm dark:bg-slate-900 dark:text-emerald-300">
              <BarChart3 className="h-5 w-5" />
            </div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              {t("sidebar.monthlyUsage")}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">
              {t("sidebar.monthlyUsageDescription", { count: monthlyUsage })}
            </p>
          </div>

          <button
            type="button"
            onClick={logout}
            className="mt-5 flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold text-slate-500 transition duration-200 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
          >
            <LogOut className="h-5 w-5" />
            {t("nav.logout")}
          </button>
        </div>
      </aside>

      <nav className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-6 gap-1 border-t border-slate-200 bg-white px-2 py-2 shadow-lg dark:border-slate-800 dark:bg-slate-950 lg:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              title={t(item.labelKey)}
              className={`flex h-12 items-center justify-center rounded-lg transition duration-200 ${
                isActive
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-900"
              }`}
            >
              <Icon className="h-5 w-5" />
            </button>
          );
        })}
      </nav>
    </>
  );
}
