import { getDashboardSummary, getInvoicesByUser } from '../services/db.service.js';
import * as response from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { requireAuth } from '../utils/cognitoAuth.js';

export const listInvoices = async (event = {}) => {
  const auth = await requireAuth(event);
  if (auth.error) return auth.error;
  const userId = auth.user.sub;

  try {
    logger.info('Fetching invoices for user', { userId });
    const invoices = await getInvoicesByUser(userId);

    return response.success({
      userId,
      invoices
    });
  } catch (error) {
    logger.error('Failed to fetch invoices', error, { userId });
    return response.serverError(`Không thể lấy danh sách hóa đơn: ${error.message}`);
  }
};

export const dashboardSummary = async (event = {}) => {
  const auth = await requireAuth(event);
  if (auth.error) return auth.error;
  const userId = auth.user.sub;

  try {
    logger.info('Fetching dashboard summary for user', { userId });
    const summary = await getDashboardSummary(userId);

    return response.success({
      userId,
      summary
    });
  } catch (error) {
    logger.error('Failed to fetch dashboard summary', error, { userId });
    return response.serverError(`Không thể lấy tổng quan dashboard: ${error.message}`);
  }
};
