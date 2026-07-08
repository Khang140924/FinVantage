CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL DEFAULT 'demo-user',
  store_name VARCHAR(255),
  total_amount NUMERIC(12, 2) DEFAULT 0,
  category VARCHAR(100),
  ai_advice TEXT,
  raw_text TEXT,
  source_file_key TEXT,
  status VARCHAR(50) DEFAULT 'ANALYZED',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_category ON invoices(category);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at);
