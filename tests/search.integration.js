import 'dotenv/config';
import assert from 'node:assert/strict';
import { pgPool, searchInvoicesByUser } from '../src/services/db.service.js';

const ownerA = 'search-test-owner-a';
const ownerB = 'search-test-owner-b';
const invoiceA = 'search-test-invoice-a';
const invoiceB = 'search-test-invoice-b';

try {
  await pgPool.query('DELETE FROM invoices WHERE id IN ($1, $2)', [invoiceA, invoiceB]);
  await pgPool.query(`
    INSERT INTO invoices (id, user_id, store_name, total_amount, currency, category, raw_text, line_items, status, transaction_date)
    VALUES
      ($1, $3, 'Private Alpha Shop', 103000, 'VND', 'Ăn uống', 'private alpha content', $5::jsonb, 'ANALYZED', '2018-09-11'),
      ($2, $4, 'Private Beta Shop', 120000, 'VND', 'Mua sắm', 'private beta content', $6::jsonb, 'ANALYZED', '2026-06-25')
  `, [
    invoiceA,
    invoiceB,
    ownerA,
    ownerB,
    JSON.stringify([{ item: 'Alpha product', normalized_item_name: 'Alpha product', price: 103000 }]),
    JSON.stringify([{ item: 'Beta product', normalized_item_name: 'Beta product', price: 120000 }]),
  ]);

  const ownResult = await searchInvoicesByUser(ownerA, 'Alpha');
  const crossUserResult = await searchInvoicesByUser(ownerA, 'Beta');
  const amountResult = await searchInvoicesByUser(ownerA, '103000');

  assert.equal(ownResult.length, 1);
  assert.equal(ownResult[0].id, invoiceA);
  assert.equal(crossUserResult.length, 0);
  assert.equal(amountResult.length, 1);
  assert.equal('raw_text' in ownResult[0], false);
  assert.equal('source_file_key' in ownResult[0], false);

  console.log(JSON.stringify({ ownResults: ownResult.length, crossUserResults: crossUserResult.length, amountResults: amountResult.length, technicalFieldsExposed: false }, null, 2));
} finally {
  await pgPool.query('DELETE FROM invoices WHERE id IN ($1, $2)', [invoiceA, invoiceB]);
  await pgPool.end();
}
