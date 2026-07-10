export function formatCurrency(amount) {
  return `${Number(amount).toLocaleString("vi-VN")} VNĐ`;
}

export function formatPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}%`;
}
