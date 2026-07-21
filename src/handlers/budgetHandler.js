import {
  deleteBudgetById,
  evaluateBudgetNotifications,
  getBudgetAlertNotification,
  getBudgetsWithSpending,
  upsertBudget
} from '../services/db.service.js';
import { publishBudgetAlert } from '../services/notification.service.js';
import { requireAuth } from '../utils/cognitoAuth.js';
import * as response from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { normalizeExpenseCategory } from '../../shared/expenseCategories.js';

const parseBody = (event) => {
  if (!event.body) return {};
  return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
};

export const handler = async (event = {}) => {
  const auth = await requireAuth(event);
  if (auth.error) return auth.error;
  const userId = auth.user.sub;
  const method = event.httpMethod || event.requestContext?.http?.method;

  try {
    if (method === 'GET') {
      const budgets = await getBudgetsWithSpending(userId);
      const alerts = budgets.filter((item) => item.percentage >= 80).map((item) => ({
        budgetId: item.id,
        category: item.category,
        spent: item.spent,
        limit: item.amount,
        percent: item.percentage,
        severity: item.status === 'exceeded' ? 'danger' : 'warning'
      }));
      return response.success({ budgets, alerts });
    }

    if (method === 'POST') {
      const body = parseBody(event);
      const category = normalizeExpenseCategory(body.category);
      const amount = Number(body.amount ?? body.limit);
      if (!category) {
        return response.badRequest('Danh mục ngân sách không hợp lệ.');
      }
      if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(amount)) {
        return response.badRequest('Hạn mức phải là số nguyên dương.');
      }
      const budget = await upsertBudget(userId, category, amount);
      const evaluation = await evaluateBudgetNotifications(userId, category);
      if (evaluation.createdNotifications.length) {
        try { await publishBudgetAlert(userId, await getBudgetAlertNotification(userId, category)); }
        catch (notificationError) { logger.warn('SNS budget alert publish failed', { userId, category, error: notificationError.message }); }
      }
      return response.success({ budget, budgets: await getBudgetsWithSpending(userId), notifications_created: evaluation.createdNotifications.length });
    }

    if (method === 'DELETE') {
      const budgetId = event.pathParameters?.id;
      if (!budgetId) return response.badRequest('Thiếu budget id.');
      const deleted = await deleteBudgetById(budgetId, userId);
      return deleted ? response.success({ deletedId: deleted.id }) : response.notFound('Không tìm thấy ngân sách.');
    }

    return response.sendResponse(405, { message: 'Method not allowed.' });
  } catch (error) {
    logger.error('Budget API failed', error, { userId, method });
    return response.serverError(
      'Không thể xử lý ngân sách lúc này.',
      'BUDGET_REQUEST_FAILED'
    );
  }
};
