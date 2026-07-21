import assert from "node:assert/strict";
import test from "node:test";
import {
  clampProgress,
  getAllocationStatus,
  sanitizeMonthlyIncome,
  spendingPlanToForm,
  validateSpendingPlanForm,
} from "../frontend/src/utils/spendingPlan.js";

test("spending plan validation accepts a positive VND income and percentages totaling 100", () => {
  const result = validateSpendingPlanForm({
    monthlyIncome: "25000000",
    needsPercent: "50",
    wantsPercent: "30",
    savingsPercent: "20",
  });

  assert.equal(result.isValid, true);
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.value, {
    monthlyIncome: 25000000,
    needsPercent: 50,
    wantsPercent: 30,
    savingsPercent: 20,
    currency: "VND",
  });
});

test("spending plan validation rejects invalid income, out-of-range values and totals", () => {
  const invalidFields = validateSpendingPlanForm({
    monthlyIncome: "-1",
    needsPercent: "101",
    wantsPercent: "-1",
    savingsPercent: "0",
  });
  assert.equal(invalidFields.isValid, false);
  assert.equal(invalidFields.errors.monthlyIncome, "positiveInteger");
  assert.equal(invalidFields.errors.needsPercent, "range");
  assert.equal(invalidFields.errors.wantsPercent, "range");

  const invalidTotal = validateSpendingPlanForm({
    monthlyIncome: "10000000",
    needsPercent: "50",
    wantsPercent: "20",
    savingsPercent: "20",
  });
  assert.equal(invalidTotal.errors.totalPercent, "sum");

  const blankPercentage = validateSpendingPlanForm({
    monthlyIncome: "10000000",
    needsPercent: "   ",
    wantsPercent: "80",
    savingsPercent: "20",
  });
  assert.equal(blankPercentage.isValid, false);
  assert.equal(blankPercentage.errors.needsPercent, "range");
});

test("spending plan display helpers normalize form data, statuses and progress", () => {
  assert.deepEqual(spendingPlanToForm({ monthlyIncome: 100, needsPercent: 60 }), {
    monthlyIncome: "100",
    needsPercent: "60",
    wantsPercent: "30",
    savingsPercent: "20",
  });
  assert.equal(getAllocationStatus("OVERSPENT", 10), "overspent");
  assert.equal(getAllocationStatus("EXCEEDED", 10), "overspent");
  assert.equal(getAllocationStatus("WARNING", 10), "warning");
  assert.equal(getAllocationStatus("NORMAL", 120), "onTrack");
  assert.equal(getAllocationStatus("", 85), "warning");
  assert.equal(getAllocationStatus("ON_TRACK", 120), "onTrack");
  assert.equal(clampProgress(130), 100);
  assert.equal(clampProgress(-4), 0);
  assert.equal(sanitizeMonthlyIncome("12e3.5-+abc"), "1235");
});
