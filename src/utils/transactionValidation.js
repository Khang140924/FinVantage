import {
  PAYMENT_METHOD_VALUES,
  normalizeExpenseCategory
} from '../../shared/expenseCategories.js';

export const MAX_TRANSACTION_AMOUNT = 9_999_999_999.99;
export const EDITABLE_TRANSACTION_STATUSES = Object.freeze(['ANALYZED', 'PAID']);

const PAYMENT_METHOD_SET = new Set(PAYMENT_METHOD_VALUES);
const STATUS_SET = new Set(EDITABLE_TRANSACTION_STATUSES);
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

const failure = (code, message) => ({ valid: false, code, message });
const success = (value) => ({ valid: true, value });

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const firstPresent = (body, camelKey, snakeKey) => (
  hasOwn(body, camelKey) ? body[camelKey] : body[snakeKey]
);

const normalizeRequiredText = (value, { code, label, maxLength }) => {
  if (typeof value !== 'string') return failure(code, `${label} phải là chuỗi.`);
  const normalized = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!normalized) return failure(code, `${label} không được để trống.`);
  if (normalized.length > maxLength) {
    return failure(code, `${label} tối đa ${maxLength} ký tự.`);
  }
  return success(normalized);
};

const normalizeAmount = (value) => {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    return failure('INVALID_TRANSACTION_AMOUNT', 'Số tiền là bắt buộc.');
  }
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_TRANSACTION_AMOUNT) {
    return failure(
      'INVALID_TRANSACTION_AMOUNT',
      `Số tiền phải lớn hơn 0 và không vượt quá ${MAX_TRANSACTION_AMOUNT}.`
    );
  }
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) {
    return failure('INVALID_TRANSACTION_AMOUNT', 'Số tiền chỉ được có tối đa 2 chữ số thập phân.');
  }
  return success(amount);
};

export const isStrictTransactionDate = (value) => {
  if (typeof value !== 'string') return false;
  const match = value.match(DATE_PATTERN);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
};

const normalizeDate = (value) => isStrictTransactionDate(value)
  ? success(value)
  : failure('INVALID_TRANSACTION_DATE', 'Ngày giao dịch phải là ngày hợp lệ theo định dạng YYYY-MM-DD.');

const normalizeCategory = (value) => {
  const category = normalizeExpenseCategory(value);
  return category
    ? success(category)
    : failure('INVALID_TRANSACTION_CATEGORY', 'Danh mục giao dịch không hợp lệ.');
};

const normalizePaymentMethod = (value) => {
  const paymentMethod = typeof value === 'string' ? value.trim() : '';
  return PAYMENT_METHOD_SET.has(paymentMethod)
    ? success(paymentMethod)
    : failure('INVALID_PAYMENT_METHOD', 'Phương thức thanh toán không hợp lệ.');
};

const normalizeStatus = (value) => {
  const status = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return STATUS_SET.has(status)
    ? success(status)
    : failure('INVALID_TRANSACTION_STATUS', 'Trạng thái giao dịch chỉ có thể là ANALYZED hoặc PAID.');
};

const normalizeNotes = (value) => {
  if (value === null || value === undefined || value === '') return success(null);
  if (typeof value !== 'string') return failure('INVALID_TRANSACTION_NOTES', 'Ghi chú phải là chuỗi.');
  const notes = value.normalize('NFC').trim();
  return notes.length <= 1000
    ? success(notes || null)
    : failure('INVALID_TRANSACTION_NOTES', 'Ghi chú tối đa 1000 ký tự.');
};

const ensureBodyObject = (body) => (
  body && typeof body === 'object' && !Array.isArray(body)
    ? null
    : failure('INVALID_JSON_BODY', 'Request body phải là một JSON object hợp lệ.')
);

export const validateTransactionCreate = (body) => {
  const bodyError = ensureBodyObject(body);
  if (bodyError) return bodyError;

  const storeName = normalizeRequiredText(firstPresent(body, 'storeName', 'store_name'), {
    code: 'INVALID_STORE_NAME', label: 'Tên cửa hàng', maxLength: 255
  });
  if (!storeName.valid) return storeName;
  const totalAmount = normalizeAmount(firstPresent(body, 'totalAmount', 'total_amount'));
  if (!totalAmount.valid) return totalAmount;
  const category = normalizeCategory(body.category);
  if (!category.valid) return category;
  const transactionDate = normalizeDate(firstPresent(body, 'transactionDate', 'transaction_date'));
  if (!transactionDate.valid) return transactionDate;
  const paymentMethod = normalizePaymentMethod(firstPresent(body, 'paymentMethod', 'payment_method'));
  if (!paymentMethod.valid) return paymentMethod;
  const notes = normalizeNotes(body.notes);
  if (!notes.valid) return notes;
  const status = normalizeStatus(body.status ?? 'ANALYZED');
  if (!status.valid) return status;

  return success({
    storeName: storeName.value,
    totalAmount: totalAmount.value,
    category: category.value,
    paymentMethod: paymentMethod.value,
    transactionDate: transactionDate.value,
    notes: notes.value,
    source: 'MANUAL',
    status: status.value
  });
};

export const validateTransactionUpdate = (body) => {
  const bodyError = ensureBodyObject(body);
  if (bodyError) return bodyError;
  const value = {};

  if (hasOwn(body, 'storeName') || hasOwn(body, 'store_name')) {
    const result = normalizeRequiredText(firstPresent(body, 'storeName', 'store_name'), {
      code: 'INVALID_STORE_NAME', label: 'Tên cửa hàng', maxLength: 255
    });
    if (!result.valid) return result;
    value.storeName = result.value;
  }
  if (hasOwn(body, 'totalAmount') || hasOwn(body, 'total_amount')) {
    const result = normalizeAmount(firstPresent(body, 'totalAmount', 'total_amount'));
    if (!result.valid) return result;
    value.totalAmount = result.value;
  }
  if (hasOwn(body, 'category')) {
    const result = normalizeCategory(body.category);
    if (!result.valid) return result;
    value.category = result.value;
  }
  if (hasOwn(body, 'transactionDate') || hasOwn(body, 'transaction_date')) {
    const result = normalizeDate(firstPresent(body, 'transactionDate', 'transaction_date'));
    if (!result.valid) return result;
    value.transactionDate = result.value;
  }
  if (hasOwn(body, 'paymentMethod') || hasOwn(body, 'payment_method')) {
    const result = normalizePaymentMethod(firstPresent(body, 'paymentMethod', 'payment_method'));
    if (!result.valid) return result;
    value.paymentMethod = result.value;
  }
  if (hasOwn(body, 'notes')) {
    const result = normalizeNotes(body.notes);
    if (!result.valid) return result;
    value.notes = result.value;
  }
  if (hasOwn(body, 'status')) {
    const result = normalizeStatus(body.status);
    if (!result.valid) return result;
    value.status = result.value;
  }
  if (hasOwn(body, 'aiAdvice') || hasOwn(body, 'ai_advice')) {
    const result = normalizeRequiredText(firstPresent(body, 'aiAdvice', 'ai_advice'), {
      code: 'INVALID_AI_ADVICE', label: 'Gợi ý tài chính', maxLength: 10_000
    });
    if (!result.valid) return result;
    value.aiAdvice = result.value;
  }

  return success(value);
};

export const validateIdempotencyKey = (value) => {
  if (value === null || value === undefined || value === '') {
    return failure('IDEMPOTENCY_KEY_REQUIRED', 'Thiếu Idempotency-Key cho yêu cầu tạo giao dịch.');
  }
  if (typeof value !== 'string') {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key phải là chuỗi.');
  }
  const key = value.trim();
  if (!key || key.length > 128 || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return failure(
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key phải dài 1-128 ký tự và chỉ gồm chữ, số, dấu chấm, gạch ngang, gạch dưới hoặc dấu hai chấm.'
    );
  }
  return success(key);
};
