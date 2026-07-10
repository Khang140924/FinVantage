import { useCallback, useEffect, useMemo, useState } from "react";
import Layout from "./components/Layout.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import UploadInvoice from "./pages/UploadInvoice.jsx";
import AnalysisResult from "./pages/AnalysisResult.jsx";
import Transactions from "./pages/Transactions.jsx";
import BudgetAlerts from "./pages/BudgetAlerts.jsx";
import Settings from "./pages/Settings.jsx";
import { useLanguage } from "./i18n/LanguageContext.jsx";
import { DEFAULT_USER_ID, getDashboardSummary, getInvoices, isApiConfigured } from "./services/api.js";
import { normalizeAnalysisPayload, normalizeInvoices } from "./utils/invoiceTransform.js";

export default function App() {
  const { t } = useLanguage();
  const [activePage, setActivePage] = useState("dashboard");
  const [searchQuery, setSearchQuery] = useState("");
  const [invoices, setInvoices] = useState([]);
  const [dashboardSummary, setDashboardSummary] = useState(null);
  const [latestAnalysis, setLatestAnalysis] = useState(null);
  const [apiStatus, setApiStatus] = useState({
    loading: false,
    error: isApiConfigured ? null : "Set VITE_API_BASE_URL to read live backend data.",
    lastUpdated: null,
    source: "mock",
  });
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem("finvantage-theme") === "dark";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("finvantage-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  const refreshFinanceData = useCallback(async () => {
    if (!isApiConfigured) {
      setApiStatus({
        loading: false,
        error: "Set VITE_API_BASE_URL to read live backend data.",
        lastUpdated: null,
        source: "mock",
      });
      return;
    }

    setApiStatus((current) => ({ ...current, loading: true, error: null }));

    try {
      const [invoiceData, summaryData] = await Promise.all([
        getInvoices(DEFAULT_USER_ID),
        getDashboardSummary(DEFAULT_USER_ID),
      ]);

      setInvoices(normalizeInvoices(invoiceData.invoices));
      setDashboardSummary(summaryData.summary || null);
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
        source: "mock",
      }));
    }
  }, []);

  useEffect(() => {
    refreshFinanceData();
  }, [refreshFinanceData]);

  const handleAnalysisComplete = useCallback(
    (payload) => {
      const normalized = normalizeAnalysisPayload(payload);
      setLatestAnalysis(normalized);
      setInvoices((current) => [
        normalized.transaction,
        ...current.filter((invoice) => invoice.id !== normalized.transaction.id),
      ]);
      refreshFinanceData();
    },
    [refreshFinanceData]
  );

  const page = useMemo(() => {
    switch (activePage) {
      case "upload":
        return <UploadInvoice onNavigate={setActivePage} onAnalysisComplete={handleAnalysisComplete} />;
      case "analysis":
        return <AnalysisResult latestAnalysis={latestAnalysis} />;
      case "transactions":
        return <Transactions searchQuery={searchQuery} invoices={invoices} apiStatus={apiStatus} />;
      case "budgets":
        return <BudgetAlerts />;
      case "settings":
        return <Settings darkMode={darkMode} onToggleTheme={setDarkMode} />;
      case "dashboard":
      default:
        return (
          <Dashboard
            onNavigate={setActivePage}
            invoices={invoices}
            summary={dashboardSummary}
            apiStatus={apiStatus}
          />
        );
    }
  }, [activePage, apiStatus, dashboardSummary, darkMode, handleAnalysisComplete, invoices, latestAnalysis, searchQuery]);

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

  return (
    <Layout
      activePage={activePage}
      pageTitle={pageTitles[activePage]}
      onNavigate={setActivePage}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      darkMode={darkMode}
      onToggleTheme={() => setDarkMode((value) => !value)}
    >
      {page}
    </Layout>
  );
}
