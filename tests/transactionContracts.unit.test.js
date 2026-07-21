import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('serverless route contract exposes one invoice CRUD namespace', async () => {
  const source = await read('serverless.yml');
  assert.match(source, /createInvoice:\s*[\s\S]*?handler:\s*src\/handlers\/invoiceHandler\.createInvoice[\s\S]*?path:\s*invoices\s*[\s\S]*?method:\s*post/);
  assert.match(source, /listInvoices:\s*[\s\S]*?path:\s*invoices\s*[\s\S]*?method:\s*get/);
  assert.match(source, /getInvoice:\s*[\s\S]*?path:\s*invoices\/\{id\}\s*[\s\S]*?method:\s*get/);
  assert.match(source, /updateInvoice:\s*[\s\S]*?path:\s*invoices\/\{id\}\s*[\s\S]*?method:\s*put/);
  assert.match(source, /deleteInvoice:\s*[\s\S]*?path:\s*invoices\/\{id\}\s*[\s\S]*?method:\s*delete/);
  assert.doesNotMatch(source, /path:\s*transactions(?:\/|\s|$)/);
});

test('frontend API contract matches the registered invoice routes', async () => {
  const source = await read('frontend/src/services/api.js');
  assert.match(source, /apiRequest\(`\/invoices`\)/);
  assert.match(source, /apiRequest\("\/invoices",\s*\{[\s\S]*?method:\s*"POST"/);
  assert.match(source, /apiRequest\(`\/invoices\/\$\{encodeURIComponent\(invoiceId\)\}`/);
  assert.match(source, /method:\s*"PUT"/);
  assert.match(source, /method:\s*"DELETE"/);
  assert.match(source, /"Idempotency-Key"/);
});

test('invoice schema and migration include safe manual transaction columns and keyed uniqueness', async () => {
  const [schema, migration] = await Promise.all([
    read('schema.sql'),
    read('migrations/20260720_add_manual_transaction_fields.sql')
  ]);
  for (const column of ['payment_method', 'notes', 'source', 'idempotency_key']) {
    assert.match(schema, new RegExp(`\\b${column}\\b`, 'i'));
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`, 'i'));
  }
  assert.match(schema, /UNIQUE INDEX IF NOT EXISTS idx_invoices_user_idempotency_key[\s\S]*?\(user_id, idempotency_key\)[\s\S]*?idempotency_key IS NOT NULL/i);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS idx_invoices_user_idempotency_key[\s\S]*?\(user_id, idempotency_key\)[\s\S]*?idempotency_key IS NOT NULL/i);
  assert.match(migration, /Y tế/);
  assert.match(migration, /Hóa đơn tiện ích/);
  assert.doesNotMatch(migration, /\b(?:DELETE|TRUNCATE|DROP TABLE)\b/i);
});

test('transaction modal uses selects for category and payment without a category text input', async () => {
  const source = await read('frontend/src/pages/Transactions.jsx');
  const modal = source.slice(source.indexOf('function TransactionModal'));
  assert.match(modal, /<select[^>]*value=\{form\.category\}/);
  assert.match(modal, /EXPENSE_CATEGORIES\.map/);
  assert.match(modal, /<select[^>]*value=\{form\.paymentMethod\}/);
  assert.doesNotMatch(modal, /<input[^>]*value=\{form\.category\}/);
});
