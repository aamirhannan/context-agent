const { z } = require('zod');
const { fetchWithPolicy } = require('./httpClient');

const today = () => new Date().toISOString().slice(0, 10);

// Upstreams are a trust boundary too. A malformed payload degrades cleanly
// instead of interpolating `undefined` into a prompt.
const schemas = {
  user: z.object({ id: z.string() }).passthrough(),
  kundli: z.object({ lagna: z.string() }).passthrough(),
  horoscope: z.object({}).passthrough(),
  panchang: z.object({ tithi: z.string() }).passthrough(),
};

const CONTEXT_SOURCES = ['kundli', 'horoscope', 'panchang'];

function cacheKey(service, userId) {
  if (service === 'panchang') return `panchang:${today()}`;          // global, not per user
  if (service === 'horoscope') return `horoscope:${userId}:${today()}`;
  return `${service}:${userId}`;
}

async function fetchOne(service, userId, { cache, servicesConfig, baseUrl }) {
  const cfg = servicesConfig[service];
  const key = cacheKey(service, userId);

  const cached = cache.get(key);
  if (cached?.fresh) return { service, value: cached.value, state: 'fresh' };

  const url = baseUrl + cfg.path.replace('{userId}', encodeURIComponent(userId));

  try {
    const raw = await fetchWithPolicy(url, cfg);
    const value = schemas[service].parse(raw);
    cache.set(key, value, cfg.cacheTtlMs, cfg.cacheStaleMaxMs);
    return { service, value, state: 'fresh' };
  } catch (err) {
    if (cached) return { service, value: cached.value, state: 'stale', error: err }; // stale-while-error
    return { service, value: null, state: 'missing', error: err };
  }
}

/** Concurrent fan-out. One failing service never prevents the others. */
async function fetchAll(userId, deps) {
  const services = Object.keys(deps.servicesConfig);

  const settled = await Promise.allSettled(
    services.map((service) => fetchOne(service, userId, deps)),
  );

  const bundle = {};
  const sourceStates = {};
  const degradations = [];
  let userMissing = false;

  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      degradations.push(`unexpected failure: ${outcome.reason?.message}`);
      continue;
    }
    const { service, value, state, error } = outcome.value;

    if (value != null) bundle[service] = value;
    if (CONTEXT_SOURCES.includes(service)) sourceStates[service] = state;

    if (state !== 'fresh') {
      degradations.push(`${service}: ${state}${error ? ` (${error.message})` : ''}`);
    }
    if (service === 'user' && state === 'missing' && error?.details?.status === 404) {
      userMissing = true;
    }
  }

  return { bundle, sourceStates, degradations, userMissing };
}

module.exports = { fetchAll, cacheKey };
