import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeInvoiceWithBedrock } from '../src/services/bedrock.service.js';
import { sanitizeInvoiceId } from '../src/utils/invoice.js';
import {
  assertValidOcrPayload,
  OCR_VENDOR_WARNING,
  normalizeOcrCachePayload,
  parseVietnameseAmount,
  UNKNOWN_VENDOR_NAME
} from '../src/utils/textractExpense.js';

const field = (type, value, label = type, confidence = 99) => ({
  Type: { Text: type },
  LabelDetection: { Text: label },
  ValueDetection: { Text: value, Confidence: confidence }
});

const lineItem = (name, price) => ({
  LineItemExpenseFields: [field('ITEM', name), field('PRICE', price)]
});

const phucLongExpenseDocuments = [{
  SummaryFields: [
    field('VENDOR_NAME', 'PHUC LONG COFFEE & TEA'),
    field('INVOICE_RECEIPT_DATE', '11/09/2018'),
    field('TOTAL', '103,000', 'TOTAL'),
    field('AMOUNT_PAID', '500,000', 'CASH'),
    field('OTHER', '397,000', 'Change')
  ],
  LineItemGroups: [{
    LineItems: [
      lineItem('Strawberry Juice', '40,000'),
      lineItem('Pineapple Juice', '35.000'),
      lineItem('Choco Coco Brownie', '28000')
    ]
  }],
  Blocks: [
    { BlockType: 'LINE', Text: 'PHUC LONG COFFEE & TEA' },
    { BlockType: 'LINE', Text: 'Strawberry Juice 40,000' },
    { BlockType: 'LINE', Text: 'Pineapple Juice 35,000' },
    { BlockType: 'LINE', Text: 'Choco Coco Brownie 28,000' },
    { BlockType: 'LINE', Text: 'TOTAL: 103,000' },
    { BlockType: 'LINE', Text: 'CASH 500,000' },
    { BlockType: 'LINE', Text: 'Change 397,000' }
  ]
}];

test('Vietnamese amount formats normalize to integer VND', () => {
  assert.equal(parseVietnameseAmount('125.000'), 125000);
  assert.equal(parseVietnameseAmount('125,000'), 125000);
  assert.equal(parseVietnameseAmount('125000'), 125000);
  assert.equal(parseVietnameseAmount('103,000.00'), 103000);
});

test('Phuc Long Textract result uses TOTAL and preserves all real fields', async () => {
  const payload = normalizeOcrCachePayload({
    invoiceId: 'phuc-long-test',
    fileKey: 'uploads/demo/phuc-long_bill.jpg',
    expenseDocuments: phucLongExpenseDocuments
  });

  assert.doesNotThrow(() => assertValidOcrPayload(payload));
  assert.equal(payload.storeName, 'PHUC LONG COFFEE & TEA');
  assert.equal(payload.totalAmount, 103000);
  assert.notEqual(payload.totalAmount, 500000);
  assert.notEqual(payload.totalAmount, 397000);
  assert.equal(payload.transactionDate, '2018-09-11');
  assert.deepEqual(payload.lineItems.map(({ item, price }) => ({ item, price })), [
    { item: 'Strawberry Juice', price: 40000 },
    { item: 'Pineapple Juice', price: 35000 },
    { item: 'Choco Coco Brownie', price: 28000 }
  ]);
  assert.equal(payload.lineItems.reduce((sum, item) => sum + item.price, 0), payload.totalAmount);
  assert.match(payload.rawText, /PHUC LONG/);
  assert.match(payload.rawText, /TOTAL: 103,000/);

  const previousMockSetting = process.env.USE_MOCK_AI;
  process.env.USE_MOCK_AI = 'true';
  try {
    const enrichment = await analyzeInvoiceWithBedrock(payload.rawText);
    assert.deepEqual(Object.keys(enrichment).sort(), ['ai_advice', 'category']);
    assert.equal(enrichment.category, 'Ăn uống');
    assert.equal('store_name' in enrichment, false);
    assert.equal('total_amount' in enrichment, false);
  } finally {
    if (previousMockSetting === undefined) delete process.env.USE_MOCK_AI;
    else process.env.USE_MOCK_AI = previousMockSetting;
  }
});

test('empty Textract documents stop before AI and database save', () => {
  const payload = normalizeOcrCachePayload({
    invoiceId: 'empty-test',
    fileKey: 'uploads/demo/empty.jpg',
    expenseDocuments: []
  });
  assert.throws(() => assertValidOcrPayload(payload), { code: 'OCR_EMPTY_RESULT' });
});

test('missing SummaryFields TOTAL returns OCR_TOTAL_NOT_FOUND even when CASH exists', () => {
  const payload = normalizeOcrCachePayload({
    invoiceId: 'missing-total-test',
    fileKey: 'uploads/demo/missing-total.jpg',
    expenseDocuments: [{
      SummaryFields: [field('VENDOR_NAME', 'PHUC LONG'), field('AMOUNT_PAID', '500,000', 'CASH')],
      Blocks: [{ BlockType: 'LINE', Text: 'PHUC LONG CASH 500,000' }]
    }]
  });
  assert.throws(() => assertValidOcrPayload(payload), { code: 'OCR_TOTAL_NOT_FOUND' });
});

test('missing vendor remains analyzable when TOTAL and raw text are valid', () => {
  const payload = normalizeOcrCachePayload({
    invoiceId: 'missing-vendor-test',
    userId: 'mock-user',
    fileKey: 'uploads/mock-user/missing-vendor.jpg',
    expenseDocuments: [{
      SummaryFields: [
        field('INVOICE_RECEIPT_DATE', '17/07/2026'),
        field('TOTAL', '103.000', 'TOTAL')
      ],
      LineItemGroups: [{ LineItems: [lineItem('Ca phe sua', '103.000')] }],
      Blocks: [
        { BlockType: 'LINE', Text: 'Ca phe sua 103.000' },
        { BlockType: 'LINE', Text: 'TOTAL 103.000' }
      ]
    }]
  });

  assert.doesNotThrow(() => assertValidOcrPayload(payload));
  assert.equal(payload.storeName, UNKNOWN_VENDOR_NAME);
  assert.deepEqual(payload.warning, OCR_VENDOR_WARNING);
  assert.equal(payload.totalAmount, 103000);
  assert.equal(payload.transactionDate, '2026-07-17');
  assert.equal(payload.lineItems.length, 1);
});

test('receipt headings are not accepted as a vendor name', () => {
  for (const vendorName of ['PHIẾU THANH TOÁN', 'TOTAL', 'BILL']) {
    const payload = normalizeOcrCachePayload({
      invoiceId: `invalid-vendor-${vendorName}`,
      fileKey: 'uploads/mock-user/invalid-vendor.jpg',
      expenseDocuments: [{
        SummaryFields: [field('VENDOR_NAME', vendorName), field('TOTAL', '50.000')],
        Blocks: [
          { BlockType: 'LINE', Text: vendorName },
          { BlockType: 'LINE', Text: 'TOTAL 50.000' }
        ]
      }]
    });
    assert.equal(payload.storeName, UNKNOWN_VENDOR_NAME);
    assert.deepEqual(payload.warning, OCR_VENDOR_WARNING);
  }
});

test('same user and checksum produces a stable invoice id for retries', () => {
  const checksum = 'a'.repeat(64);
  const first = sanitizeInvoiceId(`uploads/mock-user/${checksum}_bill.jpg`);
  const second = sanitizeInvoiceId(`uploads/mock-user/${checksum}_renamed.jpg`);
  assert.equal(first, second);
});
