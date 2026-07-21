import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateSpendingPlanAnalysis,
  classifySpendingCategory,
  currentPlanMonth,
  isValidPlanMonth,
  validateSpendingPlanInput
} from '../src/services/spendingPlan.service.js';

const validPlan = {
  month: '2026-07',
  monthlyIncome: 10_000_000,
  needsPercent: 50,
  wantsPercent: 30,
  savingsPercent: 20,
  currency: 'VND'
};

test('all canonical needs categories map to needs', () => {
  for (const category of ['Ăn uống', 'Di chuyển', 'Hóa đơn', 'Sức khỏe', 'Giáo dục']) {
    assert.deepEqual(classifySpendingCategory(category), { bucket: 'needs', category, isUnclassified: false });
  }
});

test('all canonical wants categories map to wants', () => {
  for (const category of ['Mua sắm', 'Giải trí', 'Khác']) {
    assert.deepEqual(classifySpendingCategory(category), { bucket: 'wants', category, isUnclassified: false });
  }
});

test('unknown and blank categories map to wants and stay identifiable', () => {
  assert.deepEqual(classifySpendingCategory('Du lịch'), { bucket: 'wants', category: 'Du lịch', isUnclassified: true });
  assert.deepEqual(classifySpendingCategory(null), { bucket: 'wants', category: 'Không phân loại', isUnclassified: true });
});

test('month helpers accept only YYYY-MM and derive a deterministic UTC month', () => {
  assert.equal(isValidPlanMonth('2026-07'), true);
  assert.equal(isValidPlanMonth('2026-7'), false);
  assert.equal(isValidPlanMonth('2026-13'), false);
  assert.equal(isValidPlanMonth('0000-01'), false);
  assert.equal(currentPlanMonth(new Date('2026-07-31T23:00:00.000Z')), '2026-07');
});

test('valid plan input is normalized', () => {
  const result = validateSpendingPlanInput({ ...validPlan, currency: 'vnd' });
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, validPlan);
});

test('invalid month is rejected', () => {
  const result = validateSpendingPlanInput({ ...validPlan, month: '07-2026' });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /YYYY-MM/);
});

test('zero, negative and nonnumeric income are rejected', () => {
  for (const monthlyIncome of [0, -1, 'not-a-number']) {
    assert.equal(validateSpendingPlanInput({ ...validPlan, monthlyIncome }).valid, false);
  }
});

test('percentages outside zero through one hundred are rejected', () => {
  assert.equal(validateSpendingPlanInput({ ...validPlan, needsPercent: -1, wantsPercent: 81 }).valid, false);
  assert.equal(validateSpendingPlanInput({ ...validPlan, savingsPercent: 101, wantsPercent: -1 }).valid, false);
  assert.equal(validateSpendingPlanInput({ ...validPlan, savingsPercent: null }).valid, false);
});

test('percentage sum must equal one hundred', () => {
  const result = validateSpendingPlanInput({ ...validPlan, needsPercent: 40 });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /bằng 100/);
});

test('only VND is accepted', () => {
  const result = validateSpendingPlanInput({ ...validPlan, currency: 'USD' });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /VND/);
});

test('values are normalized to database precision before validation', () => {
  const valid = validateSpendingPlanInput({
    ...validPlan,
    monthlyIncome: 1_000_000.125,
    needsPercent: 50.004,
    wantsPercent: 29.996,
    savingsPercent: 20
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.value.monthlyIncome, 1_000_000.13);
  assert.equal(valid.value.needsPercent, 50);
  assert.equal(valid.value.wantsPercent, 30);

  const invalidAfterRounding = validateSpendingPlanInput({
    ...validPlan,
    needsPercent: 33.3333,
    wantsPercent: 33.3333,
    savingsPercent: 33.3334
  });
  assert.equal(invalidAfterRounding.valid, false);
});

test('empty-income analysis contains finite safe values', () => {
  const analysis = calculateSpendingPlanAnalysis({ monthlyIncome: null }, []);
  assert.equal(analysis.monthlyIncome, 0);
  assert.equal(analysis.targetSavings, 0);
  assert.equal(analysis.spendableIncome, 0);
  assert.equal(analysis.usagePercent, 0);
  assert.equal(analysis.allocation.needs.status, 'NORMAL');
  assert.equal(analysis.warnings.length > 0, true);
  assert.deepEqual(analysis.warningCodes, ['NO_INCOME']);
  assert.deepEqual(analysis.suggestionCodes, ['NO_INCOME']);
});

test('50/30/20 analysis calculates targets, reserved savings and usable income', () => {
  const analysis = calculateSpendingPlanAnalysis(validPlan, [
    { category: 'Ăn uống', total_amount: 2_000_000 },
    { category: 'Mua sắm', total_amount: 1_000_000 }
  ]);
  assert.equal(analysis.targetSavings, 2_000_000);
  assert.equal(analysis.spendableIncome, 8_000_000);
  assert.equal(analysis.totalSpent, 3_000_000);
  assert.equal(analysis.remainingIncome, 5_000_000);
  assert.equal(analysis.spendingReductionNeeded, 0);
  assert.equal(analysis.usagePercent, 37.5);
  assert.equal(analysis.allocation.needs.recommendedAmount, 5_000_000);
  assert.equal(analysis.allocation.wants.recommendedAmount, 3_000_000);
});

test('allocation below eighty percent has NORMAL status', () => {
  const analysis = calculateSpendingPlanAnalysis(validPlan, [
    { category: 'Ăn uống', total_amount: 3_999_999 },
    { category: 'Giải trí', total_amount: 2_399_999 }
  ]);
  assert.equal(analysis.allocation.needs.status, 'NORMAL');
  assert.equal(analysis.allocation.wants.status, 'NORMAL');
});

test('allocation at exactly eighty percent has WARNING status', () => {
  const analysis = calculateSpendingPlanAnalysis(validPlan, [
    { category: 'Ăn uống', total_amount: 4_000_000 },
    { category: 'Giải trí', total_amount: 2_400_000 }
  ]);
  assert.equal(analysis.allocation.needs.status, 'WARNING');
  assert.equal(analysis.allocation.wants.status, 'WARNING');
  assert.equal(analysis.allocation.needs.usagePercent, 80);
  assert.equal(analysis.suggestionCodes.includes('NEEDS_WARNING'), true);
  assert.equal(analysis.suggestionCodes.includes('WANTS_WARNING'), true);
});

test('allocation below one hundred percent remains WARNING', () => {
  const analysis = calculateSpendingPlanAnalysis(validPlan, [
    { category: 'Ăn uống', total_amount: 4_999_999 },
    { category: 'Giải trí', total_amount: 2_999_999 }
  ]);
  assert.equal(analysis.allocation.needs.status, 'WARNING');
  assert.equal(analysis.allocation.wants.status, 'WARNING');
});

test('allocation at exactly one hundred percent has EXCEEDED status with no excess amount', () => {
  const analysis = calculateSpendingPlanAnalysis(validPlan, [
    { category: 'Ăn uống', total_amount: 5_000_000 },
    { category: 'Giải trí', total_amount: 3_000_000 }
  ]);
  assert.equal(analysis.allocation.needs.status, 'EXCEEDED');
  assert.equal(analysis.allocation.wants.status, 'EXCEEDED');
  assert.equal(analysis.allocation.needs.remainingAmount, 0);
  assert.equal(analysis.allocation.needs.overspentAmount, 0);
  assert.equal(analysis.remainingIncome, 0);
  assert.equal(analysis.spendingReductionNeeded, 0);
  assert.match(analysis.warnings.join(' '), /thu nhập có thể sử dụng/);
  assert.equal(analysis.warningCodes.includes('SPENDING_EXCEEDS_SPENDABLE_INCOME'), true);
  assert.equal(analysis.warningCodes.includes('NEEDS_EXCEEDED'), true);
  assert.equal(analysis.warningCodes.includes('WANTS_EXCEEDED'), true);
});

test('allocation above one hundred percent exposes nonnegative remaining and exact excess', () => {
  const analysis = calculateSpendingPlanAnalysis(validPlan, [
    { category: 'Hóa đơn', total_amount: 5_500_000 },
    { category: 'Giải trí', total_amount: 3_250_000 }
  ]);
  assert.equal(analysis.allocation.needs.status, 'EXCEEDED');
  assert.equal(analysis.allocation.wants.status, 'EXCEEDED');
  assert.equal(analysis.allocation.needs.remainingAmount, 0);
  assert.equal(analysis.allocation.wants.remainingAmount, 0);
  assert.equal(analysis.allocation.needs.overspentAmount, 500_000);
  assert.equal(analysis.allocation.wants.overspentAmount, 250_000);
  assert.equal(analysis.spendingReductionNeeded, 750_000);
  assert.equal(analysis.warnings.length >= 2, true);
  assert.equal(analysis.warningCodes.includes('SAVINGS_SHORTFALL'), true);
});

test('zero target is NORMAL without spending and EXCEEDED with spending', () => {
  const noSpending = calculateSpendingPlanAnalysis({
    ...validPlan,
    needsPercent: 0,
    wantsPercent: 80
  }, []);
  const withSpending = calculateSpendingPlanAnalysis({
    ...validPlan,
    needsPercent: 0,
    wantsPercent: 80
  }, [{ category: 'Ăn uống', total_amount: 1 }]);
  assert.equal(noSpending.allocation.needs.status, 'NORMAL');
  assert.equal(withSpending.allocation.needs.status, 'EXCEEDED');
  assert.equal(withSpending.allocation.needs.remainingAmount, 0);
  assert.equal(withSpending.allocation.needs.overspentAmount, 1);
});

test('no transactions returns full remaining usable income and NORMAL allocations', () => {
  const analysis = calculateSpendingPlanAnalysis(validPlan, []);
  assert.equal(analysis.totalSpent, 0);
  assert.equal(analysis.remainingIncome, 8_000_000);
  assert.equal(analysis.allocation.needs.status, 'NORMAL');
  assert.equal(analysis.allocation.wants.status, 'NORMAL');
  assert.equal(analysis.allocation.needs.remainingAmount, 5_000_000);
  assert.equal(analysis.allocation.wants.remainingAmount, 3_000_000);
  assert.deepEqual(analysis.suggestionCodes, ['ON_TRACK']);
});

test('unknown totals count in wants and are surfaced deterministically', () => {
  const analysis = calculateSpendingPlanAnalysis(validPlan, [
    { category: 'Du lịch', total_amount: 400_000 },
    { category: null, total_amount: 100_000 },
    { category: 'Du lịch', total_amount: 50_000 }
  ]);
  assert.equal(analysis.allocation.wants.actualAmount, 550_000);
  assert.equal(analysis.unclassifiedAmount, 550_000);
  assert.deepEqual(analysis.unclassifiedCategories, ['Du lịch', 'Không phân loại']);
  assert.match(analysis.suggestions.join(' '), /chưa phân loại/);
  assert.equal(analysis.suggestionCodes.includes('UNCLASSIFIED_CATEGORIES'), true);
});

test('spending above income emits both usable-income and total-income warning codes', () => {
  const analysis = calculateSpendingPlanAnalysis(validPlan, [
    { category: 'Hóa đơn', total_amount: 7_000_000 },
    { category: 'Mua sắm', total_amount: 4_000_000 }
  ]);
  assert.equal(analysis.totalSpent, 11_000_000);
  assert.equal(analysis.remainingIncome, -3_000_000);
  assert.equal(analysis.spendingReductionNeeded, 3_000_000);
  assert.equal(analysis.warningCodes.includes('SPENDING_EXCEEDS_INCOME'), true);
  assert.equal(analysis.warningCodes.includes('SPENDING_EXCEEDS_SPENDABLE_INCOME'), true);
});

test('analysis does not mutate the input transaction totals array', () => {
  const categoryTotals = [
    { category: 'Ăn uống', total_amount: 1_000_000 },
    { category: 'Legacy', total_amount: 250_000 }
  ];
  const before = structuredClone(categoryTotals);
  calculateSpendingPlanAnalysis(validPlan, categoryTotals);
  assert.deepEqual(categoryTotals, before);
});
