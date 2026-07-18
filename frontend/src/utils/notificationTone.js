export const notificationToneRank = { success: 0, warning: 1, danger: 2 };

export function getNotificationTone(item = {}) {
  const text = `${item.type || ""} ${item.title || ""} ${item.message || ""}`.toUpperCase();
  if (/(FAILED|ERROR|EXCEEDED|DANGER|THẤT BẠI|VƯỢT)/u.test(text)) return "danger";
  if (/(BUDGET_WARNING|WARNING|80\s*%|CẢNH BÁO)/u.test(text)) return "warning";
  return "success";
}
