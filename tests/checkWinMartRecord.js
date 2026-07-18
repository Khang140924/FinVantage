import 'dotenv/config';
import assert from 'node:assert/strict';
import { pgPool } from '../src/services/db.service.js';

try {
  const result = await pgPool.query(`
    SELECT store_name, total_amount::float, transaction_date::text, currency,
      line_items, raw_text
    FROM invoices
    WHERE store_name ILIKE 'WinMart%'
    ORDER BY updated_at DESC
    LIMIT 1
  `);
  assert.equal(result.rowCount, 1, 'Không tìm thấy bản ghi WinMart để kiểm tra.');
  const invoice = result.rows[0];
  const firstItem = invoice.line_items[0];

  assert.equal(invoice.store_name, 'WinMart+');
  assert.equal(invoice.total_amount, 120000);
  assert.equal(invoice.transaction_date, '2026-06-25');
  assert.equal(invoice.currency, 'VND');
  assert.equal(firstItem.raw_item_name, 'Sun tural Vinamilk IL');
  assert.equal(firstItem.normalized_item_name, 'Sữa tươi Vinamilk 1L');
  assert.equal(Number(firstItem.total_price), 28500);
  assert.match(invoice.raw_text, /Sun tural Vinamilk IL/);

  console.log(JSON.stringify({
    store_name: invoice.store_name,
    total_amount: invoice.total_amount,
    transaction_date: invoice.transaction_date,
    raw_item_name: firstItem.raw_item_name,
    normalized_item_name: firstItem.normalized_item_name,
    first_item_price: firstItem.total_price,
    raw_text_preserved: true,
  }, null, 2));
} finally {
  await pgPool.end();
}
