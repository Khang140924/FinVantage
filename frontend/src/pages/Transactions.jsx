import { Download, Eye, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import DataSourceBadge from "../components/DataSourceBadge.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import {
  createInvoice,
  deleteInvoice,
  getInvoice,
  updateInvoice,
} from "../services/api.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { formatCurrency, formatCurrencyForCsv } from "../utils/format.js";

const emptyForm = { storeName: "", totalAmount: "", category: "", status: "ANALYZED", transactionDate: "" };
const emptyManualForm = {
  storeName: "",
  totalAmount: "",
  category: "",
  paymentMethod: "Cash",
  transactionDate: "",
  notes: "",
};
const shortReference = (id) => `HD-${String(id || "").replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase().padStart(8, "0")}`;

export default function Transactions({ searchQuery, invoices = [], apiStatus = {}, onChanged, onNavigate }) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [manualForm, setManualForm] = useState(emptyManualForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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

  function viewAnalysis(transaction) {
    onNavigate?.("analysis", null, { invoiceId: transaction.id });
  }

  async function openEdit(transaction) {
    setBusy(true); setError("");
    try {
      const result = await getInvoice(transaction.id);
      const invoice = result.invoice;
      setSelected(invoice);
      setForm({
        storeName: invoice.store_name || "",
        totalAmount: invoice.total_amount ?? "",
        category: invoice.category || "",
        status: invoice.status || "ANALYZED",
        transactionDate: String(invoice.transaction_date || "").slice(0, 10),
      });
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function saveChanges(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await updateInvoice(selected.id, form);
      setSelected(null);
      await onChanged?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function createManualTransaction(event) {
  event.preventDefault();

  setBusy(true);
  setError("");

  try {
    await createInvoice({
      storeName: manualForm.storeName,
      totalAmount: Number(manualForm.totalAmount),
      category: manualForm.category,
      paymentMethod: manualForm.paymentMethod,
      transactionDate: manualForm.transactionDate,
      notes: manualForm.notes,
      source: "MANUAL",
    });

    setManualForm(emptyManualForm);
    setShowCreate(false);

    await onChanged?.();
  } catch (err) {
    setError(err.message);
  } finally {
    setBusy(false);
  }
}
  async function remove(transaction) {
    if (!window.confirm(t("transactions.confirmDelete"))) return;
    setBusy(true); setError("");
    try { await deleteInvoice(transaction.id); setSelected(null); await onChanged?.(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  function exportCsv() {
    const rows = [["Reference", "Store", "Date", "Category", "Amount", "Currency", "Status"], ...filtered.map((item) => [shortReference(item.id), item.store, item.transactionDate, item.category, formatCurrencyForCsv(item.amount, item.currency), item.currency || "VND", item.status])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
    link.download = "finvantage-transactions.csv"; link.click(); URL.revokeObjectURL(link.href);
  }

  return <div className="space-y-6">
    <section className="app-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="text-xl font-bold text-slate-950 dark:text-white">{t("transactions.title")}</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("transactions.backendDescription")}</p></div>
     <div className="flex flex-wrap gap-2">

  <DataSourceBadge
    loading={apiStatus.loading}
    source="backend"
  />

  <button
    type="button"
    className="primary-button"
    onClick={() => setShowCreate(true)}
  >
    <Plus className="h-4 w-4" />
    Thêm giao dịch
  </button>

  <button
    type="button"
    className="soft-button"
    onClick={exportCsv}
  >
    <Download className="h-4 w-4" />
    {t("actions.exportCsv")}
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
            <td className="px-4 py-4 font-semibold">{item.store}</td><td className="px-4 py-4 text-slate-500">{item.transactionDate}</td><td className="px-4 py-4">{item.category}</td><td className="px-4 py-4 font-bold">{formatCurrency(item.amount, item.currency)}</td><td className="px-4 py-4"><StatusBadge status={item.status} /></td>
            <td className="px-4 py-4"><TransactionActions item={item} busy={busy} t={t} onView={viewAnalysis} onEdit={openEdit} onDelete={remove} /></td>
          </tr>) : <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">{t("transactions.noResults")}</td></tr>}</tbody>
        </table>
      </div>

      <div className="divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
        {filtered.length ? filtered.map((item) => <article key={item.id} className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-950 dark:text-white">{item.store}</h3><p className="mt-1 text-xs text-slate-500">{item.transactionDate} · {item.category}</p></div><StatusBadge status={item.status} /></div>
          <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(item.amount, item.currency)}</p>
          <TransactionActions item={item} busy={busy} t={t} onView={viewAnalysis} onEdit={openEdit} onDelete={remove} />
        </article>) : <p className="p-6 text-center text-sm text-slate-500">{t("transactions.noResults")}</p>}
      </div>
    </section>

    {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><section className="app-card max-h-[90vh] w-full max-w-2xl overflow-auto p-6">
      <div className="flex items-center justify-between gap-4"><div><h2 className="text-xl font-bold">{t("transactions.editTitle")}</h2><p className="mt-1 text-xs text-slate-500">{shortReference(selected.id)}</p></div><button type="button" className="icon-button" aria-label={t("transactions.actions.close")} onClick={() => setSelected(null)}><X /></button></div>
      <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={saveChanges}>{[["storeName", "text"], ["totalAmount", "number"], ["category", "text"], ["transactionDate", "date"]].map(([name, type]) => <label key={name} className="text-sm font-semibold">{t(`transactions.fields.${name}`)}<input className="form-control mt-1" type={type} min={type === "number" ? 0 : undefined} value={form[name]} onChange={(event) => setForm({ ...form, [name]: event.target.value })} required /></label>)}
        <label className="text-sm font-semibold">{t("transactions.fields.status")}<select className="form-control mt-1" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{["ANALYZED", "PENDING", "PAID", "WARNING"].map((status) => <option key={status}>{status}</option>)}</select></label>
        <div className="flex items-end"><button className="primary-button" disabled={busy}>{t("transactions.save")}</button></div>

      </form>
    </section></div>}
              {/* Modal tạo giao dịch */}
    {showCreate && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
        <section className="app-card max-h-[90vh] w-full max-w-2xl overflow-auto p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-bold">Thêm giao dịch thủ công</h2>

            <button
              type="button"
              className="icon-button"
              onClick={() => {
    setShowCreate(false);
    setManualForm(emptyManualForm);
}}
            >
              <X />
            </button>
          </div>

          <form
            className="mt-5 grid gap-4 sm:grid-cols-2"
            onSubmit={createManualTransaction}
          >
            <label className="text-sm font-semibold">
              Tên cửa hàng
              <input
                className="form-control mt-1"
                value={manualForm.storeName}
                onChange={(e) =>
                  setManualForm({
                    ...manualForm,
                    storeName: e.target.value,
                  })
                }
                required
              />
            </label>

            <label className="text-sm font-semibold">
              Số tiền
              <input
                className="form-control mt-1"
                type="number"
                min="0"
                value={manualForm.totalAmount}
                onChange={(e) =>
                  setManualForm({
                    ...manualForm,
                    totalAmount: e.target.value,
                  })
                }
                required
              />
            </label>

            <label className="text-sm font-semibold">
              Danh mục
              <input
                className="form-control mt-1"
                value={manualForm.category}
                onChange={(e) =>
                  setManualForm({
                    ...manualForm,
                    category: e.target.value,
                  })
                }
                required
              />
            </label>

            <label className="text-sm font-semibold">
              Ngày giao dịch
              <input
                className="form-control mt-1"
                type="date"
                value={manualForm.transactionDate}
                onChange={(e) =>
                  setManualForm({
                    ...manualForm,
                    transactionDate: e.target.value,
                  })
                }
                required
              />
            </label>

            <label className="text-sm font-semibold">
              Phương thức thanh toán
              <select
                className="form-control mt-1"
                value={manualForm.paymentMethod}
                onChange={(e) =>
                  setManualForm({
                    ...manualForm,
                    paymentMethod: e.target.value,
                  })
                }
              >
                <option value="Cash">Cash</option>
                <option value="Bank">Bank</option>
                <option value="Credit Card">Credit Card</option>
                <option value="E-Wallet">E-Wallet</option>
              </select>
            </label>

            <label className="text-sm font-semibold sm:col-span-2">
              Ghi chú
              <textarea
                rows={3}
                className="form-control mt-1"
                value={manualForm.notes}
                onChange={(e) =>
                  setManualForm({
                    ...manualForm,
                    notes: e.target.value,
                  })
                }
              />
            </label>

            <div className="sm:col-span-2 flex justify-end gap-3">
              <button
                type="button"
                className="soft-button"
                onClick={() => setShowCreate(false)}
              >
                Hủy
              </button>

              <button
                type="submit"
                className="primary-button"
                disabled={busy}
              >
                Lưu giao dịch
              </button>
            </div>
          </form>
        </section>
      </div>
    )}
  </div>;
}

function TransactionActions({ item, busy, t, onView, onEdit, onDelete }) {
  return <div className="flex flex-wrap gap-2"><button type="button" className="soft-button" title={t("transactions.actions.view")} aria-label={t("transactions.actions.view")} onClick={() => onView(item)} disabled={busy}><Eye className="h-4 w-4" /></button><button type="button" className="soft-button" title={t("transactions.actions.edit")} aria-label={t("transactions.actions.edit")} onClick={() => onEdit(item)} disabled={busy}><Pencil className="h-4 w-4" /></button><button type="button" className="soft-button text-rose-600" title={t("transactions.actions.delete")} aria-label={t("transactions.actions.delete")} onClick={() => onDelete(item)} disabled={busy}><Trash2 className="h-4 w-4" /></button></div>;
}
