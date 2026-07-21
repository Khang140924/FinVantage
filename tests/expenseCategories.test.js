import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_ALIASES,
  EXPENSE_CATEGORY_VALUES,
  PAYMENT_METHOD_VALUES,
  SPENDING_CATEGORY_BUCKETS,
  isExpenseCategory,
  normalizeExpenseCategory
} from '../shared/expenseCategories.js';
import { SPENDING_PLAN_CATEGORY_MAP } from '../src/config/spendingPlan.config.js';
import { classifySpendingCategory } from '../src/services/spendingPlan.service.js';

const expectedCategories = [
  'Ăn uống',
  'Di chuyển',
  'Mua sắm',
  'Giải trí',
  'Hóa đơn',
  'Sức khỏe',
  'Giáo dục',
  'Khác'
];

test('shared expense taxonomy exposes exactly the eight stable API values', () => {
  assert.deepEqual(EXPENSE_CATEGORY_VALUES, expectedCategories);
  assert.equal(EXPENSE_CATEGORIES.length, 8);
  assert.equal(new Set(EXPENSE_CATEGORIES.map((item) => item.value)).size, 8);
  assert.equal(new Set(EXPENSE_CATEGORIES.map((item) => item.labelKey)).size, 8);
  assert.ok(EXPENSE_CATEGORIES.every((item) => ['needs', 'wants'].includes(item.spendingBucket)));
  assert.deepEqual(PAYMENT_METHOD_VALUES, ['Cash', 'Bank', 'Credit Card', 'E-Wallet']);
});

test('category normalization is trim/case tolerant and resolves supported aliases', () => {
  assert.deepEqual(EXPENSE_CATEGORY_ALIASES, {
    'Y tế': 'Sức khỏe',
    'Hóa đơn tiện ích': 'Hóa đơn'
  });
  assert.equal(normalizeExpenseCategory('  ăn   UỐNG '), 'Ăn uống');
  assert.equal(normalizeExpenseCategory(' y TẾ '), 'Sức khỏe');
  assert.equal(normalizeExpenseCategory('HÓA ĐƠN TIỆN ÍCH'), 'Hóa đơn');
  assert.equal(normalizeExpenseCategory('unknown'), null);
  assert.equal(isExpenseCategory('giáo dục'), true);
  assert.equal(isExpenseCategory(''), false);
});

test('spending buckets are derived from the same taxonomy and normalize aliases', () => {
  assert.deepEqual(SPENDING_CATEGORY_BUCKETS.needs, ['Ăn uống', 'Di chuyển', 'Hóa đơn', 'Sức khỏe', 'Giáo dục']);
  assert.deepEqual(SPENDING_CATEGORY_BUCKETS.wants, ['Mua sắm', 'Giải trí', 'Khác']);
  for (const category of expectedCategories) {
    assert.equal(SPENDING_PLAN_CATEGORY_MAP[category], SPENDING_CATEGORY_BUCKETS.needs.includes(category) ? 'needs' : 'wants');
  }
  assert.deepEqual(classifySpendingCategory(' Y tế '), {
    bucket: 'needs',
    category: 'Sức khỏe',
    isUnclassified: false
  });
  assert.deepEqual(classifySpendingCategory('hóa đơn tiện ích'), {
    bucket: 'needs',
    category: 'Hóa đơn',
    isUnclassified: false
  });
});
