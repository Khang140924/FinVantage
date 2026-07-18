import { Bell, Camera, Database, Loader2, Moon, Save, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext.jsx";

const initialProfileForm = { displayName: "", phone: "", timezone: "Asia/Bangkok" };

export default function Settings({ profile, preferences, loading, error, section = "profile", onSectionChange, onSaveProfile, onSavePreferences, onUploadAvatar }) {
  const { t } = useLanguage();
  const [form, setForm] = useState(initialProfileForm);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  const [message, setMessage] = useState("");
  const [avatarProgress, setAvatarProgress] = useState(0);

  useEffect(() => setForm({
    displayName: profile?.display_name || "",
    phone: profile?.phone || "",
    timezone: profile?.timezone || "Asia/Bangkok",
  }), [profile]);

  async function run(action, successMessage) {
    setSaving(true);
    setLocalError("");
    setMessage("");
    try {
      const result = await action();
      if (successMessage) setMessage(successMessage);
      return result;
    } catch (currentError) {
      setLocalError(currentError.message || t("settings.saveFailed"));
      throw currentError;
    } finally {
      setSaving(false);
    }
  }

  const tabs = ["profile", "preferences"];
  return (
    <div className="space-y-6">
      <section className="app-card flex flex-wrap gap-2 p-2">
        {tabs.map((tab) => (
          <button key={tab} type="button" onClick={() => onSectionChange(tab)} className={`rounded-lg px-4 py-2 text-sm font-bold ${section === tab ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
            {t(`settings.tabs.${tab}`)}
          </button>
        ))}
      </section>

      {(error || localError) && <p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{localError || error}</p>}
      {message && <p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{message}</p>}

      {loading ? (
        <section className="app-card flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-emerald-600" /></section>
      ) : section === "profile" ? (
        <ProfileTab
          profile={profile}
          form={form}
          setForm={setForm}
          saving={saving}
          avatarProgress={avatarProgress}
          t={t}
          onUpload={(file) => {
            setAvatarProgress(0);
            run(() => onUploadAvatar(file, setAvatarProgress), t("settings.avatarUpdated")).catch(() => {});
          }}
          onSave={(event) => {
            event.preventDefault();
            run(() => onSaveProfile(form), t("settings.saved")).catch(() => {});
          }}
        />
      ) : (
        <PreferencesTab preferences={preferences} saving={saving} t={t} onSave={(patch) => run(() => onSavePreferences(patch), t("settings.saved")).catch(() => {})} />
      )}
    </div>
  );
}

function ProfileTab({ profile, form, setForm, saving, avatarProgress, t, onSave, onUpload }) {
  const initials = (profile?.display_name || profile?.email || "U").split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return (
    <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
      <article className="app-card p-6">
        <div className="flex flex-col items-center text-center">
          {profile?.avatar_read_url ? <img src={profile.avatar_read_url} className="h-24 w-24 rounded-2xl object-cover" alt="" /> : <span className="flex h-24 w-24 items-center justify-center rounded-2xl bg-slate-900 text-2xl font-bold text-white">{initials}</span>}
          <h2 className="mt-4 text-xl font-bold">{profile?.display_name || profile?.email}</h2>
          <p className="text-sm text-slate-500">{profile?.email}</p>
          <label className={`soft-button mt-4 ${saving ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}{t("settings.changeAvatar")}
            <input disabled={saving} type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" className="sr-only" onChange={(event) => event.target.files?.[0] && onUpload(event.target.files[0])} />
          </label>
          {saving && avatarProgress > 0 && <div className="mt-3 w-full"><div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${avatarProgress}%` }} /></div><p className="mt-1 text-xs text-slate-500">{t("settings.uploadProgress", { progress: avatarProgress })}</p></div>}
          <p className="mt-2 text-xs text-slate-500">{t("settings.avatarHint")}</p>
        </div>
        <div className="mt-6 space-y-3"><Info label={t("settings.monthlyUsage")} value={String(profile?.monthly_ocr_usage || 0)} /><Info label={t("settings.email")} value={profile?.email || "—"} /></div>
      </article>

      <form className="app-card p-6" onSubmit={onSave}>
        <div className="mb-5 flex items-center gap-3"><UserRound className="text-emerald-600" /><h2 className="text-lg font-bold">{t("settings.profile")}</h2></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t("settings.displayName")} value={form.displayName} onChange={(value) => setForm({ ...form, displayName: value })} required />
          <Input label={t("settings.phone")} value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
          <Select label={t("settings.timezone")} value={form.timezone} onChange={(value) => setForm({ ...form, timezone: value })} options={["Asia/Bangkok", "Asia/Ho_Chi_Minh", "UTC"]} />
        </div>
        <button className="primary-button mt-6" disabled={saving}><Save className="h-4 w-4" />{saving ? t("settings.saving") : t("settings.saveProfile")}</button>
      </form>
    </div>
  );
}

function PreferencesTab({ preferences, saving, t, onSave }) {
  const values = preferences || {};
  const toggles = [
    ["darkMode", "dark_mode", Moon, "darkModeTitle", "darkModeDesc"],
    ["emailAlerts", "email_alerts", Bell, "emailAlertsTitle", "emailAlertsDesc"],
    ["budgetGuardrails", "budget_guardrails", ShieldCheck, "budgetGuardrailsTitle", "budgetGuardrailsDesc"],
    ["autoAnalyzeInvoices", "auto_analyze_invoices", Database, "autoAnalyzeTitle", "autoAnalyzeDesc"],
  ];
  return <section className="app-card p-6"><h2 className="text-lg font-bold">{t("settings.preferences")}</h2><div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">{toggles.map(([apiKey, dbKey, Icon, title, desc]) => <Toggle key={dbKey} icon={Icon} title={t(`settings.${title}`)} description={t(`settings.${desc}`)} checked={Boolean(values[dbKey])} disabled={saving} onChange={() => onSave({ [apiKey]: !values[dbKey] })} />)}<div className="grid gap-4 py-4 sm:grid-cols-2"><Select label={t("settings.language")} value={values.language || "vi"} onChange={(language) => onSave({ language })} options={["vi", "en"]} /></div></div></section>;
}

function Input({ label, value, onChange, type = "text", ...props }) {
  return <label className="block text-sm font-semibold">{label}<input {...props} type={type} value={value} onChange={(event) => onChange(event.target.value)} className="form-control mt-1" /></label>;
}

function Select({ label, value, onChange, options }) {
  return <label className="block text-sm font-semibold">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="form-control mt-1">{options.map((option) => { const item = typeof option === "string" ? { value: option, label: option } : option; return <option key={item.value} value={item.value} disabled={item.disabled}>{item.label}</option>; })}</select></label>;
}

function Info({ label, value }) { return <div className="flex justify-between rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800"><span className="text-slate-500">{label}</span><b>{value}</b></div>; }
function Toggle({ icon: Icon, title, description, checked, onChange, disabled }) { return <div className="flex items-center justify-between gap-4 py-4"><div className="flex gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800"><Icon className="h-4 w-4" /></span><div><p className="font-semibold">{title}</p><p className="text-sm text-slate-500">{description}</p></div></div><button type="button" disabled={disabled} onClick={onChange} aria-pressed={checked} className={`relative h-7 w-12 rounded-full ${checked ? "bg-emerald-600" : "bg-slate-300 dark:bg-slate-700"}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${checked ? "left-6" : "left-1"}`} /></button></div>; }
