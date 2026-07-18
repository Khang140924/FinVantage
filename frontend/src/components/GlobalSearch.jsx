import { AlertCircle, FileSearch, Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { searchInvoices } from "../services/api.js";
import { formatCurrency } from "../utils/format.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("vi-VN");
}
export default function GlobalSearch({ value, onChange, onNavigate }) {
  const { t } = useLanguage();
  const containerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const query = String(value || "").trim();

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setLoading(false);
      setError("");
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      searchInvoices(query)
        .then((data) => {
          if (!cancelled) setResults(Array.isArray(data.results) ? data.results : []);
        })
        .catch((requestError) => {
          if (!cancelled) { setResults([]); setError(requestError.message || t("search.error")); }
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 300);

    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, t]);

  useEffect(() => {
    const closeOutside = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function selectResult(result) {
    setOpen(false);
    onNavigate?.("analysis", null, { invoiceId: result.id });
  }

  const showDropdown = open && query.length >= 2;
  return (
    <div className="relative w-full" ref={containerRef}>
      <label className="input-shell">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          value={value}
          onFocus={() => setOpen(true)}
          onChange={(event) => { onChange(event.target.value); setOpen(true); }}
          className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
          placeholder={t("topbar.searchPlaceholder")}
          aria-label={t("topbar.searchPlaceholder")}
          autoComplete="off"
        />
        {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-600" />}
      </label>

      {showDropdown && (
        <section className="absolute left-0 right-0 top-full z-[70] mt-2 max-h-[26rem] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          {error ? (
            <div className="flex items-center gap-3 p-4 text-sm text-rose-600 dark:text-rose-300">
              <AlertCircle className="h-5 w-5 shrink-0" />{error}
            </div>
          ) : loading ? (
            <p className="p-4 text-center text-sm text-slate-500">{t("search.loading")}</p>
          ) : results.length ? results.map((result) => (
            <button
              key={result.id}
              type="button"
              onClick={() => selectResult(result)}
              className="flex w-full items-start justify-between gap-4 rounded-lg px-3 py-3 text-left transition hover:bg-emerald-50 focus:bg-emerald-50 focus:outline-none dark:hover:bg-slate-800 dark:focus:bg-slate-800"
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold">{result.store_name || t("analysis.notReturned")}</span>
                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                  {formatDate(result.transaction_date)} · {result.category || "—"} · {result.reference_code}
                </span>
              </span>
              <span className="shrink-0 text-sm font-bold">{formatCurrency(result.total_amount, result.currency)}</span>
            </button>
          )) : (
            <div className="p-6 text-center">
              <FileSearch className="mx-auto h-7 w-7 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-500">{t("search.empty")}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
