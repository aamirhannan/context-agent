const express = require('express');
const repo = require('./repo');

const today = () => new Date().toISOString().slice(0, 10);

function createApp() {
  const app = express();
  app.use(express.json());

  // service -> 'off' | '500' | 'timeout'
  const failures = { user: 'off', kundli: 'off', horoscope: 'off', panchang: 'off' };

  app.post('/_control/fail', (req, res) => {
    const { service, mode } = req.body || {};
    if (!(service in failures)) return res.status(400).json({ error: 'unknown service' });
    failures[service] = mode || 'off';
    res.json({ ok: true, failures });
  });

  app.post('/_control/reset', (_req, res) => {
    for (const key of Object.keys(failures)) failures[key] = 'off';
    res.json({ ok: true, failures });
  });

  // Applies the injected failure for a service, if any.
  const guard = (service) => (req, res, next) => {
    if (failures[service] === '500') return res.status(500).json({ error: 'injected failure' });
    if (failures[service] === 'timeout') return; // never respond — client timeout fires
    next();
  };

  const send = (res, data) => (data ? res.json(data) : res.status(404).json({ error: 'not found' }));

  app.get('/users/:userId', guard('user'), async (req, res) => send(res, await repo.getUser(req.params.userId)));
  app.get('/kundli/:userId', guard('kundli'), async (req, res) => send(res, await repo.getKundli(req.params.userId)));
  app.get('/horoscope/:userId', guard('horoscope'), async (req, res) => send(res, await repo.getHoroscope(req.params.userId, today())));
  app.get('/panchang', guard('panchang'), async (_req, res) => send(res, await repo.getPanchang(today())));

  return app;
}

function startMockServer(port = Number(process.env.MOCKS_PORT) || 4000) {
  return new Promise((resolve) => {
    const server = createApp().listen(port, () => resolve(server));
  });
}

if (require.main === module) {
  startMockServer().then((s) => {
    console.log(`[mocks] repo=${repo.name} listening on http://localhost:${s.address().port}`);
  });
}

module.exports = { createApp, startMockServer };
