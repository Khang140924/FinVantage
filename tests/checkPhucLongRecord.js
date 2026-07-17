import 'dotenv/config';
import assert from 'node:assert/strict';

const { getDashboardSummary, pgPool } = await import('../src/services/db.service.js');

try {
  const result = await pgPool.query(`
    SELECT id, store_name, total_amount::float, category, transaction_date::text,
      line_items, raw_text, status, source_file_key
    FROM invoices
    WHERE user_id = $1 AND source_file_key LIKE $2
    ORDER BY updated_at DESC
    LIMIT 1
  `, ['mock-user', '%3198dec0282ffe82f5447a33c66227ea581c32dfc5304bc4549de94367516b3f%']);
  assert.equal(result.rowCount, 1, 'Không tìm thấy bản ghi Phúc Long đã test.');
  const invoice = result.rows[0];
  const itemNames = invoice.line_items.map((item) => item.item);

  assert.match(invoice.store_name, /PHUC LONG/i);
  assert.equal(invoice.total_amount, 103000);
  assert.equal(invoice.transaction_date, '2018-09-11');
  assert.equal(invoice.category, 'Ăn uống');
  assert.deepEqual(itemNames, ['Strawberry Juice', 'Pineapple Juice', 'Choco Coco Brownie']);
  assert.equal(invoice.line_items.reduce((sum, item) => sum + item.price, 0), 103000);
  assert.match(invoice.raw_text, /PHUC LONG/i);
  assert.match(invoice.raw_text, /103,000/);
  assert.doesNotMatch(invoice.raw_text, /Cửa hàng giả lập/i);

  const fakeResult = await pgPool.query(`
    SELECT COUNT(*)::int AS count FROM invoices
    WHERE user_id = $1 AND (total_amount = 125000 OR store_name IN ('Cửa hàng giả lập', 'Mock Store'))
  `, ['mock-user']);
  assert.equal(fakeResult.rows[0].count, 0);

  const defaultDashboard = await getDashboardSummary('mock-user');
  const dashboard = await getDashboardSummary('mock-user', '2018-09');
  assert.equal(dashboard.selected_month, '2018-09');
  assert.equal(dashboard.daily_spending.reduce((sum, item) => sum + Number(item.expense), 0), 103000);
  const emptyMonthDashboard = await getDashboardSummary('mock-user', '2099-01');
  assert.equal(emptyMonthDashboard.selected_month, '2099-01');
  assert.equal(emptyMonthDashboard.daily_spending.length, 0);
  assert.equal(emptyMonthDashboard.total_amount, defaultDashboard.total_amount);
  console.log(JSON.stringify({
    invoice: {
      id: invoice.id,
      store_name: invoice.store_name,
      total_amount: invoice.total_amount,
      transaction_date: invoice.transaction_date,
      category: invoice.category,
      line_items: invoice.line_items,
      raw_text_length: invoice.raw_text.length,
      status: invoice.status,
      source_file_key: invoice.source_file_key
    },
    dashboard: {
      total_invoices: dashboard.total_invoices,
      total_amount: dashboard.total_amount,
      food_category_amount: dashboard.categories.find((item) => item.category === 'Ăn uống')?.total_amount || 0,
      selected_month: dashboard.selected_month,
      daily_spending: dashboard.daily_spending,
      default_selected_month: defaultDashboard.selected_month,
      selected_month_keeps_total: emptyMonthDashboard.total_amount
    },
    fake_records: fakeResult.rows[0].count
  }, null, 2));
} finally {
  await pgPool.end();
}
