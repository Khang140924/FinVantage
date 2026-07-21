import {
  createInvoiceRecord,
  deleteInvoiceById,
  evaluateBudgetNotifications,
  getDashboardSummary,
  getInvoiceById,
  getInvoiceFromCache,
  getInvoicesByUser,
  searchInvoicesByUser,
  updateInvoiceById
} from '../services/db.service.js';
import * as response from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { requireAuth } from '../utils/cognitoAuth.js';
import { buildOcrCacheKey } from '../utils/invoice.js';
import { resolvePipelineProgress } from '../utils/invoicePipeline.js';
import {
  validateIdempotencyKey,
  validateTransactionCreate,
  validateTransactionUpdate
} from '../utils/transactionValidation.js';

const parseJsonBody = (event = {}) => {
  if (!event.body) return {};
  return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
};

const getHeader = (event, expectedName) => {
  const entry = Object.entries(event.headers || {})
    .find(([name]) => name.toLowerCase() === expectedName.toLowerCase());
  return entry?.[1];
};

const ownsCachedInvoice = (cachedInvoice, invoiceId, userId) => {
  if (cachedInvoice?.userId) return String(cachedInvoice.userId) === String(userId);
  const safeUserId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
  return String(invoiceId).startsWith(`invoice-${safeUserId}-`);
};

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
    return response.serverError(
      'Không thể lấy danh sách giao dịch lúc này.',
      'LIST_INVOICES_FAILED'
    );
  }
};

export const createInvoice = async (event = {}) => {
  const auth = await requireAuth(event);
  if (auth.error) return auth.error;

  let body;
  try {
    body = parseJsonBody(event);
  } catch {
    return response.badRequest(
      'Request body phải là JSON hợp lệ.',
      'INVALID_JSON_BODY'
    );
  }

  const validation = validateTransactionCreate(body);
  if (!validation.valid) {
    return response.badRequest(validation.message, validation.code);
  }
  const idempotency = validateIdempotencyKey(getHeader(event, 'Idempotency-Key'));
  if (!idempotency.valid) {
    return response.badRequest(idempotency.message, idempotency.code);
  }

  try {
    const result = await createInvoiceRecord({
      userId: auth.user.sub,
      ...validation.value,
      idempotencyKey: idempotency.value
    });

    try {
      await evaluateBudgetNotifications(auth.user.sub, result.invoice.category);
    } catch (notificationError) {
      logger.warn('Budget notification evaluation failed after invoice create', {
        invoiceId: result.invoice.id,
        userId: auth.user.sub,
        error: notificationError.message
      });
    }

    const payload = {
      invoice: result.invoice,
      idempotentReplay: !result.created
    };
    return result.created ? response.created(payload) : response.success(payload);
  } catch (error) {
    logger.error('Failed to create manual invoice', error, { userId: auth.user.sub });
    return response.serverError(
      'Không thể tạo giao dịch lúc này.',
      'CREATE_INVOICE_FAILED'
    );
  }
};

export const dashboardSummary = async (event = {}) => {
  const auth = await requireAuth(event);
  if (auth.error) return auth.error;
  const userId = auth.user.sub;
  const month = event.queryStringParameters?.month || null;
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return response.badRequest('month phải có định dạng YYYY-MM.');
  }

  try {
    logger.info('Fetching dashboard summary for user', { userId });
    const summary = await getDashboardSummary(userId, month);

    return response.success({
      userId,
      summary
    });
  } catch (error) {
    logger.error('Failed to fetch dashboard summary', error, { userId });
    return response.serverError(
      'Không thể lấy tổng quan dashboard lúc này.',
      'DASHBOARD_SUMMARY_FAILED'
    );
  }
};

export const searchInvoices = async (event = {}) => {
  const auth = await requireAuth(event);
  if (auth.error) return auth.error;
  const query = String(event.queryStringParameters?.q || '').trim();
  if (!query) return response.success({ results: [], query: '' });
  if (query.length < 2) return response.success({ results: [], query });
  if (query.length > 100) return response.badRequest('Từ khóa tìm kiếm tối đa 100 ký tự.');

  try {
    const results = await searchInvoicesByUser(auth.user.sub, query, 20);
    return response.success({ results, query });
  } catch (error) {
    logger.error('Global invoice search failed', error, { userId: auth.user.sub });
    return response.serverError('Không thể tìm kiếm giao dịch lúc này.');
  }
};

const authenticateInvoiceRequest = async (event) => {
  const auth = await requireAuth(event);
  if (auth.error) return auth;
  return { userId: auth.user.sub, invoiceId: event.pathParameters?.id };
};

export const getInvoice = async (event = {}) => {
  const auth = await authenticateInvoiceRequest(event);
  if (auth.error) return auth.error;
  if (!auth.invoiceId) return response.badRequest('Thiếu invoice id.');

  try {
    const invoice = await getInvoiceById(auth.invoiceId, auth.userId);
    return invoice ? response.success({ invoice }) : response.notFound('Không tìm thấy hóa đơn.');
  } catch (error) {
    logger.error('Failed to fetch invoice detail', error, auth);
    return response.serverError(
      'Không thể lấy chi tiết giao dịch lúc này.',
      'GET_INVOICE_FAILED'
    );
  }
};

export const getInvoiceStatus = async (event = {}) => {
  const auth = await authenticateInvoiceRequest(event);
  if (auth.error) return auth.error;
  if (!auth.invoiceId) return response.badRequest('Thiếu invoice id.');

  try {
    const cachedInvoice = await getInvoiceFromCache(buildOcrCacheKey(auth.invoiceId));
    if (cachedInvoice) {
      if (!ownsCachedInvoice(cachedInvoice, auth.invoiceId, auth.userId)) {
        return response.notFound('Không tìm thấy trạng thái hóa đơn.');
      }
      const status = cachedInvoice.status || 'UPLOADED';
      const ocrReady = status === 'OCR_PROCESSING'
        && Boolean(String(cachedInvoice.rawText || cachedInvoice.raw_text || '').trim())
        && Number(cachedInvoice.totalAmount ?? cachedInvoice.total_amount) > 0;
      const progress = resolvePipelineProgress(cachedInvoice, { ocrReady });
      const failed = status === 'OCR_FAILED' || status === 'ANALYSIS_FAILED';
      return response.success({
        invoiceId: auth.invoiceId,
        status,
        progress,
        warning: cachedInvoice.warning || null,
        error: failed ? {
          code: cachedInvoice.errorCode || status,
          message: cachedInvoice.errorMessage || 'Không thể xử lý hóa đơn.'
        } : null
      });
    }

    const invoice = await getInvoiceById(auth.invoiceId, auth.userId);
    if (!invoice) return response.notFound('Không tìm thấy trạng thái hóa đơn.');
    return response.success({
      invoiceId: auth.invoiceId,
      status: 'ANALYZED',
      progress: 100,
      warning: null,
      error: null
    });
  } catch (error) {
    logger.error('Failed to fetch invoice pipeline status', error, auth);
    return response.serverError('Không thể kiểm tra trạng thái xử lý hóa đơn.');
  }
};

export const updateInvoice = async (event = {}) => {
  const auth = await authenticateInvoiceRequest(event);
  if (auth.error) return auth.error;
  if (!auth.invoiceId) {
    return response.badRequest('Thiếu invoice id.', 'INVOICE_ID_REQUIRED');
  }

  let body;
  try {
    body = parseJsonBody(event);
  } catch {
    return response.badRequest(
      'Request body phải là JSON hợp lệ.',
      'INVALID_JSON_BODY'
    );
  }

  const validation = validateTransactionUpdate(body);
  if (!validation.valid) {
    return response.badRequest(validation.message, validation.code);
  }
  const changes = { ...validation.value };

  try {
    const requestedLineItems = body.lineItems ?? body.line_items;
    if (requestedLineItems !== undefined) {
      if (!Array.isArray(requestedLineItems) || requestedLineItems.length > 200) {
        return response.badRequest(
          'lineItems phải là mảng tối đa 200 món.',
          'INVALID_LINE_ITEMS'
        );
      }
      const currentInvoice = await getInvoiceById(auth.invoiceId, auth.userId);
      if (!currentInvoice) {
        return response.notFound('Không tìm thấy giao dịch.', 'INVOICE_NOT_FOUND');
      }
      const currentLineItems = Array.isArray(currentInvoice.line_items) ? currentInvoice.line_items : [];
      if (requestedLineItems.length !== currentLineItems.length) {
        return response.badRequest(
          'Không được thay đổi số lượng line item khi sửa tên món.',
          'LINE_ITEM_COUNT_MISMATCH'
        );
      }
      const verifiedIndexes = new Set(body.verifiedLineItemIndexes || body.verified_line_item_indexes || []);
      if ([...verifiedIndexes].some((index) => !Number.isInteger(index) || index < 0 || index >= currentLineItems.length)) {
        return response.badRequest(
          'Chỉ số line item cần xác nhận không hợp lệ.',
          'INVALID_LINE_ITEM_INDEX'
        );
      }
      const normalizedNames = requestedLineItems.map((item) => String(
        item?.normalized_item_name ?? item?.normalizedItemName ?? item?.item ?? ''
      ).normalize('NFC').replace(/\s+/g, ' ').trim());
      if (normalizedNames.some((name) => !name || name.length > 255)) {
        return response.badRequest(
          'Tên món phải từ 1 đến 255 ký tự.',
          'INVALID_LINE_ITEM_NAME'
        );
      }
      changes.lineItems = currentLineItems.map((item, index) => {
        const verified = verifiedIndexes.has(index);
        return {
          ...item,
          item: normalizedNames[index],
          normalized_item_name: normalizedNames[index],
          user_verified: verified || Boolean(item.user_verified),
          needs_review: verified ? false : Boolean(item.needs_review),
        };
      });
    }

    if (!Object.keys(changes).length) {
      return response.badRequest(
        'Cần ít nhất một trường hợp lệ để cập nhật.',
        'NO_TRANSACTION_CHANGES'
      );
    }

    const invoice = await updateInvoiceById(auth.invoiceId, auth.userId, changes);
    if (invoice) {
      try { await evaluateBudgetNotifications(auth.userId, invoice.category); }
      catch (notificationError) { logger.warn('Budget notification evaluation failed after invoice update', { invoiceId: auth.invoiceId, error: notificationError.message }); }
    }
    return invoice
      ? response.success({ invoice })
      : response.notFound('Không tìm thấy giao dịch.', 'INVOICE_NOT_FOUND');
  } catch (error) {
    logger.error('Failed to update invoice', error, auth);
    return response.serverError(
      'Không thể cập nhật giao dịch lúc này.',
      'UPDATE_INVOICE_FAILED'
    );
  }
};

export const deleteInvoice = async (event = {}) => {
  const auth = await authenticateInvoiceRequest(event);
  if (auth.error) return auth.error;
  if (!auth.invoiceId) {
    return response.badRequest('Thiếu invoice id.', 'INVOICE_ID_REQUIRED');
  }

  try {
    const deleted = await deleteInvoiceById(auth.invoiceId, auth.userId);
    return deleted
      ? response.success({ deletedId: deleted.id })
      : response.notFound('Không tìm thấy giao dịch.', 'INVOICE_NOT_FOUND');
  } catch (error) {
    logger.error('Failed to delete invoice', error, auth);
    return response.serverError(
      'Không thể xóa giao dịch lúc này.',
      'DELETE_INVOICE_FAILED'
    );
  }
};

