import { LogOut, Settings, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

export default function UserMenu({ profile, onNavigate }) {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const displayName = profile?.display_name || user?.name || user?.email || t("topbar.guest");
  const email = user?.email || profile?.email || "";
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "U";

  useEffect(() => {
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  function go(section) { setOpen(false); onNavigate("settings", section); }

  return <div className="relative" ref={ref}>
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-1.5 pr-2 text-left shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800">
      {profile?.avatar_read_url ? <img src={profile.avatar_read_url} alt="" className="h-9 w-9 rounded-lg object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white dark:bg-emerald-600">{initials}</span>}
      <span className="hidden max-w-32 sm:block"><span className="block truncate text-sm font-semibold">{displayName}</span><span className="block truncate text-xs text-slate-500">{email}</span></span>
    </button>
    {open && <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-slate-100 px-3 py-3 dark:border-slate-800"><p className="truncate font-bold">{displayName}</p><p className="truncate text-xs text-slate-500">{email}</p></div>
      <MenuItem icon={UserRound} label={t("userMenu.profile")} onClick={() => go("profile")} />
      <MenuItem icon={Settings} label={t("userMenu.settings")} onClick={() => go("preferences")} />
      <MenuItem icon={LogOut} label={t("nav.logout")} danger onClick={logout} />
    </div>}
  </div>;
}

function MenuItem({ icon: Icon, label, onClick, danger = false }) {
  return <button type="button" onClick={onClick} className={`mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 ${danger ? "text-rose-600" : "text-slate-700 dark:text-slate-200"}`}><Icon className="h-4 w-4" />{label}</button>;
}
