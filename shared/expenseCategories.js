export const EXPENSE_CATEGORIES = Object.freeze([
  Object.freeze({ value: "Ăn uống", labelKey: "categories.food", spendingBucket: "needs" }),
  Object.freeze({ value: "Di chuyển", labelKey: "categories.transport", spendingBucket: "needs" }),
  Object.freeze({ value: "Mua sắm", labelKey: "categories.shopping", spendingBucket: "wants" }),
  Object.freeze({ value: "Giải trí", labelKey: "categories.entertainment", spendingBucket: "wants" }),
  Object.freeze({ value: "Hóa đơn", labelKey: "categories.utilities", spendingBucket: "needs" }),
  Object.freeze({ value: "Sức khỏe", labelKey: "categories.health", spendingBucket: "needs" }),
  Object.freeze({ value: "Giáo dục", labelKey: "categories.education", spendingBucket: "needs" }),
  Object.freeze({ value: "Khác", labelKey: "categories.other", spendingBucket: "wants" }),
]);

export const EXPENSE_CATEGORY_VALUES = Object.freeze(EXPENSE_CATEGORIES.map(({ value }) => value));

export const EXPENSE_CATEGORY_ALIASES = Object.freeze({
  "Y tế": "Sức khỏe",
  "Hóa đơn tiện ích": "Hóa đơn",
});

const normalizedCategories = new Map(
  EXPENSE_CATEGORY_VALUES.map((value) => [value.toLocaleLowerCase("vi"), value]),
);
const normalizedAliases = new Map(
  Object.entries(EXPENSE_CATEGORY_ALIASES).map(([alias, value]) => [alias.toLocaleLowerCase("vi"), value]),
);

export function normalizeExpenseCategory(value) {
  const normalized = typeof value === "string"
    ? value.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi")
    : "";
  if (!normalized) return null;
  return normalizedCategories.get(normalized) || normalizedAliases.get(normalized) || null;
}

export function isExpenseCategory(value) {
  return normalizeExpenseCategory(value) !== null;
}

export const SPENDING_CATEGORY_BUCKETS = Object.freeze({
  needs: Object.freeze(EXPENSE_CATEGORIES.filter(({ spendingBucket }) => spendingBucket === "needs").map(({ value }) => value)),
  wants: Object.freeze(EXPENSE_CATEGORIES.filter(({ spendingBucket }) => spendingBucket === "wants").map(({ value }) => value)),
});

export const PAYMENT_METHOD_VALUES = Object.freeze(["Cash", "Bank", "Credit Card", "E-Wallet"]);
