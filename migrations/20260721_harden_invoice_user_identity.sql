-- Preserve existing rows, including legacy demo data, while ensuring every new
-- invoice explicitly receives its authenticated Cognito user id.
ALTER TABLE IF EXISTS invoices
  ALTER COLUMN user_id DROP DEFAULT;
