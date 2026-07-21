import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_TRANSACTION_AMOUNT,
  isStrictTransactionDate,
  validateIdempotencyKey,
  validateTransactionCreate,
  validateTransactionUpdate
} from '../src/utils/transactionValidation.js';

const validCreate = {
  storeName: '  Phúc   Long  ',
  totalAmount: '103000',
  category: ' Y tế ',
  paymentMethod: 'Cash',
  transactionDate: '2026-07-20',
  notes: '  Cà phê  ',
  source: 'CLIENT_CONTROLLED',
  userId: 'client-user'
};

test('manual transaction create normalizes fields and never trusts source/user ownership', () => {
  const result = validateTransactionCreate(validCreate);
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, {
    storeName: 'Phúc Long',
    totalAmount: 103000,
    category: 'Sức khỏe',
    paymentMethod: 'Cash',
    transactionDate: '2026-07-20',
    notes: 'Cà phê',
    source: 'MANUAL',
    status: 'ANALYZED'
  });
  assert.equal('userId' in result.value, false);
});

test('legacy utility alias is normalized on create and update', () => {
  const created = validateTransactionCreate({
    ...validCreate,
    category: ' HÓA ĐƠN TIỆN ÍCH '
  });
  assert.equal(created.valid, true);
  assert.equal(created.value.category, 'Hóa đơn');

  const updated = validateTransactionUpdate({ category: ' y tế ' });
  assert.equal(updated.valid, true);
  assert.deepEqual(updated.value, { category: 'Sức khỏe' });
});

test('create rejects every required invalid transaction field with a stable code', () => {
  const cases = [
    [{ ...validCreate, storeName: '   ' }, 'INVALID_STORE_NAME'],
    [{ ...validCreate, totalAmount: 0 }, 'INVALID_TRANSACTION_AMOUNT'],
    [{ ...validCreate, totalAmount: MAX_TRANSACTION_AMOUNT + 1 }, 'INVALID_TRANSACTION_AMOUNT'],
    [{ ...validCreate, totalAmount: 1.234 }, 'INVALID_TRANSACTION_AMOUNT'],
    [{ ...validCreate, category: 'Du lịch' }, 'INVALID_TRANSACTION_CATEGORY'],
    [{ ...validCreate, transactionDate: '2026-02-30' }, 'INVALID_TRANSACTION_DATE'],
    [{ ...validCreate, paymentMethod: 'Crypto' }, 'INVALID_PAYMENT_METHOD'],
    [{ ...validCreate, notes: 'x'.repeat(1001) }, 'INVALID_TRANSACTION_NOTES'],
    [{ ...validCreate, status: 'WARNING' }, 'INVALID_TRANSACTION_STATUS']
  ];

  for (const [body, code] of cases) {
    const result = validateTransactionCreate(body);
    assert.equal(result.valid, false);
    assert.equal(result.code, code);
    assert.equal(typeof result.message, 'string');
    assert.ok(result.message.length > 0);
  }
});

test('partial update validates only supplied editable fields', () => {
  assert.deepEqual(validateTransactionUpdate({ notes: '' }), {
    valid: true,
    value: { notes: null }
  });
  assert.deepEqual(validateTransactionUpdate({
    store_name: '  Cửa   hàng  ',
    total_amount: '12.50',
    payment_method: 'E-Wallet',
    transaction_date: '2024-02-29',
    status: 'paid'
  }), {
    valid: true,
    value: {
      storeName: 'Cửa hàng',
      totalAmount: 12.5,
      transactionDate: '2024-02-29',
      paymentMethod: 'E-Wallet',
      status: 'PAID'
    }
  });
});

test('strict dates reject malformed and impossible calendar dates', () => {
  assert.equal(isStrictTransactionDate('2024-02-29'), true);
  assert.equal(isStrictTransactionDate('2025-02-29'), false);
  assert.equal(isStrictTransactionDate('2026-7-20'), false);
  assert.equal(isStrictTransactionDate('not-a-date'), false);
});

test('manual create requires a bounded safe idempotency key', () => {
  assert.equal(validateIdempotencyKey(undefined).code, 'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal(validateIdempotencyKey('contains spaces').code, 'INVALID_IDEMPOTENCY_KEY');
  assert.equal(validateIdempotencyKey('x'.repeat(129)).code, 'INVALID_IDEMPOTENCY_KEY');
  assert.deepEqual(validateIdempotencyKey('manual:2026-07-20_abc-123'), {
    valid: true,
    value: 'manual:2026-07-20_abc-123'
  });
});
