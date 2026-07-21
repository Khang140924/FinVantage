import { analyzeInvoiceWithBedrock } from '../services/bedrock.service.js';
import {
  cacheInvoiceData,
  createNotification,
  evaluateBudgetNotifications,
  getBudgetAlertNotification,
  getInvoiceById,
  getInvoiceFromCache,
  getOrCreateUserProfile,
  saveParsedInvoice
} from '../services/db.service.js';
import { publishBudgetAlert } from '../services/notification.service.js';
import * as response from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { assertValidOcrPayload, OcrResultError } from '../utils/textractExpense.js';
import { requireAuth } from '../utils/cognitoAuth.js';
import { classifyAwsError, sanitizedAwsLogError } from '../utils/awsError.js';

const parseBody = (event) => {
  if (!event?.body) return {};
  if (typeof event.body === 'object') return event.body;
  const bodyText = String(event.body).trim();
  return bodyText ? JSON.parse(bodyText) : {};
};

const getRawText = (cachedInvoice) => (
  cachedInvoice?.raw_text || cachedInvoice?.rawText || cachedInvoice?.text || ''
);

const getSourceFileKey = (cachedInvoice) => (
  cachedInvoice?.source_file_key || cachedInvoice?.sourceFileKey || cachedInvoice?.fileKey || null
);

const progressForStatus = (status) => ({
  UPLOADED: 25,
  OCR_PROCESSING: 50,
  OCR_FAILED: 50,
  ANALYZING: 75,
  ANALYZED: 100,
  ANALYSIS_FAILED: 75
}[status] ?? 0);

const withStatus = (cachedInvoice, status, extra = {}) => ({
  ...cachedInvoice,
  status,
  progress: progressForStatus(status),
  updatedAt: new Date().toISOString(),
  ...extra
});

export const handler = async (event = {}) => {
  const invoiceId = event.pathParameters?.id;
  if (!invoiceId) return response.badRequest('Thiếu invoiceId trong pathParameters.id.');

  const auth = await requireAuth(event);
  if (auth.error) return auth.error;
  const userId = auth.user.sub;
  let cacheKey = `ocr:${invoiceId}`;
  let cachedInvoice = null;

  const notifyFailure = async (message, code = 'ANALYSIS_FAILED') => {
    try {
      await createNotification({
        userId,
        type: 'INVOICE_FAILED',
        title: 'Xử lý hóa đơn thất bại',
        message,
        referenceId: invoiceId,
        dedupeKey: `invoice:${invoiceId}:failed:analysis:${code}`
      });
    } catch (notificationError) {
      logger.warn('Could not persist invoice failure notification', {
        invoiceId,
        error: notificationError.message
      });
    }
  };

  const cacheProcessingStatus = async (status, extra = {}) => {
    if (!cachedInvoice) return;
    cachedInvoice = withStatus(cachedInvoice, status, extra);
    await cacheInvoiceData(cacheKey, cachedInvoice, 3600);
  };

  let body;
  try {
    body = parseBody(event);
    cacheKey = body.cacheKey || cacheKey;
  } catch (parseError) {
    logger.error('Failed to parse analysis request JSON', parseError, { invoiceId });
    await notifyFailure('Request phân tích không phải JSON hợp lệ.', 'INVALID_ANALYSIS_REQUEST');
    return response.badRequest('Request body phải là JSON hợp lệ.');
  }

  try {
    logger.info('Starting invoice analysis', { invoiceId, cacheKey, userId });
    cachedInvoice = await getInvoiceFromCache(cacheKey);
    if (!cachedInvoice) {
      const existingInvoice = await getInvoiceById(invoiceId, userId);
      if (existingInvoice?.status === 'ANALYZED' || existingInvoice?.status === 'PAID') {
        return response.success({
          message: 'Hóa đơn đã được phân tích trước đó.',
          invoice: existingInvoice,
          status: 'ANALYZED',
          progress: 100,
          existing: true
        });
      }
      const message = `Không tìm thấy dữ liệu OCR trong Redis với cacheKey: ${cacheKey}.`;
      await notifyFailure(message, 'OCR_CACHE_NOT_FOUND');
      return response.sendResponse(404, {
        error: 'OCR cache not found',
        code: 'OCR_CACHE_NOT_FOUND',
        message,
        invoiceId,
        status: 'ANALYSIS_FAILED'
      });
    }

    const safeUserId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
    const cacheOwnedByUser = cachedInvoice.userId
      ? String(cachedInvoice.userId) === String(userId)
      : String(invoiceId).startsWith(`invoice-${safeUserId}-`);
    if (!cacheOwnedByUser || String(cachedInvoice.invoiceId || invoiceId) !== String(invoiceId)) {
      return response.sendResponse(403, {
        error: 'Invoice ownership mismatch',
        code: 'INVOICE_OWNERSHIP_MISMATCH',
        message: 'Người dùng chỉ có thể phân tích hóa đơn của chính mình.'
      });
    }

    if (cachedInvoice.status === 'OCR_FAILED') {
      const code = cachedInvoice.errorCode || 'OCR_PROCESSING_FAILED';
      const message = cachedInvoice.errorMessage || 'OCR đã thất bại nên không thể chạy phân tích AI.';
      await notifyFailure(message, code);
      return response.sendResponse(422, {
        error: 'OCR failed',
        code,
        message,
        invoiceId,
        status: 'OCR_FAILED'
      });
    }

    try {
      assertValidOcrPayload({
        ...cachedInvoice,
        rawText: getRawText(cachedInvoice),
        totalAmount: cachedInvoice.totalAmount ?? cachedInvoice.total_amount,
        storeName: cachedInvoice.storeName ?? cachedInvoice.store_name
      });
    } catch (ocrError) {
      const code = ocrError instanceof OcrResultError ? ocrError.code : 'OCR_EMPTY_RESULT';
      await cacheProcessingStatus('OCR_FAILED', { errorCode: code, errorMessage: ocrError.message });
      await notifyFailure(ocrError.message, code);
      return response.sendResponse(422, {
        error: 'OCR validation failed',
        code,
        message: ocrError.message,
        invoiceId,
        status: 'OCR_FAILED'
      });
    }

    const rawText = getRawText(cachedInvoice);
    const sourceFileKey = getSourceFileKey(cachedInvoice);
    await cacheProcessingStatus('ANALYZING');
    logger.info('Sending real Textract raw_text to AI enrichment', {
      invoiceId,
      fileKey: sourceFileKey,
      rawTextLength: rawText.length,
      status: 'ANALYZING'
    });

    const aiEnrichment = await analyzeInvoiceWithBedrock(rawText, {
      totalAmount: cachedInvoice.totalAmount ?? cachedInvoice.total_amount,
      storeName: cachedInvoice.storeName ?? cachedInvoice.store_name,
      transactionDate: cachedInvoice.transactionDate ?? cachedInvoice.transaction_date,
      lineItems: cachedInvoice.lineItems ?? cachedInvoice.line_items ?? []
    });
    const analysis = {
      store_name: cachedInvoice.storeName ?? cachedInvoice.store_name ?? 'Không xác định',
      total_amount: cachedInvoice.totalAmount ?? cachedInvoice.total_amount,
      transaction_date: cachedInvoice.transactionDate ?? cachedInvoice.transaction_date ?? null,
      line_items: cachedInvoice.lineItems ?? cachedInvoice.line_items ?? [],
      confidence: cachedInvoice.confidence ?? null,
      category: aiEnrichment.category,
      ai_advice: aiEnrichment.ai_advice,
      warning: cachedInvoice.warning || null
    };

    logger.info('Saving successful analyzed invoice to PostgreSQL', {
      invoiceId,
      fileKey: sourceFileKey,
      userId,
      status: 'ANALYZED'
    });
    const savedInvoice = await saveParsedInvoice({
      invoiceId,
      userId,
      storeName: analysis.store_name,
      totalAmount: analysis.total_amount,
      transactionDate: analysis.transaction_date,
      lineItems: analysis.line_items,
      category: analysis.category,
      aiAdvice: analysis.ai_advice,
      rawText,
      sourceFileKey,
      status: 'ANALYZED'
    });
    await cacheProcessingStatus('ANALYZED', { savedInvoiceId: savedInvoice.id });

    // Web/SNS notifications are best-effort after the core pipeline is saved.
    try {
      await createNotification({
        userId,
        type: 'INVOICE_ANALYZED',
        title: 'Hóa đơn đã phân tích thành công',
        message: `${savedInvoice.store_name} đã được lưu với số tiền ${Number(savedInvoice.total_amount).toLocaleString('vi-VN')} ₫.`,
        referenceId: savedInvoice.id,
        dedupeKey: `invoice:${savedInvoice.id}:analyzed`
      });
      await getOrCreateUserProfile(auth.user);
      const evaluation = await evaluateBudgetNotifications(userId, savedInvoice.category);
      if (evaluation.createdNotifications.length) {
        const alert = await getBudgetAlertNotification(userId, savedInvoice.category);
        await publishBudgetAlert(userId, alert);
      }
    } catch (notificationError) {
      logger.warn('Post-analysis notification was skipped or failed', {
        invoiceId,
        fileKey: sourceFileKey,
        error: notificationError.message
      });
    }

    logger.info('Invoice analysis completed', {
      invoiceId,
      fileKey: sourceFileKey,
      savedInvoiceId: savedInvoice.id,
      status: 'ANALYZED'
    });
    return response.success({
      message: 'Phân tích hóa đơn và lưu PostgreSQL thành công.',
      invoice: savedInvoice,
      analysis,
      status: 'ANALYZED',
      progress: 100,
      warning: cachedInvoice.warning || null
    });
  } catch (error) {
    const sourceFileKey = getSourceFileKey(cachedInvoice);
    const awsFailure = classifyAwsError(error);
    const failureCode = awsFailure?.code || 'ANALYSIS_FAILED';
    const failureMessage = awsFailure?.message || 'Không thể phân tích và lưu hóa đơn.';
    try {
      await cacheProcessingStatus('ANALYSIS_FAILED', {
        errorCode: failureCode,
        errorMessage: failureMessage
      });
    } catch (cacheError) {
      logger.warn('Could not cache ANALYSIS_FAILED status', {
        invoiceId,
        fileKey: sourceFileKey,
        error: cacheError.message
      });
    }
    logger.error('Invoice analysis failed', sanitizedAwsLogError(error, awsFailure), {
      invoiceId,
      fileKey: sourceFileKey,
      userId,
      status: 'ANALYSIS_FAILED'
    });
    await notifyFailure(failureMessage, failureCode);
    return response.sendResponse(awsFailure?.statusCode || 500, {
      error: awsFailure?.error || 'Invoice analysis failed',
      code: failureCode,
      message: failureMessage,
      invoiceId,
      status: 'ANALYSIS_FAILED',
      retryable: awsFailure?.retryable ?? false
    });
  }
};
