import assert from 'node:assert/strict';
import test from 'node:test';

process.env.USE_MOCK_AUTH = 'true';
process.env.COGNITO_USER_POOL_ID ||= 'ap-southeast-1_TransactionUnitTest';
process.env.COGNITO_CLIENT_ID ||= 'transaction-unit-test-client';

const db = await import('../src/services/db.service.js');
const handlers = await import('../src/handlers/invoiceHandler.js');

const authorization = { Authorization: 'Bearer finvantage-mock-id-token' };
const rowsById = new Map();
const rowsByKey = new Map();
const queryCalls = [];
const originalQuery = db.pgPool.query.bind(db.pgPool);

const responseBody = (result) => JSON.parse(result.body || '{}');
const event = (body, { id, key = 'unit-create-key' } = {}) => ({
  headers: { ...authorization, ...(key === null ? {} : { 'Idempotency-Key': key }) },
  ...(id ? { pathParameters: { id } } : {}),
  ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) })
});

const validBody = {
  storeName: '  Unit   Store  ',
  totalAmount: 123000,
  category: 'Y tế',
  paymentMethod: 'Bank',
  transactionDate: '2026-07-20',
  notes: 'unit fixture',
  source: 'UNTRUSTED',
  userId: 'foreign-client-user'
};

db.pgPool.query = async (query, values = []) => {
  const sql = String(query).replace(/\s+/g, ' ').trim();
  queryCalls.push({ sql, values });

  if (/^INSERT INTO invoices /i.test(sql)) {
    const [userId, storeName, totalAmount, currency, category, aiAdvice, rawText,
      sourceFileKey, lineItems, status, transactionDate, paymentMethod, notes,
      source, idempotencyKey] = values;
    const key = `${userId}:${idempotencyKey}`;
    if (rowsByKey.has(key)) return { rows: [] };
    const row = {
      id: `unit-${rowsById.size + 1}`,
      user_id: userId,
      store_name: storeName,
      total_amount: totalAmount,
      currency,
      category,
      ai_advice: aiAdvice,
      raw_text: rawText,
      source_file_key: sourceFileKey,
      line_items: JSON.parse(lineItems),
      status,
      transaction_date: transactionDate,
      payment_method: paymentMethod,
      notes,
      source,
      idempotency_key: idempotencyKey
    };
    rowsById.set(row.id, row);
    rowsByKey.set(key, row);
    return { rows: [row] };
  }

  if (/SELECT \* FROM invoices WHERE user_id = \$1 AND idempotency_key = \$2/i.test(sql)) {
    return { rows: [rowsByKey.get(`${values[0]}:${values[1]}`)].filter(Boolean) };
  }

  if (/WITH ranked_budgets AS/i.test(sql)) return { rows: [] };

  if (/SELECT \* FROM invoices WHERE id = \$1 AND user_id = \$2/i.test(sql)) {
    const row = rowsById.get(values[0]);
    return { rows: row?.user_id === values[1] ? [row] : [] };
  }

  if (/^UPDATE invoices SET /i.test(sql)) {
    const invoiceId = values.at(-2);
    const userId = values.at(-1);
    const row = rowsById.get(invoiceId);
    return { rows: row?.user_id === userId ? [row] : [] };
  }

  if (/^DELETE FROM invoices WHERE id = \$1 AND user_id = \$2/i.test(sql)) {
    const row = rowsById.get(values[0]);
    if (row?.user_id !== values[1]) return { rows: [] };
    rowsById.delete(values[0]);
    rowsByKey.delete(`${row.user_id}:${row.idempotency_key}`);
    return { rows: [{ id: values[0] }] };
  }

  if (/SELECT \* FROM invoices WHERE user_id = \$1 AND status IN/i.test(sql)) {
    return { rows: [...rowsById.values()].filter((row) => row.user_id === values[0]) };
  }

  throw new Error(`Unexpected SQL in transaction unit test: ${sql}`);
};

await test('invoice CRUD handlers validate, isolate ownership and replay idempotently', async (t) => {
  try {
    await t.test('invalid create returns structured 400 before PostgreSQL', async () => {
      const before = queryCalls.length;
      const result = await handlers.createInvoice(event({ ...validBody, totalAmount: 0 }));
      const body = responseBody(result);
      assert.equal(result.statusCode, 400);
      assert.equal(body.code, 'INVALID_TRANSACTION_AMOUNT');
      assert.equal(typeof body.message, 'string');
      assert.equal(queryCalls.length, before);
    });

    await t.test('missing idempotency key returns structured 400', async () => {
      const result = await handlers.createInvoice(event(validBody, { key: null }));
      const body = responseBody(result);
      assert.equal(result.statusCode, 400);
      assert.equal(body.code, 'IDEMPOTENCY_KEY_REQUIRED');
    });

    let createdId;
    await t.test('create takes user identity from auth and returns the canonical category', async () => {
      const result = await handlers.createInvoice(event(validBody));
      const body = responseBody(result);
      assert.equal(result.statusCode, 201);
      assert.equal(body.idempotentReplay, false);
      assert.equal(body.invoice.user_id, 'mock-user');
      assert.equal(body.invoice.store_name, 'Unit Store');
      assert.equal(body.invoice.category, 'Sức khỏe');
      assert.equal(body.invoice.source, 'MANUAL');
      assert.equal('idempotency_key' in body.invoice, false);
      createdId = body.invoice.id;
    });

    await t.test('same user and key replay returns the same record without another row', async () => {
      const result = await handlers.createInvoice(event({ ...validBody, storeName: 'Ignored retry payload' }));
      const body = responseBody(result);
      assert.equal(result.statusCode, 200);
      assert.equal(body.idempotentReplay, true);
      assert.equal(body.invoice.id, createdId);
      assert.equal(rowsById.size, 1);
    });

    await t.test('another user row is not visible, editable or deletable', async () => {
      const foreign = {
        ...rowsById.get(createdId),
        id: 'foreign-row',
        user_id: 'other-user',
        idempotency_key: 'foreign-key'
      };
      rowsById.set(foreign.id, foreign);
      rowsByKey.set('other-user:foreign-key', foreign);

      const detail = await handlers.getInvoice(event(undefined, { id: foreign.id, key: null }));
      assert.equal(detail.statusCode, 404);

      const update = await handlers.updateInvoice(event({
        storeName: 'Attempted takeover',
        category: 'Hóa đơn',
        totalAmount: 1,
        transactionDate: '2026-07-20',
        paymentMethod: 'Cash',
        notes: ''
      }, { id: foreign.id, key: null }));
      assert.equal(update.statusCode, 404);

      const deletion = await handlers.deleteInvoice(event(undefined, { id: foreign.id, key: null }));
      assert.equal(deletion.statusCode, 404);
      assert.equal(rowsById.has(foreign.id), true);

      const ownershipCalls = queryCalls.filter(({ values }) => values.includes(foreign.id));
      assert.ok(ownershipCalls.length >= 3);
      assert.ok(ownershipCalls.every(({ values }) => values.includes('mock-user')));
    });
  } finally {
    db.pgPool.query = originalQuery;
    await db.pgPool.end();
  }
});
