import {
  PAYMENT_METHOD_VALUES,
  normalizeExpenseCategory,
} from "../../../shared/expenseCategories.js";

const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const EDITABLE_STATUSES = new Set(["ANALYZED", "PAID"]);

export function isValidTransactionDate(value) {
  const text = String(value || "").trim();
  if (!DATE_PATTERN.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function validateTransactionForm(form = {}, { editing = false } = {}) {
  const storeName = String(form.storeName || "").normalize("NFC").replace(/\s+/g, " ").trim();
  const totalAmount = Number(form.totalAmount);
  const category = normalizeExpenseCategory(form.category);
  const paymentMethod = String(form.paymentMethod || "").trim();
  const transactionDate = String(form.transactionDate || "").trim();
  const notes = String(form.notes || "").normalize("NFC").trim();
  const status = String(form.status || "ANALYZED").trim().toUpperCase();
  const errors = {};

  if (!storeName || storeName.length > 255) errors.storeName = "storeName";
  if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) errors.totalAmount = "totalAmount";
  if (!category) errors.category = "category";
  if (!PAYMENT_METHOD_VALUES.includes(paymentMethod)) errors.paymentMethod = "paymentMethod";
  if (!isValidTransactionDate(transactionDate)) errors.transactionDate = "transactionDate";
  if (notes.length > 1000) errors.notes = "notes";
  if (editing && !EDITABLE_STATUSES.has(status)) errors.status = "status";

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      storeName,
      totalAmount,
      category,
      paymentMethod,
      transactionDate,
      notes,
      ...(editing ? { status } : { source: "MANUAL" }),
    },
  };
}

export function createTransactionIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const random = Math.random().toString(36).slice(2);
  return `manual-${Date.now().toString(36)}-${random}`;
}

export function escapeCsvCell(value) {
  const text = String(value ?? "");
  const safe = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function buildTransactionsCsv(rows = []) {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}
