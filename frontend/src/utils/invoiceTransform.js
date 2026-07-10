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

export function normalizeInvoice(invoice = {}) {
  const id = String(invoice.id ?? invoice.invoiceId ?? "");

  return {
    id,
    store: invoice.store_name || invoice.storeName || "Unknown store",
    date: formatInvoiceDate(invoice.created_at || invoice.createdAt),
    category: invoice.category || "Uncategorized",
    amount: toNumber(invoice.total_amount ?? invoice.totalAmount),
    method: invoice.source_file_key || invoice.sourceFileKey ? "OCR Upload" : "AI Analysis",
    status: invoice.status || "ANALYZED",
    rawText: invoice.raw_text || invoice.rawText || "",
    aiAdvice: invoice.ai_advice || invoice.aiAdvice || "",
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

  const aiResult = {
    store_name: analysis.store_name || invoice.store_name || "Unknown store",
    total_amount: totalAmount == null ? null : toNumber(totalAmount),
    category: analysis.category || invoice.category || "Uncategorized",
    confidence: analysis.confidence ?? invoice.confidence ?? null,
    ai_advice: analysis.ai_advice || invoice.ai_advice || "",
  };

  const transaction = normalizeInvoice({
    ...invoice,
    id: invoiceId,
    store_name: aiResult.store_name,
    total_amount: aiResult.total_amount,
    category: aiResult.category,
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
