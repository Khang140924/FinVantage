import pg from 'pg';
import { dbConfig } from '../config/db.config.js';
import { resolveDatabaseCredentials } from './dbSecret.service.js';
import { enrichStoredLineItems } from '../utils/itemNormalization.js';
import {
  createNamespacedRedisClient,
  REDIS_NAMESPACES
} from '../../shared/redisClient.js';
import {
  EXPENSE_CATEGORY_ALIASES,
  EXPENSE_CATEGORY_VALUES,
  normalizeExpenseCategory
} from '../../shared/expenseCategories.js';

const { Pool } = pg;
// PostgreSQL DATE has no timezone. Returning it as a string prevents the pg
// driver from shifting a receipt date by one day during JSON serialization.
pg.types.setTypeParser(1082, (value) => value);

const sqlStringLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;
const CATEGORY_SQL_PAIRS = [
  ...EXPENSE_CATEGORY_VALUES.map((value) => [value, value]),
  ...Object.entries(EXPENSE_CATEGORY_ALIASES)
];
const canonicalCategorySql = (column) => `CASE
  ${CATEGORY_SQL_PAIRS.map(([input, canonical]) => (
    `WHEN LOWER(BTRIM(${column})) = LOWER(${sqlStringLiteral(input)}) THEN ${sqlStringLiteral(canonical)}`
  )).join('\n  ')}
  ELSE COALESCE(NULLIF(BTRIM(${column}), ''), 'Khác')
END`;

const normalizeInvoiceRow = (row) => {
  if (!row) return null;
  const { idempotency_key: _privateIdempotencyKey, ...invoice } = row;
  return {
    ...invoice,
    category: normalizeExpenseCategory(invoice.category) || invoice.category || 'Khác',
    line_items: enrichStoredLineItems(invoice.line_items)
  };
};

const safeDatabaseError = (error) => ({
  name: error?.name || 'DatabaseError',
  code: error?.code || 'DATABASE_CLIENT_ERROR'
});

const UNSUPPORTED_PG_STARTUP_ENV = Object.freeze([
  'PGOPTIONS',
  'PGREPLICATION',
  'PGSTATEMENTTIMEOUT',
  'PGSTATEMENT_TIMEOUT',
  'PGLOCKTIMEOUT',
  'PGLOCK_TIMEOUT',
  'PGIDLE_IN_TRANSACTION_SESSION_TIMEOUT',
  'PGAPPNAME'
]);

const removeUnsupportedPgStartupEnvironment = (env = process.env) => {
  for (const variableName of UNSUPPORTED_PG_STARTUP_ENV) {
    delete env[variableName];
  }
};

const validQueryTimeout = (value) => (
  Number.isSafeInteger(value) && value > 0 ? value : undefined
);

export const createRuntimePgPoolOptions = (resolvedConfig = {}) => {
  const poolConfig = resolvedConfig.pool || {};
  const queryTimeout = validQueryTimeout(poolConfig.query_timeout);
  return {
    host: resolvedConfig.host,
    port: resolvedConfig.port,
    database: resolvedConfig.database,
    user: resolvedConfig.user,
    password: resolvedConfig.password,
    ssl: resolvedConfig.ssl,
    max: poolConfig.max,
    connectionTimeoutMillis: poolConfig.connectionTimeoutMillis,
    idleTimeoutMillis: poolConfig.idleTimeoutMillis,
    ...(queryTimeout === undefined ? {} : { query_timeout: queryTimeout })
  };
};

export const createDeferredPgPool = ({
  baseConfig = dbConfig,
  resolveConfig = resolveDatabaseCredentials,
  PoolClass = Pool,
  logger = console
} = {}) => {
  let pool = null;
  let poolPromise = null;
  let ended = false;

  const getPool = async () => {
    if (ended) {
      const error = new Error('PostgreSQL pool has been closed.');
      error.code = 'DATABASE_POOL_CLOSED';
      throw error;
    }
    if (pool) return pool;
    if (!poolPromise) {
      poolPromise = Promise.resolve(resolveConfig(baseConfig)).then((resolvedConfig) => {
        // pg reads several startup parameters directly from process.env when
        // it creates each client lazily. Keep them absent for this runtime so
        // RDS Proxy only receives the standard user/database StartupMessage.
        removeUnsupportedPgStartupEnvironment();
        const createdPool = new PoolClass(createRuntimePgPoolOptions(resolvedConfig));
        createdPool.on?.('error', (error) => {
          logger.error?.('Unexpected idle PostgreSQL client error', safeDatabaseError(error));
        });
        pool = createdPool;
        return pool;
      }).catch((error) => {
        poolPromise = null;
        throw error;
      });
    }
    return poolPromise;
  };

  return {
    getPool,
    query: async (...args) => (await getPool()).query(...args),
    connect: async (...args) => (await getPool()).connect(...args),
    end: async () => {
      if (!pool && !poolPromise) {
        ended = true;
        return;
      }
      const activePool = pool || await poolPromise;
      ended = true;
      await activePool.end();
    },
    get totalCount() {
      return pool?.totalCount || 0;
    },
    get idleCount() {
      return pool?.idleCount || 0;
    },
    get waitingCount() {
      return pool?.waitingCount || 0;
    }
  };
};

export const pgPool = createDeferredPgPool();

export const redisClient = createNamespacedRedisClient({
  namespace: REDIS_NAMESPACES.PIPELINE
});

export const connectRedis = async () => {
  await redisClient.connect();
};

export const cacheInvoiceData = async (cacheKey, data, ttlSeconds = 3600) => {
  try {
    await connectRedis();
    await redisClient.setEx(cacheKey, ttlSeconds, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to cache invoice data', safeDatabaseError(error));
    throw error;
  }
};

export const getInvoiceFromCache = async (cacheKey) => {
  try {
    await connectRedis();

    const data = await redisClient.get(cacheKey);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Failed to get cached invoice data', safeDatabaseError(error));
    throw error;
  }
};

const normalizeInvoiceInput = (invoiceData = {}) => {
  const rawTotalAmount = invoiceData.totalAmount ?? invoiceData.total_amount ?? invoiceData.TotalAmount;
  const totalAmount = rawTotalAmount === null || rawTotalAmount === undefined ? null : Number(rawTotalAmount);

  return {
    invoiceId: invoiceData.invoiceId ?? invoiceData.id ?? null,
    userId: invoiceData.userId || invoiceData.user_id || null,
    storeName: String(invoiceData.storeName ?? invoiceData.store_name ?? invoiceData.VendorName ?? '').trim() || 'Không xác định',
    totalAmount: Number.isFinite(totalAmount) ? totalAmount : null,
    currency: invoiceData.currency || 'VND',
    category: normalizeExpenseCategory(invoiceData.category ?? invoiceData.Category) || 'Khác',
    aiAdvice: invoiceData.aiAdvice ?? invoiceData.ai_advice ?? invoiceData.FinancialAdvice ?? null,
    rawText: invoiceData.rawText ?? invoiceData.raw_text ?? null,
    sourceFileKey: invoiceData.sourceFileKey ?? invoiceData.source_file_key ?? null,
    lineItems: enrichStoredLineItems(invoiceData.lineItems ?? invoiceData.line_items),
    status: invoiceData.status ?? 'PENDING',
    transactionDate: invoiceData.transactionDate ?? invoiceData.transaction_date ?? null
  };
};

const invoiceColumns = [
  'user_id',
  'store_name',
  'total_amount',
  'currency',
  'category',
  'ai_advice',
  'raw_text',
  'source_file_key',
  'line_items',
  'status',
  'transaction_date'
];

const invoiceValues = (invoice) => [
  invoice.userId,
  invoice.storeName,
  invoice.totalAmount,
  invoice.currency,
  invoice.category,
  invoice.aiAdvice,
  invoice.rawText,
  invoice.sourceFileKey,
  JSON.stringify(invoice.lineItems),
  invoice.status,
  invoice.transactionDate
];

export const saveParsedInvoice = async (invoiceData) => {
  const invoice = normalizeInvoiceInput(invoiceData);

  if (!invoice.userId) throw new Error('userId is required to save an invoice.');

  if (invoice.status === 'ANALYZED') {
    if (!invoice.invoiceId) throw new Error('invoiceId is required for an analyzed invoice.');
    if (!Number.isFinite(invoice.totalAmount) || invoice.totalAmount <= 0) {
      throw new Error('Textract TOTAL must be a positive number before saving an analyzed invoice.');
    }
    if (!invoice.rawText?.trim()) throw new Error('Textract raw_text is required before saving an analyzed invoice.');
  }

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
      WHERE invoices.user_id = EXCLUDED.user_id
      RETURNING *
    `
    : `
      INSERT INTO invoices (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *
    `;

  try {
    const result = await pgPool.query(query, values);
    if (!result.rows[0]) throw new Error('Invoice id conflicts with a different user.');
    return normalizeInvoiceRow(result.rows[0]);
  } catch (error) {
    console.error('Failed to save parsed invoice to PostgreSQL', safeDatabaseError(error));
    throw error;
  }
};

export const createInvoiceRecord = async (invoiceData = {}) => {
  const invoice = normalizeInvoiceInput({
    ...invoiceData,
    status: invoiceData.status || "ANALYZED"
  });

  const query = `
    INSERT INTO invoices (
      user_id,
      store_name,
      total_amount,
      currency,
      category,
      ai_advice,
      raw_text,
      source_file_key,
      line_items,
      status,
      transaction_date,
      payment_method,
      notes,
      source,
      idempotency_key
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
    )
    ${invoiceData.idempotencyKey
      ? 'ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING'
      : ''}
    RETURNING *
  `;

  const values = [
    invoice.userId,
    invoice.storeName,
    invoice.totalAmount,
    invoice.currency,
    invoice.category,
    invoice.aiAdvice,
    invoice.rawText,
    invoice.sourceFileKey,
    JSON.stringify(invoice.lineItems),
    invoice.status,
    invoice.transactionDate,
    invoiceData.paymentMethod || null,
    invoiceData.notes || null,
    "MANUAL",
    invoiceData.idempotencyKey || null
  ];

  try {
    if (!invoice.userId) throw new Error('userId is required to create an invoice.');
    const result = await pgPool.query(query, values);
    if (result.rows[0]) {
      return { invoice: normalizeInvoiceRow(result.rows[0]), created: true };
    }
    if (!invoiceData.idempotencyKey) throw new Error('Invoice insert did not return a row.');
    const replay = await pgPool.query(
      'SELECT * FROM invoices WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1',
      [invoice.userId, invoiceData.idempotencyKey]
    );
    if (!replay.rows[0]) throw new Error('Idempotent invoice replay could not be resolved.');
    return { invoice: normalizeInvoiceRow(replay.rows[0]), created: false };
  } catch (error) {
    console.error('Failed to create invoice', safeDatabaseError(error));
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
    WHERE user_id = $1 AND status IN ('ANALYZED', 'PAID')
    ORDER BY created_at DESC NULLS LAST, id DESC
  `;

  try {
    const result = await pgPool.query(query, [userId]);
    return result.rows.map(normalizeInvoiceRow);
  } catch (error) {
    console.error('Failed to get invoices for user', safeDatabaseError(error));
    throw error;
  }
};

export const getInvoiceById = async (invoiceId, userId) => {
  const result = await pgPool.query(
    'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
    [invoiceId, userId]
  );
  const invoice = result.rows[0] || null;
  return normalizeInvoiceRow(invoice);
};

export const searchInvoicesByUser = async (userId, searchQuery, limit = 20) => {
  const query = String(searchQuery || '').trim();
  if (!userId || query.length < 2) return [];
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 20);
  const pattern = `%${query}%`;
  const categoryExpression = canonicalCategorySql('category');
  const result = await pgPool.query(`
    SELECT id, store_name, total_amount::float, currency, ${categoryExpression} AS category,
      transaction_date::text, status,
      'HD-' || UPPER(RIGHT(REGEXP_REPLACE(id, '[^a-zA-Z0-9]', '', 'g'), 8)) AS reference_code
    FROM invoices
    WHERE user_id = $1 AND status IN ('ANALYZED', 'PAID')
      AND (
        store_name ILIKE $2
        OR ${categoryExpression} ILIKE $2
        OR COALESCE(ai_advice, '') ILIKE $2
        OR total_amount::text ILIKE $2
        OR COALESCE(TO_CHAR(transaction_date, 'YYYY-MM-DD'), '') ILIKE $2
        OR ('HD-' || UPPER(RIGHT(REGEXP_REPLACE(id, '[^a-zA-Z0-9]', '', 'g'), 8))) ILIKE $2
        OR EXISTS (
          SELECT 1
          FROM JSONB_ARRAY_ELEMENTS(COALESCE(line_items, '[]'::jsonb)) AS line_item
          WHERE COALESCE(
            line_item->>'normalized_item_name',
            line_item->>'item',
            line_item->>'raw_item_name',
            ''
          ) ILIKE $2
        )
      )
    ORDER BY transaction_date DESC NULLS LAST, created_at DESC
    LIMIT $3
  `, [userId, pattern, safeLimit]);
  return result.rows.map((row) => ({
    ...row,
    category: normalizeExpenseCategory(row.category) || row.category || 'Khác'
  }));
};

const EDITABLE_INVOICE_COLUMNS = {
  storeName: 'store_name',
  totalAmount: 'total_amount',
  category: 'category',
  status: 'status',
  transactionDate: 'transaction_date',
  aiAdvice: 'ai_advice',
  paymentMethod: 'payment_method',
  notes: 'notes',
  lineItems: 'line_items'
};

export const updateInvoiceById = async (invoiceId, userId, changes = {}) => {
  const entries = Object.entries(EDITABLE_INVOICE_COLUMNS)
    .filter(([key]) => changes[key] !== undefined);

  if (!entries.length) throw new Error('At least one editable invoice field is required.');

  const assignments = entries.map(([, column], index) => `${column} = $${index + 1}`);
  const values = entries.map(([key]) => key === 'lineItems'
    ? JSON.stringify(enrichStoredLineItems(changes[key]))
    : changes[key]);
  values.push(invoiceId, userId);
  const result = await pgPool.query(
    `UPDATE invoices SET ${assignments.join(', ')}, updated_at = NOW()
     WHERE id = $${values.length - 1} AND user_id = $${values.length} RETURNING *`,
    values
  );
  return normalizeInvoiceRow(result.rows[0]);
};

export const deleteInvoiceById = async (invoiceId, userId) => {
  const result = await pgPool.query(
    'DELETE FROM invoices WHERE id = $1 AND user_id = $2 RETURNING id',
    [invoiceId, userId]
  );
  return result.rows[0] || null;
};

export const getDashboardSummary = async (userId, requestedMonth = null) => {
  if (!userId) {
    throw new Error('userId is required to get dashboard summary.');
  }

  const categoryExpression = canonicalCategorySql('category');
  const summaryQuery = `
    SELECT
      COUNT(*)::int AS total_invoices,
      COALESCE(SUM(total_amount), 0)::float AS total_amount,
      COALESCE(SUM(CASE WHEN status = 'PAID' THEN total_amount ELSE 0 END), 0)::float AS paid_amount,
      COALESCE(SUM(CASE WHEN status <> 'PAID' OR status IS NULL THEN total_amount ELSE 0 END), 0)::float AS unpaid_amount,
      COUNT(*) FILTER (WHERE status = 'PAID')::int AS paid_count,
      COUNT(*) FILTER (WHERE status <> 'PAID' OR status IS NULL)::int AS unpaid_count
    FROM invoices
    WHERE user_id = $1 AND status IN ('ANALYZED', 'PAID')
      AND transaction_date >= to_date($2 || '-01', 'YYYY-MM-DD')
      AND transaction_date < (to_date($2 || '-01', 'YYYY-MM-DD') + interval '1 month')::date
  `;

  const categoryQuery = `
    SELECT
      ${categoryExpression} AS category,
      COUNT(*)::int AS invoice_count,
      COALESCE(SUM(total_amount), 0)::float AS total_amount
    FROM invoices
    WHERE user_id = $1 AND status IN ('ANALYZED', 'PAID')
      AND transaction_date >= to_date($2 || '-01', 'YYYY-MM-DD')
      AND transaction_date < (to_date($2 || '-01', 'YYYY-MM-DD') + interval '1 month')::date
    GROUP BY ${categoryExpression}
    ORDER BY total_amount DESC
  `;

  const dailyQuery = `
    SELECT transaction_date::text AS day, COALESCE(SUM(total_amount), 0)::float AS expense
    FROM invoices
    WHERE user_id = $1 AND status IN ('ANALYZED', 'PAID')
      AND transaction_date >= to_date($2 || '-01', 'YYYY-MM-DD')
      AND transaction_date < (to_date($2 || '-01', 'YYYY-MM-DD') + interval '1 month')::date
    GROUP BY transaction_date
    ORDER BY transaction_date
  `;

  const availableMonthsQuery = `
    SELECT to_char(transaction_date, 'YYYY-MM') AS month
    FROM invoices
    WHERE user_id = $1 AND status IN ('ANALYZED', 'PAID') AND transaction_date IS NOT NULL
    GROUP BY to_char(transaction_date, 'YYYY-MM')
    ORDER BY month DESC
  `;

  try {
    const [availableMonthsResult, currentMonthResult] = await Promise.all([
      pgPool.query(availableMonthsQuery, [userId]),
      pgPool.query("SELECT to_char(CURRENT_DATE, 'YYYY-MM') AS month")
    ]);
    const availableMonths = availableMonthsResult.rows.map((row) => row.month);
    const currentMonth = currentMonthResult.rows[0].month;
    const validRequestedMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(requestedMonth || ''))
      ? String(requestedMonth)
      : null;
    const selectedMonth = validRequestedMonth || (
      availableMonths.includes(currentMonth) ? currentMonth : (availableMonths[0] || currentMonth)
    );

    const [summaryResult, categoryResult, dailyResult] = await Promise.all([
      pgPool.query(summaryQuery, [userId, selectedMonth]),
      pgPool.query(categoryQuery, [userId, selectedMonth]),
      pgPool.query(dailyQuery, [userId, selectedMonth])
    ]);

    return {
      ...summaryResult.rows[0],
      categories: categoryResult.rows,
      daily_spending: dailyResult.rows,
      selected_month: selectedMonth,
      available_months: availableMonths,
      latest_transaction_month: availableMonths[0] || null
    };
  } catch (error) {
    console.error('Failed to get dashboard summary', safeDatabaseError(error));
    throw error;
  }
};

const SPENDING_PLAN_SELECT = `
  SELECT id, to_char(plan_month, 'YYYY-MM') AS month,
    monthly_income::float AS monthly_income,
    needs_percent::float AS needs_percent,
    wants_percent::float AS wants_percent,
    savings_percent::float AS savings_percent,
    currency, created_at, updated_at
  FROM user_spending_plans
`;

export const getSpendingPlanByMonth = async (userId, month) => {
  if (!userId) throw new Error('userId is required to get a spending plan.');
  const result = await pgPool.query(`
    ${SPENDING_PLAN_SELECT}
    WHERE user_id = $1
      AND plan_month = to_date($2 || '-01', 'YYYY-MM-DD')
    LIMIT 1
  `, [userId, month]);
  return result.rows[0] || null;
};

export const getLatestSpendingPlan = async (userId, requestedMonth) => {
  if (!userId) throw new Error('userId is required to get the latest spending plan.');
  const result = await pgPool.query(`
    ${SPENDING_PLAN_SELECT}
    WHERE user_id = $1
      AND plan_month <= to_date($2 || '-01', 'YYYY-MM-DD')
    ORDER BY plan_month DESC, updated_at DESC
    LIMIT 1
  `, [userId, requestedMonth]);
  return result.rows[0] || null;
};

export const upsertSpendingPlan = async (userId, plan = {}) => {
  if (!userId) throw new Error('userId is required to save a spending plan.');
  const result = await pgPool.query(`
    INSERT INTO user_spending_plans (
      user_id, plan_month, monthly_income, needs_percent,
      wants_percent, savings_percent, currency
    )
    VALUES ($1, to_date($2 || '-01', 'YYYY-MM-DD'), $3, $4, $5, $6, $7)
    ON CONFLICT (user_id, plan_month) DO UPDATE SET
      monthly_income = EXCLUDED.monthly_income,
      needs_percent = EXCLUDED.needs_percent,
      wants_percent = EXCLUDED.wants_percent,
      savings_percent = EXCLUDED.savings_percent,
      currency = EXCLUDED.currency,
      updated_at = NOW()
    RETURNING id, to_char(plan_month, 'YYYY-MM') AS month,
      monthly_income::float AS monthly_income,
      needs_percent::float AS needs_percent,
      wants_percent::float AS wants_percent,
      savings_percent::float AS savings_percent,
      currency, created_at, updated_at
  `, [
    userId,
    plan.month,
    plan.monthlyIncome,
    plan.needsPercent,
    plan.wantsPercent,
    plan.savingsPercent,
    plan.currency
  ]);
  return result.rows[0];
};

export const getMonthlySpendingByCategory = async (userId, month) => {
  if (!userId) throw new Error('userId is required to get monthly spending.');
  const categoryExpression = canonicalCategorySql('category');
  const result = await pgPool.query(`
    SELECT ${categoryExpression} AS category, COALESCE(SUM(total_amount), 0)::float AS total_amount
    FROM invoices
    WHERE user_id = $1
      AND status IN ('ANALYZED', 'PAID')
      AND transaction_date >= to_date($2 || '-01', 'YYYY-MM-DD')
      AND transaction_date < (to_date($2 || '-01', 'YYYY-MM-DD') + interval '1 month')::date
    GROUP BY ${categoryExpression}
    ORDER BY category
  `, [userId, month]);
  return result.rows.map((row) => ({
    ...row,
    category: normalizeExpenseCategory(row.category) || row.category || 'Khác'
  }));
};

export const updateInvoicePaymentStatus = async (invoiceId, status, userId) => {
  if (!invoiceId) {
    throw new Error('invoiceId is required to update payment status.');
  }

  if (!status) {
    throw new Error('status is required to update payment status.');
  }

  const query = `
    UPDATE invoices
    SET status = $1, updated_at = NOW()
    WHERE id = $2 AND user_id = $3
    RETURNING *
  `;

  try {
    const result = await pgPool.query(query, [status, invoiceId, userId]);
    if (result.rows.length === 0) {
      throw new Error(`Invoice not found with id: [${invoiceId}]`);
    }

    return result.rows[0];
  } catch (error) {
    console.error('Failed to update invoice payment status', safeDatabaseError(error));
    throw error;
  }
};

export const getBudgetsWithSpending = async (userId) => {
  const budgetCategoryExpression = canonicalCategorySql('b.category');
  const invoiceCategoryExpression = canonicalCategorySql('i.category');
  const result = await pgPool.query(`
    WITH ranked_budgets AS (
      SELECT b.*, ${budgetCategoryExpression} AS canonical_category,
        ROW_NUMBER() OVER (
          PARTITION BY b.user_id, ${budgetCategoryExpression}, b.budget_month
          ORDER BY b.updated_at DESC NULLS LAST, b.created_at DESC NULLS LAST, b.id DESC
        ) AS category_rank
      FROM budgets b
      WHERE b.user_id = $1 AND b.budget_month = date_trunc('month', CURRENT_DATE)::date
    ), current_budgets AS (
      SELECT * FROM ranked_budgets WHERE category_rank = 1
    )
    SELECT b.id, b.canonical_category AS category, b.amount::float AS amount,
      COALESCE(SUM(i.total_amount), 0)::float AS spent,
      b.budget_month::text AS budget_month, b.created_at, b.updated_at
    FROM current_budgets b
    LEFT JOIN invoices i ON i.user_id = b.user_id
      AND ${invoiceCategoryExpression} = b.canonical_category
      AND i.status IN ('ANALYZED', 'PAID')
      AND i.transaction_date >= date_trunc('month', CURRENT_DATE)::date
      AND i.transaction_date < (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
    GROUP BY b.id, b.canonical_category, b.amount, b.budget_month, b.created_at, b.updated_at
    ORDER BY b.canonical_category
  `, [userId]);
  return result.rows.map((budget) => ({
    ...budget,
    limit: budget.amount,
    remaining: budget.amount - budget.spent,
    percentage: Number(((budget.spent / budget.amount) * 100).toFixed(1)),
    percent: Number(((budget.spent / budget.amount) * 100).toFixed(1)),
    status: budget.spent >= budget.amount ? 'exceeded' : budget.spent >= budget.amount * 0.8 ? 'warning' : 'normal',
    exceeded: budget.spent >= budget.amount
  }));
};

export const upsertBudget = async (userId, category, amount) => {
  const canonicalCategory = normalizeExpenseCategory(category) || category;
  const result = await pgPool.query(`
    INSERT INTO budgets (user_id, category, amount, budget_month)
    VALUES ($1, $2, $3, date_trunc('month', CURRENT_DATE)::date)
    ON CONFLICT (user_id, category, budget_month) DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
    RETURNING *
  `, [userId, canonicalCategory, amount]);
  return {
    ...result.rows[0],
    category: normalizeExpenseCategory(result.rows[0]?.category) || result.rows[0]?.category
  };
};

export const deleteBudgetById = async (budgetId, userId) => {
  const result = await pgPool.query(
    'DELETE FROM budgets WHERE id = $1 AND user_id = $2 RETURNING id',
    [budgetId, userId]
  );
  return result.rows[0] || null;
};

export const getOrCreateUserProfile = async (user) => {
  const userId = user?.sub;
  if (!userId) throw new Error('Authenticated user sub is required.');
  const email = user.email || `${userId}@unknown.local`;
  const displayName = user.name || email.split('@')[0];
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    const profileResult = await client.query(`
      INSERT INTO user_profiles (user_id, email, display_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, updated_at = NOW()
      RETURNING *
    `, [userId, email, displayName]);
    await client.query(`
      INSERT INTO user_preferences (user_id) VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING
    `, [userId]);
    const usageResult = await client.query(`
      SELECT COUNT(*)::int AS monthly_ocr_usage
      FROM invoices
      WHERE user_id = $1
        AND status IN ('ANALYZED', 'PAID')
        AND created_at >= date_trunc('month', CURRENT_DATE)
        AND created_at < date_trunc('month', CURRENT_DATE) + interval '1 month'
    `, [userId]);
    await client.query('COMMIT');
    return { ...profileResult.rows[0], monthly_ocr_usage: usageResult.rows[0].monthly_ocr_usage };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const updateUserProfile = async (user, changes = {}) => {
  await getOrCreateUserProfile(user);
  const result = await pgPool.query(`
    UPDATE user_profiles SET
      display_name = COALESCE($1, display_name),
      phone = COALESCE($2, phone),
      avatar_key = COALESCE($3, avatar_key),
      currency = COALESCE($4, currency),
      default_currency = COALESCE($4, default_currency),
      timezone = COALESCE($5, timezone),
      updated_at = NOW()
    WHERE user_id = $6
    RETURNING *
  `, [changes.displayName, changes.phone ?? null, changes.avatarKey, changes.currency, changes.timezone, user.sub]);
  return result.rows[0];
};

export const getUserPreferences = async (user) => {
  await getOrCreateUserProfile(user);
  const result = await pgPool.query(`
    SELECT user_id, language, dark_mode, budget_guardrails,
      auto_analyze_invoices, created_at, updated_at
    FROM user_preferences
    WHERE user_id = $1
  `, [user.sub]);
  return result.rows[0];
};

export const updateUserPreferences = async (user, changes = {}) => {
  await getOrCreateUserProfile(user);
  const result = await pgPool.query(`
    UPDATE user_preferences SET
      language = COALESCE($1, language),
      dark_mode = COALESCE($2, dark_mode),
      budget_guardrails = COALESCE($3, budget_guardrails),
      auto_analyze_invoices = COALESCE($4, auto_analyze_invoices),
      updated_at = NOW()
    WHERE user_id = $5
    RETURNING user_id, language, dark_mode, budget_guardrails,
      auto_analyze_invoices, created_at, updated_at
  `, [changes.language, changes.darkMode, changes.budgetGuardrails, changes.autoAnalyzeInvoices, user.sub]);
  return result.rows[0];
};

export const getBudgetAlertNotification = async (userId, category) => {
  const canonicalCategory = normalizeExpenseCategory(category) || category;
  const budgetCategoryExpression = canonicalCategorySql('b.category');
  const invoiceCategoryExpression = canonicalCategorySql('i.category');
  const result = await pgPool.query(`
    WITH ranked_budgets AS (
      SELECT b.*, ${budgetCategoryExpression} AS canonical_category,
        ROW_NUMBER() OVER (
          PARTITION BY b.user_id, ${budgetCategoryExpression}, b.budget_month
          ORDER BY b.updated_at DESC NULLS LAST, b.created_at DESC NULLS LAST, b.id DESC
        ) AS category_rank
      FROM budgets b
      WHERE b.user_id = $1
        AND ${budgetCategoryExpression} = $2
        AND b.budget_month = date_trunc('month', CURRENT_DATE)::date
    )
    SELECT p.email, p.display_name, b.canonical_category AS category,
      b.amount::float AS budget_amount,
      COALESCE(SUM(i.total_amount), 0)::float AS spent
    FROM user_profiles p
    JOIN user_preferences pref ON pref.user_id = p.user_id
      AND pref.budget_guardrails = true
    JOIN ranked_budgets b ON b.user_id = p.user_id AND b.category_rank = 1
    LEFT JOIN invoices i ON i.user_id = b.user_id
      AND ${invoiceCategoryExpression} = b.canonical_category
      AND i.status IN ('ANALYZED', 'PAID')
      AND i.transaction_date >= date_trunc('month', CURRENT_DATE)::date
      AND i.transaction_date < (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
    WHERE p.user_id = $1
    GROUP BY p.user_id, b.id, b.canonical_category, b.amount
    HAVING COALESCE(SUM(i.total_amount), 0) >= b.amount * 0.8
  `, [userId, canonicalCategory]);
  return result.rows[0] || null;
};

export const createNotification = async ({ userId, type, title, message, referenceId = null, dedupeKey = null }) => {
  const result = await pgPool.query(`
    INSERT INTO notifications (user_id, type, title, message, reference_id, dedupe_key)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id, dedupe_key) DO NOTHING
    RETURNING id, user_id, type, title, message, reference_id, is_read, created_at
  `, [userId, type, title, message, referenceId, dedupeKey]);
  return result.rows[0] || null;
};

export const evaluateBudgetNotifications = async (userId, category) => {
  const canonicalCategory = normalizeExpenseCategory(category) || category;
  const budgets = await getBudgetsWithSpending(userId);
  const budget = budgets.find((item) => item.category === canonicalCategory);
  if (!budget) return { budget: null, createdNotifications: [] };
  const month = String(budget.budget_month).slice(0, 7);
  const thresholds = [];
  if (budget.spent >= budget.limit * 0.8) thresholds.push({
    type: 'BUDGET_WARNING',
    threshold: 80,
    title: `Ngân sách ${canonicalCategory} đã đạt 80%`,
    message: `Bạn đã chi ${budget.spent.toLocaleString('vi-VN')} ₫ trên hạn mức ${budget.limit.toLocaleString('vi-VN')} ₫.`
  });
  if (budget.spent >= budget.limit) thresholds.push({
    type: 'BUDGET_EXCEEDED',
    threshold: 100,
    title: `Ngân sách ${canonicalCategory} đã vượt hạn mức`,
    message: `Chi tiêu hiện tại là ${budget.spent.toLocaleString('vi-VN')} ₫, tương đương ${budget.percentage}% hạn mức.`
  });
  const createdNotifications = [];
  for (const alert of thresholds) {
    const notification = await createNotification({
      userId,
      type: alert.type,
      title: alert.title,
      message: alert.message,
      referenceId: budget.id,
      dedupeKey: `budget:${budget.id}:${month}:${alert.threshold}`
    });
    if (notification) createdNotifications.push(notification);
  }
  return { budget, createdNotifications };
};

export const getNotificationsByUser = async (userId, limit = 50) => {
  const result = await pgPool.query(`
    SELECT id, type, title, message, reference_id, is_read, created_at
    FROM notifications WHERE user_id = $1
    ORDER BY created_at DESC, id DESC LIMIT $2
  `, [userId, Math.min(Math.max(Number(limit) || 50, 1), 100)]);
  return result.rows;
};

export const getUnreadNotificationCount = async (userId) => {
  const result = await pgPool.query('SELECT COUNT(*)::int AS unread_count FROM notifications WHERE user_id = $1 AND is_read = false', [userId]);
  return result.rows[0].unread_count;
};

export const markNotificationRead = async (notificationId, userId) => {
  const result = await pgPool.query(`
    UPDATE notifications SET is_read = true
    WHERE id = $1 AND user_id = $2 RETURNING id, type, title, message, reference_id, is_read, created_at
  `, [notificationId, userId]);
  return result.rows[0] || null;
};

export const markAllNotificationsRead = async (userId) => {
  const result = await pgPool.query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false', [userId]);
  return result.rowCount;
};

export const deleteNotificationById = async (notificationId, userId) => {
  const result = await pgPool.query('DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id', [notificationId, userId]);
  return result.rows[0] || null;
};
