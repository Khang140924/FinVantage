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

CREATE INDEX IF NOT EXISTS idx_user_spending_plans_user_month
  ON user_spending_plans(user_id, plan_month DESC);
