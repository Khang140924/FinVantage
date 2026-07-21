import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLocalIntegrationEnvironment } from './localIntegrationGuard.js';

if (process.env.FINVANTAGE_DISABLE_DOTENV !== 'true') await import('dotenv/config');

assertLocalIntegrationEnvironment();
process.env.USE_MOCK_AUTH = 'true';
process.env.COGNITO_USER_POOL_ID ||= 'ap-southeast-1_SpendingPlanTest';
process.env.COGNITO_CLIENT_ID ||= 'spending-plan-test-client';

const [{ handler }, db] = await Promise.all([
  import('../src/handlers/spendingPlanHandler.js'),
  import('../src/services/db.service.js')
]);

const userId = 'mock-user';
const foreignUserId = 'spending-plan-foreign-user';
const month = '2040-05';
const previousMonth = '2040-04';
const nextMonth = '2040-06';
const invoiceIds = [
  'spending-plan-needs',
  'spending-plan-wants',
  'spending-plan-unclassified',
  'spending-plan-adjacent',
  'spending-plan-foreign'
];
const authorization = 'Bearer finvantage-mock-id-token';

const request = (method, { query = {}, body } = {}) => handler({
  path: '/spending-plan',
  httpMethod: method,
  headers: { Authorization: authorization },
  queryStringParameters: query,
  ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) })
});

const parsed = async (resultPromise) => {
  const result = await resultPromise;
  return { statusCode: result.statusCode, body: JSON.parse(result.body || '{}') };
};

const cleanup = async () => {
  await db.pgPool.query(`
    DELETE FROM user_spending_plans
    WHERE user_id IN ($1, $2)
      AND plan_month IN ('2040-05-01', '2040-06-01')
  `, [userId, foreignUserId]);
  await db.pgPool.query('DELETE FROM invoices WHERE id = ANY($1::varchar[])', [invoiceIds]);
};

await test('Spending Plan local PostgreSQL integration', async (t) => {
  try {
    await cleanup();
    await db.pgPool.query(`
      INSERT INTO invoices (id, user_id, store_name, total_amount, currency, category, status, transaction_date)
      VALUES
        ($1, $6, 'Needs fixture', 2000000, 'VND', 'Ăn uống', 'ANALYZED', '2040-05-10'),
        ($2, $6, 'Wants fixture', 1000000, 'VND', 'Mua sắm', 'PAID', '2040-05-11'),
        ($3, $6, 'Unknown fixture', 500000, 'VND', 'Du lịch', 'ANALYZED', '2040-05-12'),
        ($4, $6, 'Adjacent fixture', 9000000, 'VND', 'Hóa đơn', 'ANALYZED', '2040-06-01'),
        ($5, $7, 'Foreign fixture', 8000000, 'VND', 'Ăn uống', 'ANALYZED', '2040-05-15')
    `, [...invoiceIds, userId, foreignUserId]);
    await db.pgPool.query(`
      INSERT INTO user_spending_plans (
        user_id, plan_month, monthly_income, needs_percent, wants_percent, savings_percent, currency
      ) VALUES ($1, '2040-05-01', 99000000, 60, 20, 20, 'VND')
    `, [foreignUserId]);

    await t.test('missing authentication returns 401 before accessing plan data', async () => {
      const result = await parsed(handler({
        path: '/spending-plan',
        httpMethod: 'GET',
        queryStringParameters: { month }
      }));
      assert.equal(result.statusCode, 401);
    });

    await t.test('GET rejects an invalid month', async () => {
      const result = await parsed(request('GET', { query: { month: '2040-13' } }));
      assert.equal(result.statusCode, 400);
    });

    await t.test('a foreign saved plan is never used as the authenticated user fallback', async () => {
      const result = await parsed(request('GET', { query: { month } }));
      assert.equal(result.statusCode, 200);
      assert.equal(result.body.plan.isSaved, false);
      assert.equal(result.body.plan.source, 'default');
      assert.equal(result.body.plan.monthlyIncome, null);
      assert.equal(result.body.plan.id, undefined);
    });

    await t.test('GET default is read-only and monthly totals exclude adjacent and foreign transactions', async () => {
      const result = await parsed(request('GET', { query: { month } }));
      assert.equal(result.statusCode, 200);
      assert.equal(result.body.analysis.totalSpent, 3_500_000);
      assert.equal(result.body.analysis.allocation.needs.actualAmount, 2_000_000);
      assert.equal(result.body.analysis.allocation.wants.actualAmount, 1_500_000);
      const count = await db.pgPool.query('SELECT COUNT(*)::int AS count FROM user_spending_plans WHERE user_id = $1', [userId]);
      assert.equal(count.rows[0].count, 0);
    });

    await t.test('PUT rejects malformed JSON', async () => {
      const result = await parsed(request('PUT', { body: '{not-json' }));
      assert.equal(result.statusCode, 400);

      const nonObject = await parsed(request('PUT', { body: 'null' }));
      assert.equal(nonObject.statusCode, 400);
    });

    await t.test('PUT rejects invalid income, percentages and currency', async () => {
      const result = await parsed(request('PUT', { body: {
        month,
        monthlyIncome: 0,
        needsPercent: 80,
        wantsPercent: 30,
        savingsPercent: 20,
        currency: 'USD'
      } }));
      assert.equal(result.statusCode, 400);
      assert.match(result.body.message, /monthlyIncome/);
      assert.match(result.body.message, /bằng 100/);
      assert.match(result.body.message, /VND/);
    });

    let savedId;
    await t.test('PUT saves a plan with isolated monthly user analysis', async () => {
      const result = await parsed(request('PUT', { body: {
        month,
        monthlyIncome: 10_000_000,
        needsPercent: 50,
        wantsPercent: 30,
        savingsPercent: 20,
        currency: 'VND'
      } }));
      assert.equal(result.statusCode, 200);
      assert.equal(result.body.plan.isSaved, true);
      assert.equal(result.body.plan.source, 'saved');
      savedId = result.body.plan.id;
      assert.equal(result.body.analysis.allocation.needs.actualAmount, 2_000_000);
      assert.equal(result.body.analysis.allocation.wants.actualAmount, 1_500_000);
      assert.equal(result.body.analysis.unclassifiedAmount, 500_000);
      assert.deepEqual(result.body.analysis.unclassifiedCategories, ['Du lịch']);
    });

    await t.test('GET returns the saved plan and full response contract', async () => {
      const result = await parsed(request('GET', { query: { month } }));
      assert.equal(result.statusCode, 200);
      assert.equal(result.body.plan.id, savedId);
      assert.equal(result.body.plan.monthlyIncome, 10_000_000);
      assert.equal(result.body.analysis.targetSavings, 2_000_000);
      assert.equal(result.body.analysis.spendableIncome, 8_000_000);
      assert.equal(Array.isArray(result.body.analysis.suggestions), true);
      assert.equal(Array.isArray(result.body.analysis.warnings), true);
    });

    await t.test('repeated PUT upserts the same user and month', async () => {
      const result = await parsed(request('PUT', { body: {
        month,
        monthlyIncome: 12_000_000,
        needsPercent: 55,
        wantsPercent: 25,
        savingsPercent: 20,
        currency: 'VND'
      } }));
      assert.equal(result.statusCode, 200);
      assert.equal(result.body.plan.id, savedId);
      assert.equal(result.body.plan.monthlyIncome, 12_000_000);
      const count = await db.pgPool.query(`
        SELECT COUNT(*)::int AS count FROM user_spending_plans
        WHERE user_id = $1 AND plan_month = '2040-05-01'
      `, [userId]);
      assert.equal(count.rows[0].count, 1);
    });

    await t.test('an earlier unsaved month does not inherit a future saved plan', async () => {
      const result = await parsed(request('GET', { query: { month: previousMonth } }));
      assert.equal(result.statusCode, 200);
      assert.equal(result.body.plan.month, previousMonth);
      assert.equal(result.body.plan.monthlyIncome, null);
      assert.equal(result.body.plan.isSaved, false);
      assert.equal(result.body.plan.source, 'default');
      const count = await db.pgPool.query(`
        SELECT COUNT(*)::int AS count FROM user_spending_plans
        WHERE user_id = $1 AND plan_month = '2040-04-01'
      `, [userId]);
      assert.equal(count.rows[0].count, 0);
    });

    await t.test('an unsaved month projects the authenticated user latest config without writing', async () => {
      const result = await parsed(request('GET', { query: { month: nextMonth } }));
      assert.equal(result.statusCode, 200);
      assert.equal(result.body.plan.month, nextMonth);
      assert.equal(result.body.plan.monthlyIncome, 12_000_000);
      assert.equal(result.body.plan.isSaved, false);
      assert.equal(result.body.plan.source, 'latest');
      assert.equal(result.body.analysis.totalSpent, 9_000_000);
      const count = await db.pgPool.query(`
        SELECT COUNT(*)::int AS count FROM user_spending_plans
        WHERE user_id = $1 AND plan_month = '2040-06-01'
      `, [userId]);
      assert.equal(count.rows[0].count, 0);
    });
  } finally {
    await cleanup();
    await db.pgPool.end();
  }
});
