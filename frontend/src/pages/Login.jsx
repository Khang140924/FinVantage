import { ArrowLeft, Loader2, LockKeyhole, Mail, ShieldCheck, UserRound, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

const initialForm = { email: "", password: "", confirmPassword: "", displayName: "", code: "", newPassword: "" };

export default function Login() {
  const auth = useAuth();
  const { t } = useLanguage();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (auth.authMode !== "cognito" || auth.status !== "unauthenticated") return undefined;
    const redirectTimer = window.setTimeout(() => auth.hostedLogin({ automatic: true }), 150);
    return () => window.clearTimeout(redirectTimer);
  }, [auth.authMode, auth.hostedLogin, auth.status]);

  const title = useMemo(() => ({
    login: t("auth.loginTitle"), register: t("auth.registerTitle"), verify: t("auth.verifyTitle"),
    forgot: t("auth.forgotTitle"), reset: t("auth.resetTitle"),
  })[mode], [mode, t]);

  function update(name, value) { setForm((current) => ({ ...current, [name]: value })); }
  function switchMode(next) { setMode(next); setError(""); setMessage(""); }

  function validateEmail() {
    if (!/^\S+@\S+\.\S+$/.test(form.email)) throw new Error(t("auth.errors.invalidEmail"));
  }

  function validatePassword(value = form.password) {
    if (value.length < 8) throw new Error(t("auth.errors.passwordLength"));
  }

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      validateEmail();
      if (mode === "login") { validatePassword(); await auth.login(form.email, form.password); }
      if (mode === "register") {
        validatePassword();
        if (!form.displayName.trim()) throw new Error(t("auth.errors.nameRequired"));
        if (form.password !== form.confirmPassword) throw new Error(t("auth.errors.passwordMismatch"));
        const result = await auth.signup({ email: form.email, password: form.password, displayName: form.displayName });
        setMessage(result.developmentCode ? t("auth.mockCode", { code: result.developmentCode }) : t("auth.codeSent"));
        setMode("verify");
      }
      if (mode === "verify") {
        if (!form.code.trim()) throw new Error(t("auth.errors.codeRequired"));
        await auth.confirmSignup(form.email, form.code); setMessage(t("auth.verified")); setMode("login");
      }
      if (mode === "forgot") {
        const result = await auth.forgotPassword(form.email);
        setMessage(result.developmentCode ? t("auth.mockCode", { code: result.developmentCode }) : t("auth.codeSent"));
        setMode("reset");
      }
      if (mode === "reset") {
        validatePassword(form.newPassword);
        if (!form.code.trim()) throw new Error(t("auth.errors.codeRequired"));
        await auth.resetPassword(form.email, form.code, form.newPassword); setMessage(t("auth.passwordReset")); setMode("login");
      }
    } catch (currentError) { setError(currentError.message); }
    finally { setBusy(false); }
  }

  async function resend() {
    setBusy(true); setError("");
    try {
      validateEmail(); const result = await auth.resendConfirmation(form.email);
      setMessage(result.developmentCode ? t("auth.mockCode", { code: result.developmentCode }) : t("auth.codeSent"));
    } catch (currentError) { setError(currentError.message); }
    finally { setBusy(false); }
  }

  if (auth.authMode === "cognito") {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-emerald-600 text-white"><ShieldCheck /></span>
        <h1 className="mt-5 text-2xl font-bold">{t("auth.managedLoginTitle")}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{t("auth.managedLoginMessage")}</p>
        <Loader2 className="mx-auto mt-6 h-6 w-6 animate-spin text-emerald-600" />
        <button type="button" className="soft-button mt-6 w-full justify-center" onClick={auth.hostedLogin}>{t("auth.hostedFallback")}</button>
      </div>
    </div>;
  }

  return <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 dark:bg-slate-950">
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white"><WalletCards /></span><div><h1 className="text-2xl font-bold">FinVantage</h1><p className="text-sm text-slate-500">{t("sidebar.tagline")}</p></div></div>
      <div className="mt-7 flex items-center gap-2">{mode !== "login" && <button type="button" className="icon-button" onClick={() => switchMode("login")}><ArrowLeft className="h-4 w-4" /></button>}<div><h2 className="text-xl font-bold">{title}</h2><p className="text-sm text-slate-500">{auth.authMode === "mock" ? t("auth.mockMode") : t("auth.cognitoMode")}</p></div></div>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        {mode === "register" && <Field icon={UserRound} label={t("settings.displayName")} value={form.displayName} onChange={(v) => update("displayName", v)} autoComplete="name" />}
        <Field icon={Mail} label={t("settings.email")} type="email" value={form.email} onChange={(v) => update("email", v)} autoComplete="email" disabled={mode === "verify" || mode === "reset"} />
        {(mode === "login" || mode === "register") && <Field icon={LockKeyhole} label={t("auth.password")} type="password" value={form.password} onChange={(v) => update("password", v)} autoComplete={mode === "login" ? "current-password" : "new-password"} />}
        {mode === "register" && <Field icon={LockKeyhole} label={t("auth.confirmPassword")} type="password" value={form.confirmPassword} onChange={(v) => update("confirmPassword", v)} autoComplete="new-password" />}
        {(mode === "verify" || mode === "reset") && <Field icon={ShieldCheck} label={t("auth.confirmationCode")} value={form.code} onChange={(v) => update("code", v)} inputMode="numeric" />}
        {mode === "reset" && <Field icon={LockKeyhole} label={t("auth.newPassword")} type="password" value={form.newPassword} onChange={(v) => update("newPassword", v)} autoComplete="new-password" />}
        {error && <p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>}
        {message && <p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</p>}
        <button className="primary-button w-full justify-center py-3" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{t(`auth.actions.${mode}`)}</button>
      </form>
      <div className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm font-semibold text-emerald-700">
        {mode === "login" && <><button onClick={() => switchMode("register")}>{t("auth.createAccount")}</button><button onClick={() => switchMode("forgot")}>{t("auth.forgotPassword")}</button></>}
        {mode === "verify" && <button onClick={resend} disabled={busy}>{t("auth.resendCode")}</button>}
      </div>
      {mode === "login" && auth.authMode === "cognito" && <button type="button" className="soft-button mt-5 w-full justify-center" onClick={auth.hostedLogin}>{t("auth.hostedFallback")}</button>}
      <p className="mt-6 text-center text-xs text-slate-400">{t("auth.protectedNote")}</p>
    </div>
  </div>;
}

function Field({ icon: Icon, label, type = "text", value, onChange, ...props }) {
  return <label className="block"><span className="text-sm font-semibold">{label}</span><span className="mt-1 flex items-center gap-2 rounded-lg border border-slate-200 px-3 dark:border-slate-700"><Icon className="h-4 w-4 text-slate-400" /><input {...props} required type={type} value={value} onChange={(event) => onChange(event.target.value)} className="w-full bg-transparent py-2.5 text-sm outline-none" /></span></label>;
}
