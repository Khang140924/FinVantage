import dotenv from 'dotenv';

// Tải các environment variables (biến môi trường) từ tệp .env
dotenv.config();

export const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'finvantage',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  ssl: process.env.DB_SSL === 'true' // Bật SSL nếu cấu hình môi trường là true
};
