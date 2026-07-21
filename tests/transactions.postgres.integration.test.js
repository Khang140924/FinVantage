import assert from 'node:assert/strict';
import test from 'node:test';

const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1']);
if (process.env.ALLOW_LOCAL_DB_TESTS !== 'true') {
  throw new Error('Set ALLOW_LOCAL_DB_TESTS=true to run the local transaction integration test.');
}
if (!allowedHosts.has(String(process.env.DB_HOST || ''))) {
  throw new Error('Transaction integration test only permits a loopback PostgreSQL host.');
}
if (String(process.env.DB_PORT || '') !== '5433') {
  throw new Error('Transaction integration test only permits the FinVantage Docker host port 5433.');
}
if (String(process.env.DB_NAME || '') !== 'finvantage' || process.env.DB_SSL === 'true') {
  throw new Error('Transaction integration test requires the local non-TLS finvantage database.');
}

process.env.USE_MOCK_AUTH = 'true';
process.env.USE_MOCK_AI = 'true';
process.env.SNS_BUDGET_ALERTS_TOPIC_ARN = '';
process.env.COGNITO_USER_POOL_ID ||= 'ap-southeast-1_TransactionIntegration';
process.env.COGNITO_CLIENT_ID ||= 'transaction-integration-client';

const [db, handlers] = await Promise.all([
  import('../src/services/db.service.js'),
  import('../src/handlers/invoiceHandler.js')
]);

const prefix = 'codex-tx-it-20260720';
const handlerUser = 'mock-user';
const ownerA = `${prefix}-owner-a`;
const ownerB = `${prefix}-owner-b`;
const foreignInvoiceId = `${prefix}-foreign`;
const legacyHealthId = `${prefix}-legacy-health`;
const canonicalHealthId = `${prefix}-canonical-health`;
const legacyUtilityId = `${prefix}-legacy-utility`;
const canonicalUtilityId = `${prefix}-canonical-utility`;
const handlerKey = `${prefix}-handler-key`;
const sharedKey = `${prefix}-shared-key`;
const authorization = 'Bearer finvantage-mock-id-token';

const parse = (result) => ({
  statusCode: result.statusCode,
  body: JSON.parse(result.body || '{}'),
  headers: result.headers || {}
});

const request = (method, { id, body, key } = {}) => ({
  httpMethod: method,
  headers: {
    Authorization: authorization,
    ...(key ? { 'Idempotency-Key': key } : {})
  },
  ...(id ? { pathParameters: { id } } : {}),
  ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) })
});

const manualPayload = {
  storeName: '  Codex   Local CRUD  ',
  totalAmount: 1,
  category: 'Hóa đơn tiện ích',
  paymentMethod: 'Cash',
  transactionDate: '2026-07-20',
  notes: `${prefix}-handler`
};

const cleanup = async () => {
  await db.pgPool.query(
    'DELETE FROM invoices WHERE id LIKE $1 OR idempotency_key LIKE $1 OR user_id IN ($2, $3)',
    [`${prefix}%`, ownerA, ownerB]
  );
  await db.pgPool.query('DELETE FROM budgets WHERE user_id IN ($1, $2)', [ownerA, ownerB]);
};

await test('manual transaction PostgreSQL integration', async (t) => {
  try {
    await cleanup();

    await t.test('migration columns and per-user idempotency index exist', async () => {
      const columns = await db.pgPool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'invoices'
          AND column_name = ANY($1::text[])
      `, [['payment_method', 'notes', 'source', 'idempotency_key']]);
      assert.deepEqual(
        new Set(columns.rows.map((row) => row.column_name)),
        new Set(['payment_method', 'notes', 'source', 'idempotency_key'])
      );
      const index = await db.pgPool.query(`
        SELECT indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_invoices_user_idempotency_key'
      `);
      assert.equal(index.rows.length, 1);
      assert.match(index.rows[0].indexdef, /user_id, idempotency_key/i);
      assert.match(index.rows[0].indexdef, /WHERE \(idempotency_key IS NOT NULL\)/i);
    });

    let handlerInvoiceId;
    await t.test('POST is idempotent, canonical and owned by the authenticated user', async () => {
      const first = parse(await handlers.createInvoice(request('POST', {
        body: { ...manualPayload, userId: ownerB, source: 'CLIENT' },
        key: handlerKey
      })));
      assert.equal(first.statusCode, 201);
      assert.match(first.headers['Content-Type'] || first.headers['content-type'], /application\/json/i);
      assert.equal(first.body.invoice.user_id, handlerUser);
      assert.equal(first.body.invoice.store_name, 'Codex Local CRUD');
      assert.equal(first.body.invoice.category, 'Hóa đơn');
      assert.equal(first.body.invoice.payment_method, 'Cash');
      assert.equal(first.body.invoice.notes, `${prefix}-handler`);
      assert.equal(first.body.invoice.source, 'MANUAL');
      assert.equal(first.body.idempotentReplay, false);
      handlerInvoiceId = first.body.invoice.id;

      const replay = parse(await handlers.createInvoice(request('POST', {
        body: { ...manualPayload, storeName: 'Retry body must not duplicate' },
        key: handlerKey
      })));
      assert.equal(replay.statusCode, 200);
      assert.equal(replay.body.idempotentReplay, true);
      assert.equal(replay.body.invoice.id, handlerInvoiceId);
      const count = await db.pgPool.query(
        'SELECT COUNT(*)::int AS count FROM invoices WHERE user_id = $1 AND idempotency_key = $2',
        [handlerUser, handlerKey]
      );
      assert.equal(count.rows[0].count, 1);
    });

    await t.test('GET list/detail and UPDATE use the authenticated owner and refresh persisted fields', async () => {
      const list = parse(await handlers.listInvoices(request('GET')));
      assert.equal(list.statusCode, 200);
      assert.ok(list.body.invoices.some((invoice) => invoice.id === handlerInvoiceId));

      const detail = parse(await handlers.getInvoice(request('GET', { id: handlerInvoiceId })));
      assert.equal(detail.statusCode, 200);
      assert.equal(detail.body.invoice.id, handlerInvoiceId);

      const updated = parse(await handlers.updateInvoice(request('PUT', {
        id: handlerInvoiceId,
        body: {
          storeName: '  Codex Updated  ',
          totalAmount: 2,
          category: 'Y tế',
          paymentMethod: 'E-Wallet',
          transactionDate: '2026-07-21',
          notes: `${prefix}-updated`,
          status: 'PAID',
          userId: ownerB
        }
      })));
      assert.equal(updated.statusCode, 200);
      assert.equal(updated.body.invoice.user_id, handlerUser);
      assert.equal(updated.body.invoice.store_name, 'Codex Updated');
      assert.equal(updated.body.invoice.category, 'Sức khỏe');
      assert.equal(updated.body.invoice.payment_method, 'E-Wallet');
      assert.equal(updated.body.invoice.notes, `${prefix}-updated`);
      assert.equal(updated.body.invoice.status, 'PAID');
    });

    await t.test('foreign invoice cannot be viewed, updated or deleted', async () => {
      await db.pgPool.query(`
        INSERT INTO invoices (
          id, user_id, store_name, total_amount, currency, category, status,
          transaction_date, payment_method, notes, source
        ) VALUES ($1, $2, 'Foreign fixture', 10, 'VND', 'Ăn uống', 'ANALYZED',
          '2026-07-20', 'Cash', $3, 'MANUAL')
      `, [foreignInvoiceId, ownerB, `${prefix}-foreign`]);

      const detail = parse(await handlers.getInvoice(request('GET', { id: foreignInvoiceId })));
      assert.equal(detail.statusCode, 404);
      const update = parse(await handlers.updateInvoice(request('PUT', {
        id: foreignInvoiceId,
        body: { storeName: 'Forbidden' }
      })));
      assert.equal(update.statusCode, 404);
      const deletion = parse(await handlers.deleteInvoice(request('DELETE', { id: foreignInvoiceId })));
      assert.equal(deletion.statusCode, 404);

      const stillPresent = await db.pgPool.query('SELECT user_id FROM invoices WHERE id = $1', [foreignInvoiceId]);
      assert.equal(stillPresent.rows[0]?.user_id, ownerB);
    });

    await t.test('same idempotency key is independent across users', async () => {
      const base = {
        storeName: 'Per-user idempotency',
        totalAmount: 100,
        category: 'Mua sắm',
        paymentMethod: 'Bank',
        transactionDate: '2026-07-20',
        notes: `${prefix}-idempotency`,
        status: 'ANALYZED',
        idempotencyKey: sharedKey
      };
      const firstA = await db.createInvoiceRecord({ ...base, userId: ownerA });
      const replayA = await db.createInvoiceRecord({ ...base, userId: ownerA, storeName: 'Ignored replay' });
      const firstB = await db.createInvoiceRecord({ ...base, userId: ownerB });
      assert.equal(firstA.created, true);
      assert.equal(replayA.created, false);
      assert.equal(replayA.invoice.id, firstA.invoice.id);
      assert.equal(firstB.created, true);
      assert.notEqual(firstB.invoice.id, firstA.invoice.id);
    });

    await t.test('legacy aliases are grouped canonically in dashboard, budget and Spending Plan totals', async () => {
      await db.pgPool.query(`
        INSERT INTO invoices (id, user_id, store_name, total_amount, currency, category, status, transaction_date)
        VALUES
          ($1, $5, 'Legacy health', 10, 'VND', 'Y tế', 'ANALYZED', '2026-07-10'),
          ($2, $5, 'Canonical health', 20, 'VND', 'Sức khỏe', 'PAID', '2026-07-11'),
          ($3, $5, 'Legacy utility', 30, 'VND', 'Hóa đơn tiện ích', 'ANALYZED', '2026-07-12'),
          ($4, $5, 'Canonical utility', 40, 'VND', 'Hóa đơn', 'PAID', '2026-07-13')
      `, [legacyHealthId, canonicalHealthId, legacyUtilityId, canonicalUtilityId, ownerA]);

      const monthly = await db.getMonthlySpendingByCategory(ownerA, '2026-07');
      assert.equal(monthly.find((row) => row.category === 'Sức khỏe')?.total_amount, 30);
      assert.equal(monthly.find((row) => row.category === 'Hóa đơn')?.total_amount, 70);
      assert.equal(monthly.some((row) => ['Y tế', 'Hóa đơn tiện ích'].includes(row.category)), false);

      const dashboard = await db.getDashboardSummary(ownerA, '2026-07');
      assert.equal(dashboard.categories.find((row) => row.category === 'Sức khỏe')?.total_amount, 30);
      assert.equal(dashboard.categories.find((row) => row.category === 'Hóa đơn')?.total_amount, 70);

      const budget = await db.upsertBudget(ownerA, 'Sức khỏe', 1_000_000);
      const budgets = await db.getBudgetsWithSpending(ownerA);
      assert.equal(budgets.find((row) => row.id === budget.id)?.spent, 30);
    });

    await t.test('DELETE removes only the authenticated fixture and repeated GET is 404', async () => {
      const deletion = parse(await handlers.deleteInvoice(request('DELETE', { id: handlerInvoiceId })));
      assert.equal(deletion.statusCode, 200);
      assert.equal(deletion.body.deletedId, handlerInvoiceId);
      const detail = parse(await handlers.getInvoice(request('GET', { id: handlerInvoiceId })));
      assert.equal(detail.statusCode, 404);
    });
  } finally {
    await cleanup();
    await db.pgPool.end();
  }
});
