const categoryColors = ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#f43f5e"];

function toNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function formatInvoiceDate(value) {
  if (!value) return "Pending";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";

  return date.toLocaleDateString("vi-VN");
}

function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function normalizeInvoice(invoice = {}) {
  const id = String(invoice.id ?? invoice.invoiceId ?? "");

  return {
    id,
    store: invoice.store_name || invoice.storeName || "Không xác định",
    date: formatInvoiceDate(invoice.transaction_date || invoice.transactionDate || invoice.created_at || invoice.createdAt),
    transactionDate: toDateInput(invoice.transaction_date || invoice.transactionDate || invoice.created_at || invoice.createdAt),
    category: invoice.category || "Uncategorized",
    amount: toNumber(invoice.total_amount ?? invoice.totalAmount),
    currency: invoice.currency || "VND",
    method: invoice.source_file_key || invoice.sourceFileKey ? "OCR Upload" : "AI Analysis",
    status: invoice.status || "ANALYZED",
    rawText: invoice.raw_text || invoice.rawText || "",
    aiAdvice: invoice.ai_advice || invoice.aiAdvice || "",
    lineItems: Array.isArray(invoice.line_items ?? invoice.lineItems) ? (invoice.line_items ?? invoice.lineItems) : [],
    sourceFileKey: invoice.source_file_key || invoice.sourceFileKey || "",
    source: invoice.source || "backend",
  };
}

export function normalizeInvoices(invoices = []) {
  return Array.isArray(invoices) ? invoices.map(normalizeInvoice) : [];
}

export function buildCategorySpending(summary) {
  const categories = Array.isArray(summary?.categories) ? summary.categories : [];

  return categories
    .map((item, index) => ({
      name: item.category || "Uncategorized",
      value: toNumber(item.total_amount ?? item.value),
      color: categoryColors[index % categoryColors.length],
    }))
    .filter((item) => item.value > 0);
}

export function normalizeAnalysisPayload(payload = {}) {
  const invoice = payload.invoice || {};
  const analysis = payload.analysis || {};
  const upload = payload.upload || null;
  const invoiceId = String(invoice.id || upload?.invoiceId || payload.invoiceId || "");
  const rawText = invoice.raw_text || invoice.rawText || payload.rawText || "";
  const totalAmount = analysis.total_amount ?? invoice.total_amount;
  const transactionDate = analysis.transaction_date ?? invoice.transaction_date ?? null;
  const lineItems = analysis.line_items ?? invoice.line_items ?? [];

  const aiResult = {
    store_name: analysis.store_name || invoice.store_name || "Không xác định",
    total_amount: totalAmount == null ? null : toNumber(totalAmount),
    currency: analysis.currency || invoice.currency || "VND",
    transaction_date: transactionDate ? String(transactionDate).slice(0, 10) : null,
    line_items: Array.isArray(lineItems) ? lineItems : [],
    category: analysis.category || invoice.category || "Uncategorized",
    confidence: analysis.confidence ?? invoice.confidence ?? null,
    ai_advice: analysis.ai_advice || invoice.ai_advice || "",
  };

  const transaction = normalizeInvoice({
    ...invoice,
    id: invoiceId,
    store_name: aiResult.store_name,
    total_amount: aiResult.total_amount,
    currency: aiResult.currency,
    category: aiResult.category,
    transaction_date: aiResult.transaction_date,
    line_items: aiResult.line_items,
    ai_advice: aiResult.ai_advice,
    raw_text: rawText,
    source_file_key: invoice.source_file_key || upload?.fileKey,
    status: invoice.status || "ANALYZED",
  });

  return {
    invoiceId,
    rawText,
    aiResult,
    invoice,
    source: "backend",
    transaction,
    upload,
  };
}
