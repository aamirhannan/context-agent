const { UpstreamError } = require('../errors');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries on 5xx and timeouts with jittered backoff. Never retries a 4xx —
 * a 404 will still be a 404 on the third attempt.
 */
async function fetchWithPolicy(url, { timeoutMs, retries, backoffMs }) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });

      if (res.status >= 400 && res.status < 500) {
        throw new UpstreamError(`${url} returned ${res.status}`, { status: res.status, retryable: false });
      }
      if (!res.ok) {
        throw new UpstreamError(`${url} returned ${res.status}`, { status: res.status, retryable: true });
      }
      return await res.json();
    } catch (err) {
      lastError = err;
      const retryable = err.details?.retryable !== false;
      if (!retryable || attempt === retries) break;
      await sleep(backoffMs * (attempt + 1) + Math.floor(Math.random() * backoffMs));
    }
  }

  if (lastError instanceof UpstreamError) throw lastError;
  throw new UpstreamError(`${url} failed: ${lastError?.message || 'unknown error'}`, { retryable: true });
}

module.exports = { fetchWithPolicy };
