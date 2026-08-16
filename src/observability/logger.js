const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
});

/** Request-scoped child logger so every line carries the same requestId. */
const forRequest = (requestId) => logger.child({ requestId });

module.exports = { logger, forRequest };
