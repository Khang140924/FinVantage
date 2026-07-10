import { Bell, Database, Moon, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";
import { useLanguage } from "../i18n/LanguageContext.jsx";

export default function Settings({ darkMode, onToggleTheme }) {
  const { t } = useLanguage();
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [budgetGuardrails, setBudgetGuardrails] = useState(true);

  return (
    <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
      <section className="space-y-6">
        <article className="app-card p-6">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-900 text-lg font-bold text-white dark:bg-emerald-600">
              MA
            </span>
            <div>
              <h2 className="text-xl font-bold text-slate-950 dark:text-white">Minh Anh</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t("settings.workspace")}</p>
            </div>
          </div>
          <div className="mt-6 space-y-3">
            <InfoRow label={t("settings.defaultCurrency")} value="VNĐ" />
            <InfoRow label={t("settings.ocrRegion")} value="ap-southeast-1" />
            <InfoRow label={t("settings.monthlyQuota")} value="200" />
          </div>
        </article>

        <article className="app-card p-6">
          <div className="mb-5 flex items-center gap-3">
            <UserRound className="h-5 w-5 text-emerald-600" />
            <h2 className="text-lg font-bold text-slate-950 dark:text-white">{t("settings.profile")}</h2>
          </div>
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("settings.displayName")}</span>
              <input className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition duration-200 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 dark:border-slate-800 dark:bg-slate-900 dark:focus:ring-emerald-950" defaultValue="Minh Anh" />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("settings.email")}</span>
              <input className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition duration-200 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 dark:border-slate-800 dark:bg-slate-900 dark:focus:ring-emerald-950" defaultValue="minhanh@finvantage.local" />
            </label>
          </div>
        </article>
      </section>

      <section className="space-y-6">
        <article className="app-card p-6">
          <div className="mb-5 flex items-center gap-3">
            <Bell className="h-5 w-5 text-emerald-600" />
            <h2 className="text-lg font-bold text-slate-950 dark:text-white">{t("settings.preferences")}</h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            <SettingToggle
              icon={Moon}
              title={t("settings.darkModeTitle")}
              description={t("settings.darkModeDesc")}
              checked={darkMode}
              onChange={onToggleTheme}
            />
            <SettingToggle
              icon={Bell}
              title={t("settings.emailAlertsTitle")}
              description={t("settings.emailAlertsDesc")}
              checked={emailAlerts}
              onChange={() => setEmailAlerts((value) => !value)}
            />
            <SettingToggle
              icon={ShieldCheck}
              title={t("settings.budgetGuardrailsTitle")}
              description={t("settings.budgetGuardrailsDesc")}
              checked={budgetGuardrails}
              onChange={() => setBudgetGuardrails((value) => !value)}
            />
            <SettingToggle
              icon={Database}
              title={t("settings.autoAnalyzeTitle")}
              description={t("settings.autoAnalyzeDesc")}
              checked={autoAnalyze}
              onChange={() => setAutoAnalyze((value) => !value)}
            />
          </div>
        </article>

        <article className="app-card p-6">
          <div className="mb-5 flex items-center gap-3">
            <Database className="h-5 w-5 text-emerald-600" />
            <h2 className="text-lg font-bold text-slate-950 dark:text-white">{t("settings.backendServices")}</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              t("settings.services.s3"),
              t("settings.services.textract"),
              t("settings.services.bedrock"),
              t("settings.services.rds"),
            ].map((service) => (
              <div key={service} className="rounded-lg border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="font-semibold text-slate-950 dark:text-white">{service}</p>
                <p className="mt-1 text-sm text-emerald-600 dark:text-emerald-300">{t("settings.readyForApi")}</p>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3 text-sm dark:bg-slate-800">
      <span className="font-semibold text-slate-500 dark:text-slate-400">{label}</span>
      <span className="font-bold text-slate-950 dark:text-white">{value}</span>
    </div>
  );
}

function SettingToggle({ icon: Icon, title, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <p className="font-semibold text-slate-950 dark:text-white">{title}</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onChange}
        className={`relative h-7 w-12 shrink-0 rounded-full transition duration-200 active:scale-95 ${
          checked ? "bg-emerald-600" : "bg-slate-300 dark:bg-slate-700"
        }`}
        aria-pressed={checked}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition duration-200 ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </button>
    </div>
  );
}
