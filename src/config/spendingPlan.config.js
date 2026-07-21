import { SPENDING_CATEGORY_BUCKETS } from '../../shared/expenseCategories.js';

export const DEFAULT_SPENDING_PLAN = Object.freeze({
  monthlyIncome: null,
  needsPercent: 50,
  wantsPercent: 30,
  savingsPercent: 20,
  currency: 'VND'
});

export const SPENDING_PLAN_CATEGORY_BUCKETS = SPENDING_CATEGORY_BUCKETS;

export const SPENDING_PLAN_CATEGORY_MAP = Object.freeze(
  Object.fromEntries(
    Object.entries(SPENDING_PLAN_CATEGORY_BUCKETS)
      .flatMap(([bucket, categories]) => categories.map((category) => [category, bucket]))
  )
);

export const UNCLASSIFIED_CATEGORY_LABEL = 'Không phân loại';
