import { Download, Eye, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHOD_VALUES,
  normalizeExpenseCategory,
} from "@shared/expenseCategories.js";
import DataSourceBadge from "../components/DataSourceBadge.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { deleteInvoice, getInvoice, updateInvoice } from "../services/api.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { formatCurrency, formatCurrencyForCsv } from "../utils/format.js";
import {
  buildTransactionsCsv,
  createTransactionIdempotencyKey,
  validateTransactionForm,
} from "../utils/transactions.js";

const firstCategory = EXPENSE_CATEGORIES[0].value;
const emptyEditForm = {
  storeName: "",
  totalAmount: "",
  category: firstCategory,
  paymentMethod: PAYMENT_METHOD_VALUES[0],
  transactionDate: "",
  notes: "",
  status: "ANALYZED",
};
const emptyManualForm = {
  storeName: "",
  totalAmount: "",
  category: firstCategory,
  paymentMethod: PAYMENT_METHOD_VALUES[0],
  transactionDate: "",
  notes: "",
};
const paymentLabelKeys = Object.freeze({
  Cash: "paymentMethods.cash",
  Bank: "paymentMethods.bank",
  "Credit Card": "paymentMethods.creditCard",
  "E-Wallet": "paymentMethods.eWallet",
});
const shortReference = (id) => `HD-${String(id || "").replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase().padStart(8, "0")}`;
const localToday = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export default function Transactions({ searchQuery, invoices = [], apiStatus = {}, onChanged, onCreate, onNavigate }) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyEditForm);
  const [manualForm, setManualForm] = useState(emptyManualForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const createAttemptKey = useRef(null);
  const query = searchQuery.trim().toLowerCase();
  const filtered = useMemo(() => invoices.filter((item) => !query || [
    item.store,
    item.category,
    item.status,
    item.method,
    item.amount,
    item.transactionDate,
    shortReference(item.id),
    ...(item.lineItems || []).map((lineItem) => lineItem.normalized_item_name || lineItem.item || lineItem.raw_item_name),
  ].join(" ").toLowerCase().includes(query)), [invoices, query]);

  const categoryLabel = (value) => {
    const canonical = normalizeExpenseCategory(value);
    const definition = EXPENSE_CATEGORIES.find((item) => item.value === canonical);
    return definition ? t(definition.labelKey) : String(value || t("categories.other"));
  };

  const validationError = (result) => {
    const firstError = Object.keys(result.errors)[0];
    return firstError ? t(`transactions.validation.${firstError}`) : t("transactions.validation.invalid");
  };

  function viewAnalysis(transaction) {
    onNavigate?.("analysis", null, { invoiceId: transaction.id });
  }

  async function openEdit(transaction) {
    setBusy(true);
    setError("");
    try {
      const result = await getInvoice(transaction.id);
      const invoice = result.invoice;
      const paymentMethod = PAYMENT_METHOD_VALUES.includes(invoice.payment_method)
        ? invoice.payment_method
        : PAYMENT_METHOD_VALUES[0];
      setSelected(invoice);
      setForm({
        storeName: invoice.store_name || "",
        totalAmount: invoice.total_amount ?? "",
        category: normalizeExpenseCategory(invoice.category) || "Khác",
        paymentMethod,
        transactionDate: String(invoice.transaction_date || "").slice(0, 10),
        notes: invoice.notes || "",
        status: invoice.status === "PAID" ? "PAID" : "ANALYZED",
      });
    } catch (currentError) {
      setError(currentError.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveChanges(event) {
    event.preventDefault();
    setError("");
    const validation = validateTransactionForm(form, { editing: true });
    if (!validation.valid) {
      setError(validationError(validation));
      return;
    }
    setBusy(true);
    try {
      await updateInvoice(selected.id, validation.value);
      setSelected(null);
      setForm(emptyEditForm);
      await onChanged?.();
    } catch (currentError) {
      setError(currentError.message);
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    setManualForm({ ...emptyManualForm, transactionDate: localToday() });
    createAttemptKey.current = createTransactionIdempotencyKey();
    setError("");
    setShowCreate(true);
  }

  function closeCreate() {
    setShowCreate(false);
    setManualForm(emptyManualForm);
    createAttemptKey.current = null;
    setError("");
  }

  async function createManualTransaction(event) {
    event.preventDefault();
    setError("");
    const validation = validateTransactionForm(manualForm);
    if (!validation.valid) {
      setError(validationError(validation));
      return;
    }
    if (!onCreate) {
      setError(t("transactions.createUnavailable"));
      return;
    }

    setBusy(true);
    try {
      createAttemptKey.current ||= createTransactionIdempotencyKey();
      await onCreate(validation.value, createAttemptKey.current);
      setShowCreate(false);
      setManualForm(emptyManualForm);
      createAttemptKey.current = null;
    } catch (currentError) {
      setError(currentError.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(transaction) {
    if (!window.confirm(t("transactions.confirmDelete"))) return;
    setBusy(true);
    setError("");
    try {
      await deleteInvoice(transaction.id);
      setSelected(null);
      await onChanged?.();
    } catch (currentError) {
      setError(currentError.message);
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const rows = [
      ["Reference", "Store", "Date", "Category", "Amount", "Currency", "Status"],
      ...filtered.map((item) => [
        shortReference(item.id),
        item.store,
        item.transactionDate,
        categoryLabel(item.category),
        formatCurrencyForCsv(item.amount, item.currency),
        item.currency || "VND",
        item.status,
      ]),
    ];
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`\ufeff${buildTransactionsCsv(rows)}`], { type: "text/csv;charset=utf-8" }));
    link.download = "finvantage-transactions.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return <div className="space-y-6">
    <section className="app-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="text-xl font-bold text-slate-950 dark:text-white">{t("transactions.title")}</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("transactions.backendDescription")}</p></div>
      <div className="flex flex-wrap gap-2">
        <DataSourceBadge loading={apiStatus.loading} source="backend" />
        <button type="button" className="primary-button" onClick={openCreate}>
          <Plus className="h-4 w-4" />{t("transactions.add")}
        </button>
        <button type="button" className="soft-button" onClick={exportCsv}>
          <Download className="h-4 w-4" />{t("actions.exportCsv")}
        </button>
      </div>
    </section>
    {apiStatus.error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{apiStatus.error}</p>}
    {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

    <section className="app-card overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800"><div className="input-shell max-w-md"><Search className="h-4 w-4 text-slate-400" /><span className="text-sm text-slate-500">{query ? t("transactions.resultsFor", { count: filtered.length, query: searchQuery }) : t("transactions.searchFromTopbar")}</span></div></div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900"><tr>
            {["store", "date", "category", "amount", "status", "actions"].map((key) => <th key={key} className="px-4 py-3 font-bold">{t(`transactions.table.${key}`)}</th>)}
          </tr></thead>
          <tbody>{filtered.length ? filtered.map((item) => <tr key={item.id} className="table-row">
            <td className="px-4 py-4 font-semibold">{item.store}</td><td className="px-4 py-4 text-slate-500">{item.transactionDate}</td><td className="px-4 py-4">{categoryLabel(item.category)}</td><td className="px-4 py-4 font-bold">{formatCurrency(item.amount, item.currency)}</td><td className="px-4 py-4"><StatusBadge status={item.status} /></td>
            <td className="px-4 py-4"><TransactionActions item={item} busy={busy} t={t} onView={viewAnalysis} onEdit={openEdit} onDelete={remove} /></td>
          </tr>) : <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">{t("transactions.noResults")}</td></tr>}</tbody>
        </table>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
        {filtered.length ? filtered.map((item) => <article key={item.id} className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-950 dark:text-white">{item.store}</h3><p className="mt-1 text-xs text-slate-500">{item.transactionDate} · {categoryLabel(item.category)}</p></div><StatusBadge status={item.status} /></div>
          <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(item.amount, item.currency)}</p>
          <TransactionActions item={item} busy={busy} t={t} onView={viewAnalysis} onEdit={openEdit} onDelete={remove} />
        </article>) : <p className="p-6 text-center text-sm text-slate-500">{t("transactions.noResults")}</p>}
      </div>
    </section>

    {selected && <TransactionModal
      title={t("transactions.editTitle")}
      subtitle={shortReference(selected.id)}
      form={form}
      setForm={setForm}
      busy={busy}
      t={t}
      onClose={() => { setSelected(null); setForm(emptyEditForm); setError(""); }}
      onSubmit={saveChanges}
      submitLabel={t("transactions.save")}
      categoryLabel={categoryLabel}
      editing
    />}

    {showCreate && <TransactionModal
      title={t("transactions.createTitle")}
      form={manualForm}
      setForm={setManualForm}
      busy={busy}
      t={t}
      onClose={closeCreate}
      onSubmit={createManualTransaction}
      submitLabel={t("transactions.createSave")}
      categoryLabel={categoryLabel}
    />}
  </div>;
}

function TransactionModal({ title, subtitle, form, setForm, busy, t, onClose, onSubmit, submitLabel, categoryLabel, editing = false }) {
  const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
    <section className="app-card max-h-[90vh] w-full max-w-2xl overflow-auto p-6">
      <div className="flex items-center justify-between gap-4"><div><h2 className="text-xl font-bold">{title}</h2>{subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}</div><button type="button" className="icon-button" aria-label={t("transactions.actions.close")} onClick={onClose}><X /></button></div>
      <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
        <label className="text-sm font-semibold">{t("transactions.fields.storeName")}<input className="form-control mt-1" value={form.storeName} maxLength={255} onChange={(event) => update("storeName", event.target.value)} required /></label>
        <label className="text-sm font-semibold">{t("transactions.fields.totalAmount")}<input className="form-control mt-1" type="number" min="1" step="1" value={form.totalAmount} onChange={(event) => update("totalAmount", event.target.value)} required /></label>
        <label className="text-sm font-semibold">{t("transactions.fields.category")}<select className="form-control mt-1" value={form.category} onChange={(event) => update("category", event.target.value)} required>{EXPENSE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{categoryLabel(item.value)}</option>)}</select></label>
        <label className="text-sm font-semibold">{t("transactions.fields.transactionDate")}<input className="form-control mt-1" type="date" value={form.transactionDate} onChange={(event) => update("transactionDate", event.target.value)} required /></label>
        <label className="text-sm font-semibold">{t("transactions.fields.paymentMethod")}<select className="form-control mt-1" value={form.paymentMethod} onChange={(event) => update("paymentMethod", event.target.value)} required>{PAYMENT_METHOD_VALUES.map((method) => <option key={method} value={method}>{t(paymentLabelKeys[method])}</option>)}</select></label>
        {editing && <label className="text-sm font-semibold">{t("transactions.fields.status")}<select className="form-control mt-1" value={form.status} onChange={(event) => update("status", event.target.value)}>{["ANALYZED", "PAID"].map((status) => <option key={status} value={status}>{status}</option>)}</select></label>}
        <label className="text-sm font-semibold sm:col-span-2">{t("transactions.fields.notes")}<textarea className="form-control mt-1" rows={3} maxLength={1000} value={form.notes} onChange={(event) => update("notes", event.target.value)} /><span className="mt-1 block text-right text-xs font-normal text-slate-400">{form.notes.length}/1000</span></label>
        <div className="flex justify-end gap-3 sm:col-span-2"><button type="button" className="soft-button" onClick={onClose}>{t("actions.cancel")}</button><button type="submit" className="primary-button" disabled={busy}>{submitLabel}</button></div>
      </form>
    </section>
  </div>;
}

function TransactionActions({ item, busy, t, onView, onEdit, onDelete }) {
  return <div className="flex flex-wrap gap-2"><button type="button" className="soft-button" title={t("transactions.actions.view")} aria-label={t("transactions.actions.view")} onClick={() => onView(item)} disabled={busy}><Eye className="h-4 w-4" /></button><button type="button" className="soft-button" title={t("transactions.actions.edit")} aria-label={t("transactions.actions.edit")} onClick={() => onEdit(item)} disabled={busy}><Pencil className="h-4 w-4" /></button><button type="button" className="soft-button text-rose-600" title={t("transactions.actions.delete")} aria-label={t("transactions.actions.delete")} onClick={() => onDelete(item)} disabled={busy}><Trash2 className="h-4 w-4" /></button></div>;
}
