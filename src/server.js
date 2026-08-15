require('dotenv').config();

const express = require('express');
const { randomUUID } = require('node:crypto');
const { loadConfig } = require('./config');
const { buildRegistry } = require('./engine/contextRegistry');
const { createCache } = require('./gateway/cache');
const { getProvider } = require('./llm');
const { logger, forRequest } = require('./observability/logger');
const { AppError, PipelineError } = require('./errors');

function createApp(deps) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.use((req, _res, next) => { req.requestId = randomUUID(); next(); });

  app.get('/health', require('./routes/health')(deps));
  app.post('/personalize', require('./routes/personalize')(deps));
  app.post('/debug/personalization', require('./routes/debug')(deps));
  if (deps.traceRepo) {
    app.get('/debug/requests/:requestId', require('./routes/requests')(deps));
  }

  app.use((_req, res) => res.status(404).json({ error: 'not found' }));

  // The single place where an error becomes a status code.
  app.use((err, req, res, _next) => {
    const cause = err instanceof PipelineError ? err.cause : err;
    const status = cause instanceof AppError ? cause.status : 500;
    const log = forRequest(req.requestId);
    if (status >= 500) log.error({ err: cause.message, stage: err.details?.stage }, 'request failed');
    else log.warn({ err: cause.message }, 'request rejected');
    res.status(status).json({ error: cause.message, requestId: req.requestId });
  });

  return app;
}

function buildDeps() {
  const cfg = loadConfig(); // throws at boot on invalid config, never at request time
  return {
    cfg,
    registry: buildRegistry(cfg.registry),
    cache: createCache(),
    baseUrl: process.env.UPSTREAM_BASE_URL || 'http://localhost:4000',
    llm: getProvider(),
    traceRepo: process.env.DATABASE_URL ? require('./store/traceRepo') : null,
  };
}

function startServer(port = Number(process.env.PORT) || 3000) {
  const deps = buildDeps();
  return new Promise((resolve) => {
    const server = createApp(deps).listen(port, () => {
      logger.info({
        port,
        provider: deps.llm.name,
        upstream: deps.baseUrl,
        traceStore: deps.traceRepo ? 'postgres' : 'disabled',
      }, 'context engine listening');
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    logger.fatal({ err: err.message }, 'failed to start');
    process.exit(1);
  });
}

module.exports = { createApp, buildDeps, startServer };
