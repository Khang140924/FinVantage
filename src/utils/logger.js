const sensitiveKeyPattern = /authorization|cookie|password|secret|token|access[_-]?key|session/i;

const redactString = (value) => String(value)
  .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
  .replace(/(X-Amz-(?:Credential|Signature|Security-Token)=)[^&\s]+/gi, '$1[REDACTED]')
  .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED_AWS_ACCESS_KEY]');

const sanitize = (value, seen = new WeakSet()) => {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => sanitize(item, seen));

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    sensitiveKeyPattern.test(key) ? '[REDACTED]' : sanitize(item, seen)
  ]));
};

const write = (method, level, message, meta = {}) => {
  const payload = sanitize({
    level,
    timestamp: new Date().toISOString(),
    message,
    ...meta
  });
  console[method](JSON.stringify(payload));
};

export const logger = {
  info: (message, meta = {}) => write('log', 'INFO', message, meta),
  error: (message, error = {}, meta = {}) => write('error', 'ERROR', message, {
    errorName: error?.name,
    errorCode: error?.code,
    errorMessage: error?.message,
    stack: error?.stack,
    ...meta
  }),
  warn: (message, meta = {}) => write('warn', 'WARN', message, meta),
  debug: (message, meta = {}) => {
    if (process.env.DEBUG === 'true') write('log', 'DEBUG', message, meta);
  }
};
