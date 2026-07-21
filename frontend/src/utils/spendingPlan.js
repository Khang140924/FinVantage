export const DEFAULT_SPENDING_PLAN_FORM = Object.freeze({
  monthlyIncome: "",
  needsPercent: "50",
  wantsPercent: "30",
  savingsPercent: "20",
});

const PERCENT_FIELDS = ["needsPercent", "wantsPercent", "savingsPercent"];

export function sanitizeMonthlyIncome(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function spendingPlanToForm(plan) {
  if (!plan) return { ...DEFAULT_SPENDING_PLAN_FORM };

  return {
    monthlyIncome: String(plan.monthlyIncome ?? ""),
    needsPercent: String(plan.needsPercent ?? 50),
    wantsPercent: String(plan.wantsPercent ?? 30),
    savingsPercent: String(plan.savingsPercent ?? 20),
  };
}

export function validateSpendingPlanForm(form) {
  const errors = {};
  const monthlyIncome = Number(form.monthlyIncome);

  if (!Number.isSafeInteger(monthlyIncome) || monthlyIncome <= 0) {
    errors.monthlyIncome = "positiveInteger";
  }

  const percentages = {};
  for (const field of PERCENT_FIELDS) {
    const rawValue = form[field];
    const value = typeof rawValue === "string" && rawValue.trim() === "" ? Number.NaN : Number(rawValue);
    percentages[field] = value;
    if (!Number.isFinite(value) || value < 0 || value > 100) errors[field] = "range";
  }

  const totalPercent = PERCENT_FIELDS.reduce((sum, field) => sum + percentages[field], 0);
  if (PERCENT_FIELDS.every((field) => !errors[field]) && Math.abs(totalPercent - 100) > 0.001) {
    errors.totalPercent = "sum";
  }

  return {
    errors,
    isValid: Object.keys(errors).length === 0,
    value: {
      monthlyIncome,
      ...percentages,
      currency: "VND",
    },
  };
}

export function getAllocationStatus(status, usagePercent = 0) {
  const normalizedStatus = String(status || "").toLowerCase().replace(/[\s_-]/g, "");
  if (["overspent", "exceeded", "overbudget"].includes(normalizedStatus)) return "overspent";
  if (["warning", "nearlimit", "atrisk"].includes(normalizedStatus)) return "warning";
  if (["ontrack", "healthy", "normal", "withinbudget"].includes(normalizedStatus)) return "onTrack";

  const usage = Number(usagePercent);
  if (Number.isFinite(usage) && usage >= 100) return "overspent";
  if (Number.isFinite(usage) && usage >= 80) return "warning";
  return "onTrack";
}

export function clampProgress(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.min(100, Math.max(0, numericValue));
}
