// Tiện ích logger (ghi nhật ký) chuẩn hóa dưới dạng JSON cho CloudWatch
export const logger = {
  info: (message, meta = {}) => {
    console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), message, ...meta }));
  },
  error: (message, error = {}, meta = {}) => {
    console.error(JSON.stringify({ 
      level: 'ERROR', 
      timestamp: new Date().toISOString(), 
      message, 
      errorMessage: error.message, 
      stack: error.stack,
      ...meta 
    }));
  },
  warn: (message, meta = {}) => {
    console.warn(JSON.stringify({ level: 'WARN', timestamp: new Date().toISOString(), message, ...meta }));
  },
  debug: (message, meta = {}) => {
    if (process.env.DEBUG === 'true') {
      console.log(JSON.stringify({ level: 'DEBUG', timestamp: new Date().toISOString(), message, ...meta }));
    }
  }
};
