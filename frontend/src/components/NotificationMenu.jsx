import { Bell, Check, CheckCheck, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteNotification, getNotifications, markAllNotificationsRead, markNotificationRead } from "../services/api.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { getNotificationTone, notificationToneRank } from "../utils/notificationTone.js";

const notificationTones = {
  danger: { badge: "notification-badge-danger", dot: "notification-dot-danger", item: "notification-item-danger", title: "notification-title-danger" },
  warning: { badge: "notification-badge-warning", dot: "notification-dot-warning", item: "notification-item-warning", title: "notification-title-warning" },
  success: { badge: "notification-badge-success", dot: "notification-dot-success", item: "notification-item-success", title: "notification-title-success" },
};

export default function NotificationMenu({ refreshKey = 0 }) {
  const { t } = useLanguage();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  const loadNotifications = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await getNotifications(50);
      setNotifications(result.notifications || []);
      setUnreadCount(Number(result.unread_count || 0));
    } catch (currentError) { setError(currentError.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadNotifications(); }, [loadNotifications, refreshKey]);
  useEffect(() => { if (open) loadNotifications(); }, [loadNotifications, open, refreshKey]);
  useEffect(() => {
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  async function markRead(item) {
    if (item.is_read) return;
    try {
      await markNotificationRead(item.id);
      setNotifications((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_read: true } : entry));
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch (currentError) { setError(currentError.message); }
  }

  async function markAll() {
    try { await markAllNotificationsRead(); setNotifications((current) => current.map((item) => ({ ...item, is_read: true }))); setUnreadCount(0); }
    catch (currentError) { setError(currentError.message); }
  }

  async function remove(id) {
    try {
      const target = notifications.find((item) => item.id === id);
      await deleteNotification(id);
      setNotifications((current) => current.filter((item) => item.id !== id));
      if (target && !target.is_read) setUnreadCount((count) => Math.max(0, count - 1));
    } catch (currentError) { setError(currentError.message); }
  }

  const visible = showAll ? notifications : notifications.slice(0, 5);
  const unreadTone = useMemo(() => notifications.filter((item) => !item.is_read).reduce((current, item) => {
    const next = getNotificationTone(item);
    return notificationToneRank[next] > notificationToneRank[current] ? next : current;
  }, "success"), [notifications]);

  return <div className="relative" ref={ref}>
    <button type="button" className="icon-button relative" title={t("topbar.notifications")} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <Bell className="h-5 w-5" />
      {unreadCount > 0 && <><span className={`absolute right-1 top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${notificationTones[unreadTone].dot}`} /><span className="sr-only">{t("notifications.unread", { count: unreadCount })}</span></>}
    </button>
    {open && <section className="absolute right-0 top-full z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800"><div><h2 className="font-bold">{t("notifications.title")}</h2><p className="text-xs text-slate-500">{t("notifications.unread", { count: unreadCount })}</p></div><button type="button" className="soft-button px-2 py-1 text-xs" disabled={!unreadCount} onClick={markAll}><CheckCheck className="h-4 w-4" />{t("notifications.markAll")}</button></header>
      {loading ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div> : error ? <div className="p-5 text-center"><p className="text-sm text-rose-600">{error}</p><button className="soft-button mt-3" onClick={loadNotifications}>{t("notifications.retry")}</button></div> : visible.length ? <div className="max-h-[28rem] overflow-y-auto">{visible.map((item) => {
        const tone = getNotificationTone(item);
        const toneClasses = notificationTones[tone];
        return <article key={item.id} className={`notification-item ${toneClasses.item} ${item.is_read ? "notification-item-read" : ""}`}>
          <div className="flex items-start gap-3">
            <span className={`notification-dot mt-1 ${toneClasses.dot}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><span className={`notification-badge ${toneClasses.badge}`}>{t(`notifications.severity.${tone}`)}</span><p className={`font-semibold ${toneClasses.title}`}>{item.title}</p></div>
              <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">{item.message}</p>
              <p className="mt-2 text-xs text-slate-400">{new Date(item.created_at).toLocaleString("vi-VN")}</p>
            </div>
            <div className="flex shrink-0 gap-1">{!item.is_read && <button className="icon-button h-8 w-8" title={t("notifications.markRead")} onClick={() => markRead(item)}><Check className="h-4 w-4" /></button>}<button className="icon-button h-8 w-8 text-rose-600" title={t("actions.delete")} onClick={() => remove(item.id)}><Trash2 className="h-4 w-4" /></button></div>
          </div>
        </article>;
      })}</div> : <div className="p-8 text-center"><Bell className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-500">{t("notifications.empty")}</p></div>}
      {!loading && !error && notifications.length > 5 && <footer className="border-t border-slate-100 p-3 text-center dark:border-slate-800"><button type="button" className="text-sm font-bold text-emerald-700" onClick={() => setShowAll((value) => !value)}>{showAll ? t("notifications.collapse") : t("notifications.viewAll")}</button></footer>}
    </section>}
  </div>;
}
