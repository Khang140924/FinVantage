import { useCallback, useEffect, useMemo, useState } from "react";
import Layout from "./components/Layout.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import UploadInvoice from "./pages/UploadInvoice.jsx";
import AnalysisResult from "./pages/AnalysisResult.jsx";
import Transactions from "./pages/Transactions.jsx";
import BudgetAlerts from "./pages/BudgetAlerts.jsx";
import Settings from "./pages/Settings.jsx";
import Login from "./pages/Login.jsx";
import { useLanguage } from "./i18n/LanguageContext.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import {
  createAvatarUpload,
  createInvoice,
  getBudgets,
  getDashboardSummary,
  getInvoices,
  getMe,
  getPreferences,
  isApiConfigured,
  updateMe,
  updatePreferences,
  uploadAvatarFile,
} from "./services/api.js";
import { normalizeAnalysisPayload, normalizeInvoices } from "./utils/invoiceTransform.js";

const pageIds = new Set(["dashboard", "upload", "analysis", "transactions", "budgets", "settings"]);

function readRoute(pathname = window.location.pathname) {
  const [page = "dashboard", encodedInvoiceId] = pathname.split("/").filter(Boolean);
  if (!pageIds.has(page)) return { page: "dashboard", invoiceId: null };
  return {
    page,
    invoiceId: page === "analysis" && encodedInvoiceId ? decodeURIComponent(encodedInvoiceId) : null,
  };
}

function routePath(page, invoiceId) {
  if (page === "dashboard") return "/";
  if (page === "analysis" && invoiceId) return `/analysis/${encodeURIComponent(invoiceId)}`;
  return `/${page}`;
}

export default function App() {
  const { t, setLanguage } = useLanguage();
  const { isAuthenticated, status: authStatus, error: authError, refresh: refreshAuth } = useAuth();
  const initialRoute = useMemo(() => readRoute(), []);
  const [activePage, setActivePage] = useState(initialRoute.page);
  const [activeInvoiceId, setActiveInvoiceId] = useState(initialRoute.invoiceId);
  const [searchQuery, setSearchQuery] = useState("");
  const [invoices, setInvoices] = useState([]);
  const [dashboardSummary, setDashboardSummary] = useState(null);
  const [latestAnalysis, setLatestAnalysis] = useState(null);
  const [budgetData, setBudgetData] = useState({ budgets: [], alerts: [] });
  const [account, setAccount] = useState({ profile: null, preferences: null, loading: false, error: null });
  const [settingsSection, setSettingsSection] = useState("profile");
  const [notificationRefreshKey, setNotificationRefreshKey] = useState(0);
  const [apiStatus, setApiStatus] = useState({
    loading: false,
    error: isApiConfigured ? null : "Set VITE_API_BASE_URL to read live backend data.",
    lastUpdated: null,
    source: "backend",
  });
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem("finvantage-theme") === "dark";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("finvantage-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    const handlePopState = () => {
      const route = readRoute();
      setActivePage(route.page);
      setActiveInvoiceId(route.invoiceId);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const refreshAccount = useCallback(async () => {
    if (!isAuthenticated || !isApiConfigured) return;
    setAccount((current) => ({ ...current, loading: true, error: null }));
    const [profileResult, preferencesResult] = await Promise.allSettled([getMe(), getPreferences()]);
    const profile = profileResult.status === "fulfilled" ? profileResult.value.profile : null;
    const preferences = preferencesResult.status === "fulfilled" ? preferencesResult.value.preferences : null;
    const errors = [profileResult, preferencesResult].filter((result) => result.status === "rejected").map((result) => result.reason?.message).filter(Boolean);
    setAccount((current) => ({
      profile: profile || current.profile,
      preferences: preferences || current.preferences,
      loading: false,
      error: errors.join(" ") || null,
    }));
    if (preferences) {
      setDarkMode(Boolean(preferences.dark_mode));
      setLanguage(preferences.language || "vi");
    }
  }, [isAuthenticated, setLanguage]);

  const refreshFinanceData = useCallback(async () => {
    if (!isAuthenticated) return;
    if (!isApiConfigured) {
      setApiStatus({
        loading: false,
        error: "Set VITE_API_BASE_URL to read live backend data.",
        lastUpdated: null,
        source: "backend",
      });
      return;
    }

    setApiStatus((current) => ({ ...current, loading: true, error: null }));

    try {
      const [invoiceData, summaryData, budgetsData] = await Promise.all([
        getInvoices(),
        getDashboardSummary(),
        getBudgets(),
      ]);

      setInvoices(normalizeInvoices(invoiceData.invoices));
      setDashboardSummary(summaryData.summary || null);
      setBudgetData({ budgets: budgetsData.budgets || [], alerts: budgetsData.alerts || [] });
      setApiStatus({
        loading: false,
        error: null,
        lastUpdated: new Date().toISOString(),
        source: "backend",
      });
    } catch (error) {
      setApiStatus((current) => ({
        ...current,
        loading: false,
        error: error.message || "Backend request failed.",
        source: "backend",
      }));
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) { refreshFinanceData(); refreshAccount(); }
  }, [isAuthenticated, refreshAccount, refreshFinanceData]);

  const saveProfile = useCallback(async (changes) => {
    const result = await updateMe(changes);
    if (!result?.profile) throw new Error(t("settings.invalidProfileResponse"));
    setAccount((current) => ({
      ...current,
      error: null,
      profile: { ...(current.profile || {}), ...result.profile },
    }));
    return result.profile;
  }, [t]);

  const savePreferences = useCallback(async (changes) => {
    const result = await updatePreferences(changes);
    const preferences = result.preferences;
    setAccount((current) => ({ ...current, preferences }));
    setDarkMode(Boolean(preferences.dark_mode));
    setLanguage(preferences.language || "vi");
  }, [setLanguage]);

  const saveChromePreference = useCallback((changes) => {
    savePreferences(changes).catch((error) => {
      setAccount((current) => ({ ...current, error: error.message }));
    });
  }, [savePreferences]);

  const uploadAvatar = useCallback(async (file, onProgress) => {
    if (!file.type.match(/^image\/(jpeg|png)$/) || file.size <= 0 || file.size > 2 * 1024 * 1024) throw new Error(t("settings.avatarValidation"));
    const upload = await createAvatarUpload(file);
    await uploadAvatarFile(upload.uploadUrl, file, onProgress);
    await saveProfile({ avatarKey: upload.avatarKey });
  }, [saveProfile, t]);

  const navigate = useCallback((pageId, section, options = {}) => {
    if (section) setSettingsSection(section);
    const invoiceId = pageId === "analysis" ? (options.invoiceId || null) : null;
    setActiveInvoiceId(invoiceId);
    setActivePage(pageId);
    window.history.pushState({}, "", routePath(pageId, invoiceId));
  }, []);

  const handleCreateInvoice = useCallback(async (invoiceData) => {
  try {
    const invoice = await createInvoice(invoiceData);

    if (invoice) {
      setInvoices((current) => [
        invoice,
        ...current,
      ]);
    }

    await refreshFinanceData();

    return invoice;

  } catch (error) {
    setApiStatus((current) => ({
      ...current,
      error: error.message || "Failed to create invoice.",
    }));

    throw error;
  }
}, [refreshFinanceData]);

const handleCreateInvoice = useCallback(async (invoiceData) => {
  try {
    const result = await createInvoice(invoiceData);

    if (result.invoice) {
      setInvoices((current) => [
        result.invoice,
        ...current
      ]);
    }

    await refreshFinanceData();

    return result.invoice;
  } catch(error) {
    setApiStatus((current)=>({
      ...current,
      error:error.message
    }));

    throw error;
  }
}, [refreshFinanceData]);

  const handleAnalysisComplete = useCallback(
    (payload) => {
      const invoiceId = String(payload?.invoice?.id || payload?.invoiceId || payload?.upload?.invoiceId || "");
      if (!invoiceId || payload?.status !== "ANALYZED") {
        setApiStatus((current) => ({ ...current, error: t("upload.errors.invalidAnalysisResponse") }));
        return false;
      }
      if (payload?.invoice) {
        const normalized = normalizeAnalysisPayload(payload);
        setLatestAnalysis(normalized);
        setInvoices((current) => [
          normalized.transaction,
          ...current.filter((invoice) => invoice.id !== normalized.transaction.id),
        ]);
      } else {
        setLatestAnalysis(null);
      }
      refreshFinanceData();
      setNotificationRefreshKey((value) => value + 1);
      setActiveInvoiceId(invoiceId);
      setActivePage("analysis");
      window.history.pushState({}, "", routePath("analysis", invoiceId));
      return true;
    },
    [refreshFinanceData, t]
  );

  const refreshFinanceAndNotifications = useCallback(async () => {
    await refreshFinanceData();
    setNotificationRefreshKey((value) => value + 1);
  }, [refreshFinanceData]);

  const changeDashboardMonth = useCallback(async (month) => {
    setApiStatus((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await getDashboardSummary(month);
      setDashboardSummary(result.summary || null);
      setApiStatus((current) => ({ ...current, loading: false, error: null, lastUpdated: new Date().toISOString() }));
    } catch (error) {
      setApiStatus((current) => ({ ...current, loading: false, error: error.message || "Backend request failed." }));
    }
  }, []);

  const page = useMemo(() => {
    switch (activePage) {
      case "upload":
  return (
    <UploadInvoice
      onNavigate={navigate}
      onAnalysisComplete={handleAnalysisComplete}
      onCreateInvoice={handleCreateInvoice}
    />
  );
      case "analysis":
        return <AnalysisResult invoiceId={activeInvoiceId} initialAnalysis={latestAnalysis?.invoiceId === activeInvoiceId ? latestAnalysis : null} />;
      case "transactions":
        return <Transactions searchQuery={searchQuery} invoices={invoices} apiStatus={apiStatus} onChanged={refreshFinanceData} onNavigate={navigate} />;
      case "budgets":
        return <BudgetAlerts data={budgetData} apiStatus={apiStatus} onChanged={refreshFinanceAndNotifications} />;
      case "settings":
        return <Settings profile={account.profile} preferences={account.preferences} loading={account.loading} error={account.error} section={settingsSection} onSectionChange={setSettingsSection} onSaveProfile={saveProfile} onSavePreferences={savePreferences} onUploadAvatar={uploadAvatar} />;
      case "dashboard":
      default:
        return (
          <Dashboard
            onNavigate={navigate}
            invoices={invoices}
            summary={dashboardSummary}
            apiStatus={apiStatus}
            alerts={budgetData.alerts}
            onMonthChange={changeDashboardMonth}
          />
        );
    }
    }, [
    account,
    activeInvoiceId,
    activePage,
    apiStatus,
    budgetData,
    changeDashboardMonth,
    dashboardSummary,
    handleAnalysisComplete,
    handleCreateInvoice,
    invoices,
    latestAnalysis,
    navigate,
    refreshFinanceAndNotifications,
    refreshFinanceData,
    savePreferences,
    saveProfile,
    searchQuery,
    settingsSection,
    uploadAvatar
  ]);
  const pageTitles = useMemo(
    () => ({
      dashboard: t("nav.dashboard"),
      upload: t("nav.upload"),
      analysis: t("nav.analysis"),
      transactions: t("nav.transactions"),
      budgets: t("nav.budgets"),
      settings: t("nav.settings"),
    }),
    [t]
  );

  if (authStatus === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        {t("auth.loading")}
      </div>
    );
  }

  if (authStatus === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <section className="app-card w-full max-w-lg p-8 text-center">
          <h1 className="text-xl font-bold">{t("auth.sessionErrorTitle")}</h1>
          <p className="mt-2 text-sm leading-6 text-rose-600 dark:text-rose-300">{authError || t("auth.sessionError")}</p>
          <button type="button" className="primary-button mt-5" onClick={refreshAuth}>{t("analysis.retry")}</button>
        </section>
      </main>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <Layout
      activePage={activePage}
      pageTitle={pageTitles[activePage]}
      onNavigate={navigate}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      darkMode={darkMode}
      onToggleTheme={() => saveChromePreference({ darkMode: !darkMode })}
      profile={account.profile}
      monthlyUsage={account.profile?.monthly_ocr_usage || 0}
      onLanguageChange={(language) => saveChromePreference({ language })}
      notificationRefreshKey={notificationRefreshKey}
    >
      {page}
    </Layout>
  );
}
