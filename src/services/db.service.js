import pg from 'pg';
import { createClient } from 'redis';
import { dbConfig } from '../config/db.config.js';

const { Pool } = pg;

export const pgPool = new Pool({
  host: dbConfig.host,
  port: dbConfig.port,
  database: dbConfig.database,
  user: dbConfig.user,
  password: dbConfig.password,
  ssl: dbConfig.ssl ? { rejectUnauthorized: false } : false
});

export const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => console.error('Redis client connection error:', err));

export const connectRedis = async () => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
};

export const cacheInvoiceData = async (cacheKey, data, ttlSeconds = 3600) => {
  try {
    await connectRedis();
    await redisClient.setEx(cacheKey, ttlSeconds, JSON.stringify(data));
  } catch (error) {
    console.error(`Failed to cache invoice data with key [${cacheKey}]:`, error);
    throw error;
  }
};

export const getInvoiceFromCache = async (cacheKey) => {
  try {
    await connectRedis();

    const data = await redisClient.get(cacheKey);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error(`Failed to get invoice data from cache with key [${cacheKey}]:`, error);
    throw error;
  }
};

const normalizeInvoiceInput = (invoiceData = {}) => {
  const totalAmount = Number(invoiceData.totalAmount ?? invoiceData.TotalAmount ?? 0);

  return {
    invoiceId: invoiceData.invoiceId ?? invoiceData.id ?? null,
    userId: invoiceData.userId ?? invoiceData.user_id ?? null,
    storeName: invoiceData.storeName ?? invoiceData.store_name ?? invoiceData.VendorName ?? 'Unknown',
    totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
    category: invoiceData.category ?? invoiceData.Category ?? 'Khác',
    aiAdvice: invoiceData.aiAdvice ?? invoiceData.ai_advice ?? invoiceData.FinancialAdvice ?? null,
    rawText: invoiceData.rawText ?? invoiceData.raw_text ?? null,
    sourceFileKey: invoiceData.sourceFileKey ?? invoiceData.source_file_key ?? null,
    status: invoiceData.status ?? 'PENDING'
  };
};

const invoiceColumns = [
  'user_id',
  'store_name',
  'total_amount',
  'category',
  'ai_advice',
  'raw_text',
  'source_file_key',
  'status'
];

const invoiceValues = (invoice) => [
  invoice.userId,
  invoice.storeName,
  invoice.totalAmount,
  invoice.category,
  invoice.aiAdvice,
  invoice.rawText,
  invoice.sourceFileKey,
  invoice.status
];

export const saveParsedInvoice = async (invoiceData) => {
  const invoice = normalizeInvoiceInput(invoiceData);

  const columns = invoice.invoiceId ? ['id', ...invoiceColumns] : invoiceColumns;
  const values = invoice.invoiceId ? [invoice.invoiceId, ...invoiceValues(invoice)] : invoiceValues(invoice);
  const placeholders = columns.map((_, index) => `$${index + 1}`);

  const updateAssignments = invoiceColumns
    .map((column) => `${column} = EXCLUDED.${column}`)
    .concat('updated_at = NOW()')
    .join(', ');

  const query = invoice.invoiceId
    ? `
      INSERT INTO invoices (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (id) DO UPDATE SET ${updateAssignments}
      RETURNING *
    `
    : `
      INSERT INTO invoices (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *
    `;

  try {
    const result = await pgPool.query(query, values);
    return result.rows[0];
  } catch (error) {
    console.error('Failed to save parsed invoice to PostgreSQL:', error);
    throw error;
  }
};

export const getInvoicesByUser = async (userId) => {
  if (!userId) {
    throw new Error('userId is required to get invoices.');
  }

  const query = `
    SELECT *
    FROM invoices
    WHERE user_id = $1
    ORDER BY created_at DESC NULLS LAST, id DESC
  `;

  try {
    const result = await pgPool.query(query, [userId]);
    return result.rows;
  } catch (error) {
    console.error(`Failed to get invoices for user [${userId}]:`, error);
    throw error;
  }
};

export const getDashboardSummary = async (userId) => {
  if (!userId) {
    throw new Error('userId is required to get dashboard summary.');
  }

  const summaryQuery = `
    SELECT
      COUNT(*)::int AS total_invoices,
      COALESCE(SUM(total_amount), 0)::float AS total_amount,
      COALESCE(SUM(CASE WHEN status = 'PAID' THEN total_amount ELSE 0 END), 0)::float AS paid_amount,
      COALESCE(SUM(CASE WHEN status <> 'PAID' OR status IS NULL THEN total_amount ELSE 0 END), 0)::float AS unpaid_amount,
      COUNT(*) FILTER (WHERE status = 'PAID')::int AS paid_count,
      COUNT(*) FILTER (WHERE status <> 'PAID' OR status IS NULL)::int AS unpaid_count
    FROM invoices
    WHERE user_id = $1
  `;

  const categoryQuery = `
    SELECT
      COALESCE(category, 'Khác') AS category,
      COUNT(*)::int AS invoice_count,
      COALESCE(SUM(total_amount), 0)::float AS total_amount
    FROM invoices
    WHERE user_id = $1
    GROUP BY COALESCE(category, 'Khác')
    ORDER BY total_amount DESC
  `;

  try {
    const [summaryResult, categoryResult] = await Promise.all([
      pgPool.query(summaryQuery, [userId]),
      pgPool.query(categoryQuery, [userId])
    ]);

    return {
      ...summaryResult.rows[0],
      categories: categoryResult.rows
    };
  } catch (error) {
    console.error(`Failed to get dashboard summary for user [${userId}]:`, error);
    throw error;
  }
};

export const updateInvoicePaymentStatus = async (invoiceId, status) => {
  if (!invoiceId) {
    throw new Error('invoiceId is required to update payment status.');
  }

  if (!status) {
    throw new Error('status is required to update payment status.');
  }

  const query = `
    UPDATE invoices
    SET status = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `;

  try {
    const result = await pgPool.query(query, [status, invoiceId]);
    if (result.rows.length === 0) {
      throw new Error(`Invoice not found with id: [${invoiceId}]`);
    }

    return result.rows[0];
  } catch (error) {
    console.error(`Failed to update payment status for invoice [${invoiceId}]:`, error);
    throw error;
  }
};
