import {
  DEFAULT_SPENDING_PLAN,
  SPENDING_PLAN_CATEGORY_MAP,
  UNCLASSIFIED_CATEGORY_LABEL
} from '../config/spendingPlan.config.js';
import { normalizeExpenseCategory } from '../../shared/expenseCategories.js';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONTHLY_INCOME = 9_999_999_999.99;
const roundMoney = (value) => Number(Number(value || 0).toFixed(2));
const roundPercent = (value) => Number(Number(value || 0).toFixed(2));
const finiteNumber = (value) => {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};

export const currentPlanMonth = (date = new Date()) => date.toISOString().slice(0, 7);

export const isValidPlanMonth = (value) => {
  const month = String(value || '');
  return MONTH_PATTERN.test(month) && Number(month.slice(0, 4)) > 0;
};

export const validateSpendingPlanInput = (body = {}) => {
  const monthlyIncome = finiteNumber(body.monthlyIncome);
  const needsPercent = finiteNumber(body.needsPercent);
  const wantsPercent = finiteNumber(body.wantsPercent);
  const savingsPercent = finiteNumber(body.savingsPercent);
  const value = {
    month: String(body.month || '').trim(),
    monthlyIncome: monthlyIncome === null ? null : roundMoney(monthlyIncome),
    needsPercent: needsPercent === null ? null : roundPercent(needsPercent),
    wantsPercent: wantsPercent === null ? null : roundPercent(wantsPercent),
    savingsPercent: savingsPercent === null ? null : roundPercent(savingsPercent),
    currency: String(body.currency || DEFAULT_SPENDING_PLAN.currency).trim().toUpperCase()
  };
  const errors = [];

  if (!isValidPlanMonth(value.month)) errors.push('month phải có định dạng YYYY-MM.');
  if (value.monthlyIncome === null || value.monthlyIncome <= 0) {
    errors.push('monthlyIncome phải là số dương.');
  } else if (value.monthlyIncome > MAX_MONTHLY_INCOME) {
    errors.push('monthlyIncome vượt quá giới hạn lưu trữ được hỗ trợ.');
  }

  const percentFields = [
    ['needsPercent', value.needsPercent],
    ['wantsPercent', value.wantsPercent],
    ['savingsPercent', value.savingsPercent]
  ];
  for (const [field, percent] of percentFields) {
    if (percent === null || percent < 0 || percent > 100) {
      errors.push(`${field} phải nằm trong khoảng từ 0 đến 100.`);
    }
  }
  if (percentFields.every(([, percent]) => percent !== null)
    && Math.abs(percentFields.reduce((sum, [, percent]) => sum + percent, 0) - 100) > 0.000001) {
    errors.push('Tổng needsPercent, wantsPercent và savingsPercent phải bằng 100.');
  }
  if (value.currency !== 'VND') errors.push('Spending Plan hiện chỉ hỗ trợ tiền tệ VND.');

  return { valid: errors.length === 0, errors, value };
};

export const classifySpendingCategory = (category) => {
  const normalizedCategory = typeof category === 'string' ? category.trim() : '';
  const canonicalCategory = normalizeExpenseCategory(normalizedCategory);
  const bucket = canonicalCategory ? SPENDING_PLAN_CATEGORY_MAP[canonicalCategory] : null;
  return bucket
    ? { bucket, category: canonicalCategory, isUnclassified: false }
    : {
        bucket: 'wants',
        category: normalizedCategory || UNCLASSIFIED_CATEGORY_LABEL,
        isUnclassified: true
      };
};

const spendingAllocation = (percent, recommendedAmount, actualAmount) => {
  const rawUsagePercent = recommendedAmount > 0 ? (actualAmount / recommendedAmount) * 100 : 0;
  const usagePercent = recommendedAmount > 0
    ? roundPercent(rawUsagePercent)
    : (actualAmount > 0 ? 100 : 0);
  let status = 'NORMAL';
  if (recommendedAmount <= 0) status = actualAmount > 0 ? 'EXCEEDED' : 'NORMAL';
  else if (rawUsagePercent >= 100) status = 'EXCEEDED';
  else if (rawUsagePercent >= 80) status = 'WARNING';

  return {
    percent,
    recommendedAmount: roundMoney(recommendedAmount),
    actualAmount: roundMoney(actualAmount),
    remainingAmount: roundMoney(Math.max(recommendedAmount - actualAmount, 0)),
    overspentAmount: roundMoney(Math.max(actualAmount - recommendedAmount, 0)),
    usagePercent,
    status
  };
};

export const calculateSpendingPlanAnalysis = (plan = {}, categoryTotals = []) => {
  const monthlyIncome = Math.max(finiteNumber(plan.monthlyIncome ?? plan.monthly_income) || 0, 0);
  const needsPercent = finiteNumber(plan.needsPercent ?? plan.needs_percent)
    ?? DEFAULT_SPENDING_PLAN.needsPercent;
  const wantsPercent = finiteNumber(plan.wantsPercent ?? plan.wants_percent)
    ?? DEFAULT_SPENDING_PLAN.wantsPercent;
  const savingsPercent = finiteNumber(plan.savingsPercent ?? plan.savings_percent)
    ?? DEFAULT_SPENDING_PLAN.savingsPercent;
  const actual = { needs: 0, wants: 0 };
  let unclassifiedAmount = 0;
  const unclassified = new Set();

  for (const row of Array.isArray(categoryTotals) ? categoryTotals : []) {
    const amount = Math.max(finiteNumber(row?.totalAmount ?? row?.total_amount ?? row?.amount) || 0, 0);
    const classification = classifySpendingCategory(row?.category);
    actual[classification.bucket] += amount;
    if (classification.isUnclassified && amount > 0) {
      unclassifiedAmount += amount;
      unclassified.add(classification.category);
    }
  }

  const targetSavings = roundMoney(monthlyIncome * savingsPercent / 100);
  const spendableIncome = roundMoney(monthlyIncome - targetSavings);
  const needsRecommended = roundMoney(monthlyIncome * needsPercent / 100);
  const wantsRecommended = roundMoney(monthlyIncome * wantsPercent / 100);
  const needs = spendingAllocation(needsPercent, needsRecommended, actual.needs);
  const wants = spendingAllocation(wantsPercent, wantsRecommended, actual.wants);
  const totalSpent = roundMoney(actual.needs + actual.wants);
  const remainingIncome = roundMoney(monthlyIncome - totalSpent - targetSavings);
  const spendingReductionNeeded = roundMoney(Math.max(totalSpent - spendableIncome, 0));
  const usagePercent = spendableIncome > 0
    ? roundPercent((totalSpent / spendableIncome) * 100)
    : (totalSpent > 0 ? 100 : 0);
  const warnings = [];
  const suggestions = [];
  const warningCodes = [];
  const suggestionCodes = [];
  const addWarning = (code, message) => {
    warningCodes.push(code);
    warnings.push(message);
  };
  const addSuggestion = (code, message) => {
    suggestionCodes.push(code);
    suggestions.push(message);
  };

  if (monthlyIncome <= 0) {
    addWarning('NO_INCOME', 'Chưa có thu nhập tháng để phân tích kế hoạch chi tiêu.');
    addSuggestion('NO_INCOME', 'Hãy nhập thu nhập tháng để nhận gợi ý phân bổ 50/30/20.');
  } else {
    if (totalSpent > monthlyIncome) {
      addWarning('SPENDING_EXCEEDS_INCOME', 'Tổng chi tiêu đã vượt thu nhập tháng.');
    }
    if (totalSpent >= spendableIncome) {
      addWarning(
        'SPENDING_EXCEEDS_SPENDABLE_INCOME',
        'Tổng chi tiêu đã chạm hoặc vượt phần thu nhập có thể sử dụng.'
      );
    }
    if (needs.status === 'EXCEEDED') {
      addWarning('NEEDS_EXCEEDED', 'Chi tiêu thiết yếu đã chạm hoặc vượt mức đề xuất.');
      addSuggestion('NEEDS_EXCEEDED', 'Hãy rà soát các khoản thiết yếu có thể cắt giảm trong tháng này.');
    } else if (needs.status === 'WARNING') {
      addSuggestion('NEEDS_WARNING', 'Chi tiêu thiết yếu đã dùng từ 80% mức đề xuất.');
    }
    if (wants.status === 'EXCEEDED') {
      addWarning('WANTS_EXCEEDED', 'Chi tiêu mong muốn đã chạm hoặc vượt mức đề xuất.');
      addSuggestion('WANTS_EXCEEDED', 'Hãy ưu tiên giảm mua sắm hoặc giải trí để bảo vệ mục tiêu tiết kiệm.');
    } else if (wants.status === 'WARNING') {
      addSuggestion('WANTS_WARNING', 'Chi tiêu mong muốn đã dùng từ 80% mức đề xuất.');
    }
    if (remainingIncome < 0) {
      addWarning('SAVINGS_SHORTFALL', 'Số tiền còn lại đang thấp hơn mục tiêu tiết kiệm.');
      addSuggestion('SAVINGS_SHORTFALL', 'Hãy giảm chi tiêu để bù phần thiếu hụt so với mục tiêu tiết kiệm.');
    }
    if (unclassifiedAmount > 0) {
      addSuggestion('UNCLASSIFIED_CATEGORIES', 'Hãy kiểm tra các danh mục chưa phân loại để kế hoạch chính xác hơn.');
    }
    if (!warnings.length && !suggestions.length) {
      addSuggestion('ON_TRACK', 'Kế hoạch chi tiêu đang đi đúng hướng.');
    }
  }

  return {
    monthlyIncome: roundMoney(monthlyIncome),
    targetSavings,
    spendableIncome,
    totalSpent,
    remainingIncome,
    spendingReductionNeeded,
    usagePercent,
    allocation: {
      needs,
      wants,
      savings: { percent: savingsPercent, targetAmount: targetSavings }
    },
    unclassifiedAmount: roundMoney(unclassifiedAmount),
    unclassifiedCategories: [...unclassified].sort((a, b) => a.localeCompare(b, 'vi')),
    suggestions,
    warnings,
    suggestionCodes,
    warningCodes
  };
};
