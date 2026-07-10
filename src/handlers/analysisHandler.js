import { analyzeInvoiceWithBedrock } from '../services/bedrock.service.js';
import { getInvoiceFromCache, saveParsedInvoice } from '../services/db.service.js';
import * as response from '../utils/response.js';
import { logger } from '../utils/logger.js';

const DEFAULT_USER_ID = 'demo-user';

const parseBody = (event) => {
  if (!event?.body) {
    return {};
  }

  if (typeof event.body === 'object') {
    return event.body;
  }

  const bodyText = String(event.body).trim();
  return bodyText ? JSON.parse(bodyText) : {};
};

const getRawText = (cachedInvoice) => (
  cachedInvoice?.raw_text ||
  cachedInvoice?.rawText ||
  cachedInvoice?.text ||
  ''
);

const getSourceFileKey = (cachedInvoice) => (
  cachedInvoice?.source_file_key ||
  cachedInvoice?.sourceFileKey ||
  cachedInvoice?.fileKey ||
  null
);

export const handler = async (event = {}) => {
  const invoiceId = event.pathParameters?.id;

  if (!invoiceId) {
    logger.warn('Analyze invoice request is missing invoiceId path parameter', {
      pathParameters: event.pathParameters
    });
    return response.badRequest('Thiếu invoiceId trong pathParameters.id.');
  }

  let body;
  try {
    body = parseBody(event);
  } catch (parseError) {
    logger.error('Failed to parse analyze invoice request body JSON', parseError, { invoiceId });
    return response.badRequest('Request body phải là JSON hợp lệ.');
  }

  const cacheKey = body.cacheKey || `ocr:${invoiceId}`;
  const userId = body.userId || DEFAULT_USER_ID;

  try {
    logger.info('Starting invoice analysis flow', { invoiceId, cacheKey, userId });

    const cachedInvoice = await getInvoiceFromCache(cacheKey);
    if (!cachedInvoice) {
      logger.warn('OCR cache not found for invoice analysis', { invoiceId, cacheKey });
      return response.notFound(`Không tìm thấy dữ liệu OCR trong Redis với cacheKey: ${cacheKey}.`);
    }

    const rawText = getRawText(cachedInvoice);
    if (!rawText || !String(rawText).trim()) {
      logger.warn('OCR cache does not contain raw text', { invoiceId, cacheKey });
      return response.badRequest('Dữ liệu OCR không có rawText hợp lệ để phân tích.');
    }

    const sourceFileKey = getSourceFileKey(cachedInvoice);

    logger.info('Sending OCR raw text to Bedrock for invoice analysis', { invoiceId, cacheKey });
    const aiResult = await analyzeInvoiceWithBedrock(rawText);

    logger.info('Saving analyzed invoice to PostgreSQL', { invoiceId, userId });
    const savedInvoice = await saveParsedInvoice({
      invoiceId,
      userId,
      storeName: aiResult.store_name,
      totalAmount: aiResult.total_amount,
      category: aiResult.category,
      aiAdvice: aiResult.ai_advice,
      rawText,
      sourceFileKey,
      status: 'ANALYZED'
    });

    logger.info('Invoice analysis flow completed successfully', {
      invoiceId,
      savedInvoiceId: savedInvoice?.id,
      cacheKey
    });

    return response.success({
      message: 'Phân tích hóa đơn bằng AI và lưu PostgreSQL thành công.',
      invoice: savedInvoice,
      analysis: aiResult
    });
  } catch (error) {
    logger.error('Invoice analysis flow failed', error, { invoiceId, cacheKey, userId });
    return response.serverError(`Không thể phân tích và lưu hóa đơn: ${error.message}`);
  }
};
