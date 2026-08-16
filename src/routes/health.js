module.exports = (deps) => async (_req, res) => {
  const services = Object.entries(deps.cfg.services.services);

  const upstreams = Object.fromEntries(await Promise.all(services.map(async ([name, cfg]) => {
    const url = deps.baseUrl + cfg.path.replace('{userId}', 'user_101');
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(cfg.timeoutMs) });
      return [name, r.ok ? 'up' : `http_${r.status}`];
    } catch {
      return [name, 'down'];
    }
  })));

  res.json({
    status: 'ok',
    provider: deps.llm.name,
    traceStore: deps.traceRepo ? 'postgres' : 'disabled',
    upstreams,
    cache: deps.cache.stats(),
  });
};
