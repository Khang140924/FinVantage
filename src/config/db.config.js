import dotenv from 'dotenv';

dotenv.config();

const parsedDbPort = Number.parseInt(process.env.DB_PORT || '', 10);

export const dbConfig = {
  // AWS production points RDS_PROXY_ENDPOINT at the Aurora/PostgreSQL proxy.
  // Local development continues to use DB_HOST directly.
  host: process.env.RDS_PROXY_ENDPOINT || process.env.DB_HOST,
  port: Number.isNaN(parsedDbPort) ? undefined : parsedDbPort,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
};

export const redisConfig = {
  url: process.env.REDIS_URL
};
