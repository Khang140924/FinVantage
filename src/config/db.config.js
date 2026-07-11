import dotenv from 'dotenv';

dotenv.config();

const parsedDbPort = Number.parseInt(process.env.DB_PORT || '', 10);

export const dbConfig = {
  host: process.env.DB_HOST,
  port: Number.isNaN(parsedDbPort) ? undefined : parsedDbPort,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
};

export const redisConfig = {
  url: process.env.REDIS_URL
};
