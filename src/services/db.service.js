import pg from 'pg';
import { createClient } from 'redis';
import { dbConfig } from '../config/db.config.js';

const { Pool } = pg;

// Khởi tạo PostgreSQL Connection Pool (bể chứa kết nối cơ sở dữ liệu)
export const pgPool = new Pool({
  host: dbConfig.host,
  port: dbConfig.port,
  database: dbConfig.database,
  user: dbConfig.user,
  password: dbConfig.password,
  // Bật SSL nếu được cấu hình (thường dùng cho AWS RDS trong production)
  ssl: dbConfig.ssl ? { rejectUnauthorized: false } : false
});

// Khởi tạo Redis Client
export const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => console.error('Lỗi kết nối Redis Client:', err));

/**
 * Hàm đảm bảo kết nối Redis Client đã được mở trước khi thực hiện các truy vấn
 */
export const connectRedis = async () => {
  if (!redisClient.isOpen) {
    try {
      await redisClient.connect();
    } catch (error) {
      console.error('Không thể kết nối đến Redis Server:', error);
      throw error;
    }
  }
};

/**
 * Lưu trữ dữ liệu hóa đơn vào Redis cache (bộ nhớ đệm Redis) với thời gian hết hạn (TTL - Time To Live)
 * @param {string} cacheKey - Khóa bộ nhớ đệm (Cache Key)
 * @param {any} data - Dữ liệu hóa đơn cần lưu trữ (sẽ được chuyển sang JSON string)
 * @param {number} ttlSeconds - Thời gian sống của dữ liệu cache tính bằng giây (mặc định 3600 giây = 1 giờ)
 */
export const cacheInvoiceData = async (cacheKey, data, ttlSeconds = 3600) => {
  try {
    // Đảm bảo kết nối Redis hoạt động
    await connectRedis();

    const stringifiedData = JSON.stringify(data);
    
    // Ghi dữ liệu vào Redis kèm theo TTL sử dụng hàm setEx
    await redisClient.setEx(cacheKey, ttlSeconds, stringifiedData);
  } catch (error) {
    console.error(`Lỗi khi ghi dữ liệu hóa đơn vào Redis cache với khóa [${cacheKey}]:`, error);
    throw error;
  }
};

/**
 * Lấy dữ liệu hóa đơn thô từ Redis cache và phân tích thành đối tượng JS
 * @param {string} cacheKey - Khóa bộ nhớ đệm (Cache Key)
 * @returns {Promise<any>} - Dữ liệu hóa đơn đã được giải mã từ JSON (hoặc null nếu không tìm thấy)
 */
export const getInvoiceFromCache = async (cacheKey) => {
  try {
    // Đảm bảo kết nối Redis hoạt động
    await connectRedis();

    const data = await redisClient.get(cacheKey);
    if (!data) {
      return null;
    }
    return JSON.parse(data);
  } catch (error) {
    console.error(`Lỗi khi lấy dữ liệu hóa đơn từ Redis với khóa [${cacheKey}]:`, error);
    throw error;
  }
};

/**
 * Lưu hóa đơn đã phân tích bằng AI vào bảng 'invoices' trong PostgreSQL
 * @param {object} invoiceData - Dữ liệu hóa đơn gồm: VendorName, TotalAmount, TaxAmount, Date, FinancialAdvice
 * @returns {Promise<object>} - Dòng dữ liệu hóa đơn vừa được chèn thành công trong database
 */
export const saveParsedInvoice = async (invoiceData) => {
  const query = `
    INSERT INTO invoices (vendor_name, total_amount, tax_amount, invoice_date, financial_advice)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  const values = [
    invoiceData.VendorName,
    invoiceData.TotalAmount,
    invoiceData.TaxAmount,
    invoiceData.Date,
    invoiceData.FinancialAdvice
  ];

  try {
    const res = await pgPool.query(query, values);
    return res.rows[0];
  } catch (error) {
    console.error('Lỗi khi thực thi lưu hóa đơn đã phân tích vào PostgreSQL:', error);
    throw error;
  }
};

/**
 * Cập nhật trạng thái thanh toán của hóa đơn trong PostgreSQL
 * @param {number|string} invoiceId - ID của hóa đơn cần cập nhật
 * @param {string} status - Trạng thái mới (ví dụ: PAID, UNPAID, PENDING)
 * @returns {Promise<object>} - Bản ghi hóa đơn sau khi đã cập nhật trạng thái
 */
export const updateInvoicePaymentStatus = async (invoiceId, status) => {
  const query = `
    UPDATE invoices
    SET status = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `;
  const values = [status, invoiceId];

  try {
    const res = await pgPool.query(query, values);
    if (res.rows.length === 0) {
      throw new Error(`Không tìm thấy hóa đơn nào với ID: [${invoiceId}]`);
    }
    return res.rows[0];
  } catch (error) {
    console.error(`Lỗi khi cập nhật trạng thái thanh toán hóa đơn [ID: ${invoiceId}]:`, error);
    throw error;
  }
};



