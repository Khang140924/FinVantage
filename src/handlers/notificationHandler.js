import {
  deleteNotificationById,
  getNotificationsByUser,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead
} from '../services/db.service.js';
import { requireAuth } from '../utils/cognitoAuth.js';
import { logger } from '../utils/logger.js';
import * as response from '../utils/response.js';

const safeFailure = (error) => ({
  name: error?.name || 'NotificationError',
  code: error?.code || 'NOTIFICATION_REQUEST_FAILED'
});

export const handler = async (event = {}) => {
  const auth = await requireAuth(event);
  if (auth.error) return auth.error;
  const userId = auth.user.sub;
  const method = event.httpMethod || event.requestContext?.http?.method;
  const path = event.path || event.rawPath || '';

  try {
    if (method === 'GET' && path.endsWith('/unread-count')) {
      return response.success({ unread_count: await getUnreadNotificationCount(userId) });
    }
    if (method === 'GET') {
      const notifications = await getNotificationsByUser(userId, event.queryStringParameters?.limit);
      return response.success({ notifications, unread_count: await getUnreadNotificationCount(userId) });
    }
    if (method === 'PUT' && path.endsWith('/read-all')) {
      const updatedCount = await markAllNotificationsRead(userId);
      return response.success({ updated_count: updatedCount, unread_count: 0 });
    }
    if (method === 'PUT' && path.endsWith('/read')) {
      const notificationId = event.pathParameters?.id;
      if (!notificationId) return response.badRequest('Thiếu notification id.');
      const notification = await markNotificationRead(notificationId, userId);
      return notification ? response.success({ notification }) : response.notFound('Không tìm thấy thông báo.');
    }
    if (method === 'DELETE') {
      const notificationId = event.pathParameters?.id;
      if (!notificationId) return response.badRequest('Thiếu notification id.');
      const deleted = await deleteNotificationById(notificationId, userId);
      return deleted ? response.success({ deleted_id: deleted.id }) : response.notFound('Không tìm thấy thông báo.');
    }
    return response.sendResponse(405, { message: 'Method not allowed.' });
  } catch (error) {
    logger.error('Notification API failed', safeFailure(error), { userId, method, path });
    return response.serverError(
      'Không thể xử lý thông báo.',
      'NOTIFICATION_REQUEST_FAILED'
    );
  }
};
