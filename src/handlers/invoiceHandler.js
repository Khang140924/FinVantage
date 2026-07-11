import { getDashboardSummary, getInvoicesByUser } from '../services/db.service.js';
import * as response from '../utils/response.js';
import { logger } from '../utils/logger.js';

const DEFAULT_USER_ID = 'demo-user';

const getUserId = (event = {}) => {
  const userId = event.queryStringParameters?.userId;
  return typeof userId === 'string' && userId.trim() ? userId.trim() : DEFAULT_USER_ID;
};

export const listInvoices = async (event = {}) => {
  const userId = getUserId(event);

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
  const userId = getUserId(event);

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
