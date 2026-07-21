CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(255) PRIMARY KEY,
  checksum CHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'applied', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ,
  error_code VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS invoices (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR(100) NOT NULL,
  store_name VARCHAR(255),
  total_amount NUMERIC(12, 2) DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'VND',
  category VARCHAR(100),
  ai_advice TEXT,
  raw_text TEXT,
  source_file_key TEXT,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(50) DEFAULT 'ANALYZED',
  transaction_date DATE DEFAULT CURRENT_DATE,
  payment_method VARCHAR(50),
  notes VARCHAR(1000),
  source VARCHAR(50) NOT NULL DEFAULT 'OCR',
  idempotency_key VARCHAR(128),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE invoices
  ALTER COLUMN id TYPE VARCHAR(255) USING id::text,
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN user_id DROP DEFAULT;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS transaction_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS line_items JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'VND';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes VARCHAR(1000);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'OCR';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);
UPDATE invoices SET currency = 'VND' WHERE currency IS NULL OR currency = '';
UPDATE invoices SET transaction_date = created_at::date WHERE transaction_date IS NULL;
ALTER TABLE invoices ALTER COLUMN transaction_date SET DEFAULT CURRENT_DATE;

CREATE TABLE IF NOT EXISTS budgets (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR(100) NOT NULL,
  category VARCHAR(100) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  budget_month DATE NOT NULL DEFAULT date_trunc('month', CURRENT_DATE)::date,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT budgets_user_category_month_key UNIQUE (user_id, category, budget_month)
);

ALTER TABLE budgets ADD COLUMN IF NOT EXISTS budget_month DATE;
UPDATE budgets SET budget_month = date_trunc('month', COALESCE(created_at, CURRENT_TIMESTAMP))::date WHERE budget_month IS NULL;
ALTER TABLE budgets ALTER COLUMN budget_month SET DEFAULT date_trunc('month', CURRENT_DATE)::date;
ALTER TABLE budgets ALTER COLUMN budget_month SET NOT NULL;
ALTER TABLE budgets DROP CONSTRAINT IF EXISTS budgets_user_id_category_key;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budgets_user_category_month_key') THEN
    ALTER TABLE budgets ADD CONSTRAINT budgets_user_category_month_key UNIQUE (user_id, category, budget_month);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id VARCHAR(100) PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  display_name VARCHAR(255),
  phone VARCHAR(50),
  avatar_url TEXT,
  avatar_key TEXT,
  currency VARCHAR(10) NOT NULL DEFAULT 'VND',
  default_currency VARCHAR(3) NOT NULL DEFAULT 'VND',
  timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Bangkok',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS avatar_key TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS default_currency VARCHAR(3) NOT NULL DEFAULT 'VND';
UPDATE user_profiles SET default_currency = 'VND' WHERE default_currency IS NULL OR default_currency <> 'VND';
UPDATE user_profiles SET avatar_key = avatar_url WHERE avatar_key IS NULL AND avatar_url LIKE 'avatars/%';

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id VARCHAR(100) PRIMARY KEY REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  language VARCHAR(10) NOT NULL DEFAULT 'vi',
  dark_mode BOOLEAN NOT NULL DEFAULT false,
  budget_guardrails BOOLEAN NOT NULL DEFAULT true,
  auto_analyze_invoices BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR(100) NOT NULL,
  type VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  reference_id VARCHAR(255),
  is_read BOOLEAN NOT NULL DEFAULT false,
  dedupe_key VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS user_spending_plans (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR(100) NOT NULL,
  plan_month DATE NOT NULL CHECK (plan_month = date_trunc('month', plan_month)::date),
  monthly_income NUMERIC(12, 2) NOT NULL CHECK (monthly_income > 0),
  needs_percent NUMERIC(5, 2) NOT NULL DEFAULT 50 CHECK (needs_percent BETWEEN 0 AND 100),
  wants_percent NUMERIC(5, 2) NOT NULL DEFAULT 30 CHECK (wants_percent BETWEEN 0 AND 100),
  savings_percent NUMERIC(5, 2) NOT NULL DEFAULT 20 CHECK (savings_percent BETWEEN 0 AND 100),
  currency VARCHAR(3) NOT NULL DEFAULT 'VND',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_spending_plans_percent_sum_check
    CHECK (needs_percent + wants_percent + savings_percent = 100),
  CONSTRAINT user_spending_plans_user_month_key UNIQUE (user_id, plan_month)
);

CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_category ON invoices(category);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_transaction_date ON invoices(transaction_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_user_idempotency_key
  ON invoices(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budgets_user_id ON budgets(user_id);
CREATE INDEX IF NOT EXISTS idx_budgets_month ON budgets(user_id, budget_month);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_user_spending_plans_user_month ON user_spending_plans(user_id, plan_month DESC);
