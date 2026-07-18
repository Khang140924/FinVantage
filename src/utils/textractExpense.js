import { normalizeLineItemName } from './itemNormalization.js';

const normalizeText = (value) => (
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
);

const normalizeFieldType = (field) => normalizeText(field?.Type?.Text).toUpperCase();

const getFieldValue = (field) => normalizeText(field?.ValueDetection?.Text);

const addText = (parts, value) => {
  const text = normalizeText(value);
  if (text) parts.push(text);
};

const addExpenseFieldText = (parts, field) => {
  const label = normalizeText(field?.LabelDetection?.Text || field?.Type?.Text);
  const value = getFieldValue(field);

  if (label && value) {
    addText(parts, `${label}: ${value}`);
    return;
  }

  addText(parts, label);
  addText(parts, value);
};

export class OcrResultError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OcrResultError';
    this.code = code;
  }
}

export const UNKNOWN_VENDOR_NAME = 'Không xác định';
export const OCR_VENDOR_WARNING = Object.freeze({
  code: 'OCR_VENDOR_NOT_FOUND',
  message: 'Không xác định được tên cửa hàng. Bạn có thể chỉnh sửa sau.'
});

const INVALID_VENDOR_NAMES = new Set(['PHIEU THANH TOAN', 'TOTAL', 'BILL']);

export const isValidVendorName = (value) => {
  const key = normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toUpperCase();
  return Boolean(key) && !INVALID_VENDOR_NAMES.has(key);
};

// Vietnamese receipts commonly use either a dot or comma as a thousands
// separator. This parser also accepts plain digits and decimal-formatted values.
export const parseVietnameseAmount = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  const compact = normalizeText(value).replace(/\s+/g, '');
  if (!compact || /^-/.test(compact)) return null;

  const numeric = compact.replace(/[^0-9.,]/g, '');
  if (!numeric || !/\d/.test(numeric)) return null;

  const separators = numeric.match(/[.,]/g) || [];
  if (!separators.length) {
    const parsed = Number(numeric);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const lastSeparatorIndex = Math.max(numeric.lastIndexOf('.'), numeric.lastIndexOf(','));
  const fractionLength = numeric.length - lastSeparatorIndex - 1;
  const hasBothSeparators = numeric.includes('.') && numeric.includes(',');

  let normalized;
  if (hasBothSeparators && fractionLength > 0 && fractionLength <= 2) {
    const integerPart = numeric.slice(0, lastSeparatorIndex).replace(/[.,]/g, '');
    const fractionPart = numeric.slice(lastSeparatorIndex + 1).replace(/[.,]/g, '');
    normalized = `${integerPart}.${fractionPart}`;
  } else if (!hasBothSeparators && separators.length === 1 && fractionLength > 0 && fractionLength <= 2) {
    normalized = `${numeric.slice(0, lastSeparatorIndex)}.${numeric.slice(lastSeparatorIndex + 1)}`;
  } else {
    normalized = numeric.replace(/[.,]/g, '');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const toIsoDate = (year, month, day) => {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) return null;

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

export const normalizeInvoiceDate = (value) => {
  const text = normalizeText(value);
  if (!text) return null;

  let match = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
  if (match) return toIsoDate(Number(match[3]), Number(match[2]), Number(match[1]));

  match = text.match(/\b(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})\b/);
  if (match) return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  return null;
};

const getExpenseDocuments = (expenseDocuments) => (
  Array.isArray(expenseDocuments) ? expenseDocuments : []
);

const findSummaryField = (documents, type) => {
  for (const document of documents) {
    const field = (document?.SummaryFields || []).find((candidate) => normalizeFieldType(candidate) === type);
    if (field && getFieldValue(field)) return field;
  }
  return null;
};

export const extractRawTextFromExpenseDocuments = (expenseDocuments = []) => {
  const parts = [];
  const documents = getExpenseDocuments(expenseDocuments);

  for (const document of documents) {
    for (const block of document?.Blocks || []) {
      if (block?.BlockType === 'LINE') addText(parts, block.Text);
    }

    for (const field of document?.SummaryFields || []) {
      addExpenseFieldText(parts, field);
    }

    for (const group of document?.LineItemGroups || []) {
      for (const lineItem of group?.LineItems || []) {
        for (const field of lineItem?.LineItemExpenseFields || []) {
          addExpenseFieldText(parts, field);
        }
      }
    }
  }

  return [...new Set(parts)].join('\n');
};

export const extractStructuredExpenseData = (expenseDocuments = []) => {
  const documents = getExpenseDocuments(expenseDocuments);
  const vendorField = findSummaryField(documents, 'VENDOR_NAME');
  const totalField = findSummaryField(documents, 'TOTAL');
  const dateField = findSummaryField(documents, 'INVOICE_RECEIPT_DATE');
  const lineItems = [];

  for (const document of documents) {
    for (const group of document?.LineItemGroups || []) {
      for (const lineItem of group?.LineItems || []) {
        const fields = lineItem?.LineItemExpenseFields || [];
        const itemField = fields.find((field) => normalizeFieldType(field) === 'ITEM');
        const quantityField = fields.find((field) => normalizeFieldType(field) === 'QUANTITY');
        const unitPriceField = fields.find((field) => normalizeFieldType(field) === 'UNIT_PRICE');
        const totalPriceField = fields.find((field) => ['PRICE', 'TOTAL_PRICE'].includes(normalizeFieldType(field)));
        const rawItemName = getFieldValue(itemField);
        const normalizedName = normalizeLineItemName(rawItemName);
        const quantityText = getFieldValue(quantityField);
        const unitPriceText = getFieldValue(unitPriceField);
        const totalPriceText = getFieldValue(totalPriceField);
        const quantity = parseVietnameseAmount(quantityText);
        const unitPrice = parseVietnameseAmount(unitPriceText);
        const totalPrice = parseVietnameseAmount(totalPriceText);
        const confidenceValue = Number(itemField?.ValueDetection?.Confidence);
        const confidence = Number.isFinite(confidenceValue) ? confidenceValue : null;
        const needsReview = normalizedName.needsReview || (confidence !== null && confidence < 80);

        if (rawItemName || totalPrice !== null) {
          lineItems.push({
            // Backward-compatible aliases used by the current frontend/tests.
            item: normalizedName.normalizedItemName || rawItemName || null,
            price: totalPrice,
            price_text: totalPriceText || null,
            raw_item_name: normalizedName.rawItemName,
            normalized_item_name: normalizedName.normalizedItemName,
            quantity,
            quantity_text: quantityText || null,
            unit_price: unitPrice,
            unit_price_text: unitPriceText || null,
            total_price: totalPrice,
            total_price_text: totalPriceText || null,
            confidence,
            normalization_changed: normalizedName.changed,
            normalization_confidence: normalizedName.normalizationConfidence,
            normalization_rule: normalizedName.normalizationRule,
            needs_review: needsReview,
          });
        }
      }
    }
  }

  const detectedStoreName = getFieldValue(vendorField);
  const storeName = isValidVendorName(detectedStoreName) ? detectedStoreName : null;
  const totalAmount = parseVietnameseAmount(getFieldValue(totalField));
  const transactionDate = normalizeInvoiceDate(getFieldValue(dateField));
  const confidences = [vendorField, totalField, dateField]
    .map((field) => Number(field?.ValueDetection?.Confidence))
    .filter(Number.isFinite);

  return {
    storeName,
    store_name: storeName,
    totalAmount,
    total_amount: totalAmount,
    transactionDate,
    transaction_date: transactionDate,
    lineItems,
    line_items: lineItems,
    confidence: confidences.length ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(1)) : null
  };
};

export const assertValidOcrPayload = (payload = {}) => {
  if (!Array.isArray(payload.expenseDocuments) || payload.expenseDocuments.length === 0) {
    throw new OcrResultError('OCR_EMPTY_RESULT', 'Textract không trả về ExpenseDocuments cho hóa đơn này.');
  }

  if (!normalizeText(payload.rawText || payload.raw_text)) {
    throw new OcrResultError('OCR_EMPTY_RESULT', 'Textract không trích xuất được nội dung chữ từ hóa đơn.');
  }

  if (!Number.isFinite(payload.totalAmount) || payload.totalAmount <= 0) {
    throw new OcrResultError('OCR_TOTAL_NOT_FOUND', 'Textract không tìm thấy trường TOTAL hợp lệ trong SummaryFields.');
  }

  return payload;
};

export const normalizeOcrCachePayload = ({
  invoiceId,
  fileKey,
  userId = null,
  expenseDocuments = [],
  status = 'OCR_PROCESSING',
  createdAt = new Date().toISOString()
}) => {
  const rawText = extractRawTextFromExpenseDocuments(expenseDocuments);
  const structured = extractStructuredExpenseData(expenseDocuments);
  const warning = structured.storeName ? null : { ...OCR_VENDOR_WARNING };
  const storeName = structured.storeName || UNKNOWN_VENDOR_NAME;

  return {
    invoiceId,
    userId,
    rawText,
    raw_text: rawText,
    sourceFileKey: fileKey,
    source_file_key: fileKey,
    expenseDocuments,
    ...structured,
    storeName,
    store_name: storeName,
    warning,
    status,
    progress: 50,
    uploadConfirmed: true,
    createdAt,
    updatedAt: new Date().toISOString()
  };
};
