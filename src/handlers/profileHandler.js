import { getOrCreateUserProfile, getUserPreferences, updateUserPreferences, updateUserProfile } from '../services/db.service.js';
import { generateAvatarReadUrl, generateAvatarUploadUrl, verifyAvatarObject } from '../services/s3.service.js';
import { requireAuth } from '../utils/cognitoAuth.js';
import { logger } from '../utils/logger.js';
import * as response from '../utils/response.js';

const safeFailure = (error, fallbackCode = 'PROFILE_REQUEST_FAILED') => ({
  name: error?.name || 'ProfileError',
  code: error?.code || fallbackCode
});

const parseBody = (event) => {
  if (!event.body) return {};
  return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
};

const profilePayload = async (profile) => {
  const avatarKey = profile.avatar_key || (String(profile.avatar_url || '').startsWith('avatars/') ? profile.avatar_url : null);
  let avatarUrl = null;
  if (avatarKey) {
    try {
      avatarUrl = await generateAvatarReadUrl(avatarKey);
    } catch (error) {
      logger.warn('Avatar URL signing unavailable; returning profile without avatar URL', {
        userId: profile.user_id,
        error: error.name || 'CredentialError'
      });
    }
  }
  return {
    ...profile,
    // Until an exchange-rate service is configured, VND is the only honest
    // display currency. Existing invalid/stale preferences are not presented
    // as converted USD/EUR amounts.
    currency: 'VND',
    default_currency: 'VND',
    currency_service_configured: false,
    avatar_key: avatarKey,
    avatar_url: avatarUrl,
    avatar_read_url: avatarUrl,
    avatar_available: Boolean(avatarUrl)
  };
};

export const handler = async (event = {}) => {
  const auth = await requireAuth(event);
  if (auth.error) return auth.error;
  const method = event.httpMethod || event.requestContext?.http?.method;
  const path = event.path || event.rawPath || '';

  try {
    if (path.endsWith('/preferences')) {
      if (method === 'GET') return response.success({ preferences: await getUserPreferences(auth.user) });
      if (method === 'PUT') {
        const body = parseBody(event);
        if (body.language !== undefined && !['en', 'vi'].includes(body.language)) return response.badRequest('language must be en or vi.');
        const booleanFields = ['darkMode', 'dark_mode', 'budgetGuardrails', 'budget_guardrails', 'autoAnalyzeInvoices', 'auto_analyze_invoices'];
        if (booleanFields.some((field) => body[field] !== undefined && typeof body[field] !== 'boolean')) return response.badRequest('Preference toggles must be boolean.');
        const preferences = await updateUserPreferences(auth.user, {
          language: body.language,
          darkMode: body.darkMode ?? body.dark_mode,
          budgetGuardrails: body.budgetGuardrails ?? body.budget_guardrails,
          autoAnalyzeInvoices: body.autoAnalyzeInvoices ?? body.auto_analyze_invoices,
        });
        return response.success({ preferences });
      }
    }

    if ((path.endsWith('/avatar/upload-url') || path.endsWith('/avatar-upload')) && method === 'POST') {
      const body = parseBody(event);
      const extension = String(body.fileName || '').split('.').pop()?.toLowerCase();
      const allowedTypes = new Set(['image/jpeg', 'image/png']);
      const fileSize = Number(body.fileSize);
      if (!['jpg', 'jpeg', 'png'].includes(extension) || !allowedTypes.has(body.contentType)) return response.badRequest('Chỉ chấp nhận ảnh JPG, JPEG hoặc PNG.');
      if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > 2 * 1024 * 1024) return response.badRequest('Ảnh đại diện phải có dung lượng tối đa 2 MB.');
      try {
        return response.success(await generateAvatarUploadUrl(auth.user.sub, body.fileName, body.contentType));
      } catch (error) {
        logger.warn('Avatar presigned upload URL is unavailable', {
          userId: auth.user.sub,
          ...safeFailure(error, 'AVATAR_UPLOAD_URL_FAILED')
        });
        return response.errorResponse(503, {
          error: 'Avatar storage unavailable',
          code: 'AVATAR_STORAGE_UNAVAILABLE',
          message: 'Không thể tạo URL tải ảnh lúc này.'
        });
      }
    }

    if (method === 'GET') return response.success({ profile: await profilePayload(await getOrCreateUserProfile(auth.user)) });
    if (method === 'PUT') {
      const body = parseBody(event);
      const displayName = body.displayName ?? body.display_name;
      if (displayName !== undefined && !String(displayName).trim()) return response.badRequest('displayName cannot be empty.');
      const avatarKey = body.avatarKey ?? body.avatar_key ?? body.avatarUrl ?? body.avatar_url;
      const requestedCurrency = body.defaultCurrency ?? body.default_currency ?? body.currency;
      if (requestedCurrency !== undefined && requestedCurrency !== 'VND') {
        return response.badRequest('USD/EUR chỉ khả dụng khi dịch vụ tỷ giá được cấu hình.');
      }
      if (body.timezone !== undefined && !['Asia/Bangkok', 'Asia/Ho_Chi_Minh', 'UTC'].includes(body.timezone)) return response.badRequest('Unsupported timezone.');
      if (body.phone !== undefined && String(body.phone).length > 50) return response.badRequest('Phone is too long.');
      const safeUserId = String(auth.user.sub).replace(/[^a-zA-Z0-9_-]/g, '-');
      if (avatarKey !== undefined && !new RegExp(`^avatars/${safeUserId}/avatar-[0-9]+\\.(jpg|png)$`).test(String(avatarKey))) {
        return response.badRequest('Avatar key không thuộc người dùng đang đăng nhập.');
      }
      if (avatarKey !== undefined) {
        try { await verifyAvatarObject(String(avatarKey)); }
        catch (error) {
          logger.warn('Avatar object verification failed', {
            userId: auth.user.sub,
            ...safeFailure(error, 'AVATAR_VERIFICATION_FAILED')
          });
          return response.badRequest(
            'Không thể xác nhận ảnh đại diện đã tải lên.',
            'AVATAR_VERIFICATION_FAILED'
          );
        }
      }
      await updateUserProfile(auth.user, {
        displayName: displayName === undefined ? undefined : String(displayName).trim(),
        phone: body.phone,
        avatarKey,
        currency: requestedCurrency,
        timezone: body.timezone,
      });
      return response.success({ profile: await profilePayload(await getOrCreateUserProfile(auth.user)) });
    }
    return response.sendResponse(405, { message: 'Method not allowed.' });
  } catch (error) {
    logger.error('Profile API failed', safeFailure(error), { userId: auth.user.sub, method, path });
    return response.serverError('Không thể xử lý hồ sơ.', 'PROFILE_REQUEST_FAILED');
  }
};
