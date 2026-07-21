BEGIN;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes VARCHAR(1000);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'OCR';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

-- Preserve every invoice while folding known legacy labels into the canonical
-- category set used by budgets, dashboard summaries and spending plans.
UPDATE invoices
SET category = 'Sức khỏe'
WHERE LOWER(BTRIM(category)) = LOWER('Y tế');

UPDATE invoices
SET category = 'Hóa đơn'
WHERE LOWER(BTRIM(category)) = LOWER('Hóa đơn tiện ích');

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_user_idempotency_key
  ON invoices(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
