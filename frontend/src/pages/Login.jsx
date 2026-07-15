import { LogIn, WalletCards } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

export default function Login() {
  const { login } = useAuth();
  const { t } = useLanguage();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
            <WalletCards className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
              FinVantage
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t("sidebar.tagline")}</p>
          </div>
        </div>

        <h2 className="mt-8 text-xl font-bold text-slate-950 dark:text-white">{t("auth.title")}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
          {t("auth.subtitle")}
        </p>

        <button
          type="button"
          onClick={login}
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-emerald-700 active:scale-[0.99]"
        >
          <LogIn className="h-5 w-5" />
          {t("auth.signInWithCognito")}
        </button>

        <p className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
          {t("auth.protectedNote")}
        </p>
      </div>
    </div>
  );
}
