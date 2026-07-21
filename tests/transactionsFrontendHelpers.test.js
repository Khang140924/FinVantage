import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInvoice } from '../frontend/src/utils/invoiceTransform.js';
import {
  buildTransactionsCsv,
  createTransactionIdempotencyKey,
  isValidTransactionDate,
  validateTransactionForm
} from '../frontend/src/utils/transactions.js';

const validForm = {
  storeName: '  Phúc   Long  ',
  totalAmount: '103000',
  category: ' ăn uống ',
  paymentMethod: 'Cash',
  transactionDate: '2026-07-20',
  notes: '  Coffee  '
};

test('transaction form normalization emits a canonical manual payload', () => {
  const result = validateTransactionForm(validForm);
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, {
    storeName: 'Phúc Long',
    totalAmount: 103000,
    category: 'Ăn uống',
    paymentMethod: 'Cash',
    transactionDate: '2026-07-20',
    notes: 'Coffee',
    source: 'MANUAL'
  });
});

test('transaction form rejects noncanonical fields, zero amount, invalid dates, and long notes', () => {
  const result = validateTransactionForm({
    storeName: '   ',
    totalAmount: '0',
    category: 'Unknown',
    paymentMethod: 'Crypto',
    transactionDate: '2026-02-30',
    notes: 'x'.repeat(1001),
    status: 'PENDING'
  }, { editing: true });
  assert.equal(result.valid, false);
  assert.deepEqual(Object.keys(result.errors).sort(), [
    'category',
    'notes',
    'paymentMethod',
    'status',
    'storeName',
    'totalAmount',
    'transactionDate'
  ]);
  assert.equal(isValidTransactionDate('2024-02-29'), true);
  assert.equal(isValidTransactionDate('2025-02-29'), false);
});

test('manual invoice normalization preserves canonical aliases and MANUAL method', () => {
  const invoice = normalizeInvoice({
    id: 'manual-1',
    store_name: 'Clinic',
    total_amount: 500000,
    category: 'Y tế',
    source: 'manual',
    transaction_date: '2026-07-20'
  });
  assert.equal(invoice.category, 'Sức khỏe');
  assert.equal(invoice.method, 'MANUAL');
});

test('CSV export neutralizes spreadsheet formulas and escapes quotes', () => {
  const csv = buildTransactionsCsv([
    ['Store', 'Amount'],
    ['=HYPERLINK("https://bad.test")', 10],
    ['  +SUM(1,1)', 20]
  ]);
  assert.match(csv, /^"Store","Amount"/);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/bad\.test""\)"/);
  assert.match(csv, /"'  \+SUM\(1,1\)"/);
});

test('manual create idempotency keys are nonempty and unique per attempt', () => {
  const first = createTransactionIdempotencyKey();
  const second = createTransactionIdempotencyKey();
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first, second);
});
