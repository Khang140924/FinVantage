import {
  getLatestSpendingPlan,
  getMonthlySpendingByCategory,
  getSpendingPlanByMonth,
  upsertSpendingPlan
} from '../services/db.service.js';
import {
  calculateSpendingPlanAnalysis,
  currentPlanMonth,
  isValidPlanMonth,
  validateSpendingPlanInput
} from '../services/spendingPlan.service.js';
import { DEFAULT_SPENDING_PLAN } from '../config/spendingPlan.config.js';
import { requireAuth } from '../utils/cognitoAuth.js';
import { logger } from '../utils/logger.js';
import * as response from '../utils/response.js';

const parseBody = (event = {}) => {
  if (!event.body) return {};
  return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
};

const toPlanPayload = (row, month, { isSaved, source }) => ({
  ...(isSaved && row?.id ? { id: row.id } : {}),
  month,
  monthlyIncome: row?.monthly_income ?? row?.monthlyIncome ?? DEFAULT_SPENDING_PLAN.monthlyIncome,
  needsPercent: row?.needs_percent ?? row?.needsPercent ?? DEFAULT_SPENDING_PLAN.needsPercent,
  wantsPercent: row?.wants_percent ?? row?.wantsPercent ?? DEFAULT_SPENDING_PLAN.wantsPercent,
  savingsPercent: row?.savings_percent ?? row?.savingsPercent ?? DEFAULT_SPENDING_PLAN.savingsPercent,
  currency: row?.currency || DEFAULT_SPENDING_PLAN.currency,
  isSaved,
  source
});

const responsePayload = (plan, categoryTotals) => ({
  plan,
  analysis: calculateSpendingPlanAnalysis(plan, categoryTotals)
});

export const handler = async (event = {}) => {
  const auth = await requireAuth(event);
  if (auth.error) return auth.error;
  const userId = auth.user.sub;
  const method = event.httpMethod || event.requestContext?.http?.method;
  let requestMonth = event.queryStringParameters?.month || null;

  try {
    if (method === 'GET') {
      requestMonth = requestMonth || currentPlanMonth();
      if (!isValidPlanMonth(requestMonth)) {
        return response.badRequest('month phải có định dạng YYYY-MM.');
      }

      const [savedPlan, categoryTotals] = await Promise.all([
        getSpendingPlanByMonth(userId, requestMonth),
        getMonthlySpendingByCategory(userId, requestMonth)
      ]);
      if (savedPlan) {
        const plan = toPlanPayload(savedPlan, requestMonth, { isSaved: true, source: 'saved' });
        return response.success(responsePayload(plan, categoryTotals));
      }

      const latestPlan = await getLatestSpendingPlan(userId, requestMonth);
      const plan = toPlanPayload(latestPlan, requestMonth, {
        isSaved: false,
        source: latestPlan ? 'latest' : 'default'
      });
      return response.success(responsePayload(plan, categoryTotals));
    }

    if (method === 'PUT') {
      let body;
      try {
        body = parseBody(event);
      } catch {
        return response.badRequest('Request body phải là JSON hợp lệ.');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return response.badRequest('Request body phải là một JSON object hợp lệ.');
      }
      const validation = validateSpendingPlanInput(body);
      requestMonth = validation.value.month || null;
      if (!validation.valid) return response.badRequest(validation.errors.join(' '));

      const savedPlan = await upsertSpendingPlan(userId, validation.value);
      const categoryTotals = await getMonthlySpendingByCategory(userId, validation.value.month);
      const plan = toPlanPayload(savedPlan, validation.value.month, { isSaved: true, source: 'saved' });
      return response.success(responsePayload(plan, categoryTotals));
    }

    return response.sendResponse(405, { message: 'Method not allowed.' });
  } catch (error) {
    logger.error('Spending Plan API failed', error, { userId, method, month: requestMonth });
    return response.serverError('Không thể xử lý kế hoạch chi tiêu lúc này.');
  }
};
