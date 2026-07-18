export const DEFAULT_CURRENCY = "VND";
export const SUPPORTED_DISPLAY_CURRENCIES = [DEFAULT_CURRENCY];

export function normalizeCurrency(currency) {
  return SUPPORTED_DISPLAY_CURRENCIES.includes(currency) ? currency : DEFAULT_CURRENCY;
}

export function formatCurrency(amount, currency = DEFAULT_CURRENCY) {
  const numericAmount = Number(amount);
  const safeAmount = Number.isFinite(numericAmount) ? numericAmount : 0;
  const safeCurrency = normalizeCurrency(currency);
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: safeCurrency,
    maximumFractionDigits: safeCurrency === "VND" ? 0 : 2,
  }).format(safeAmount);
}

export function formatCurrencyForCsv(amount, currency = DEFAULT_CURRENCY) {
  return formatCurrency(amount, currency).replace(/\u00a0/g, " ");
}

export function formatPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}%`;
}
