// Pure. No I/O, no imports from gateway/llm/store.

function getPath(obj, dottedPath) {
  if (dottedPath === '.') return obj;
  return dottedPath.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function buildRegistry(registryConfig) {
  return new Map(registryConfig.items.map((item) => [item.id, item]));
}

/**
 * Resolve one registry entry against a fetched bundle and render it to text.
 * Returns null if the source is absent, the path is absent, or any render
 * variable is missing — a partially rendered line is worse than no line.
 */
function resolveItem(entry, bundle) {
  if (!entry) return null;
  const sourceData = bundle[entry.source];
  if (sourceData == null) return null;

  const raw = getPath(sourceData, entry.path);
  if (raw == null) return null;

  const vars = typeof raw === 'object' ? raw : { value: raw };

  let missing = false;
  const text = entry.render.replace(/\{(\w+)\}/g, (_match, key) => {
    if (vars[key] == null) { missing = true; return ''; }
    return String(vars[key]);
  });
  if (missing) return null;

  return { id: entry.id, label: entry.label, text, estTokens: entry.estTokens };
}

/** Total tokens if every resolvable item were sent — the denominator for reductionPct. */
function availableTokens(registry, bundle) {
  let total = 0;
  for (const entry of registry.values()) {
    const item = resolveItem(entry, bundle);
    if (item) total += item.estTokens;
  }
  return total;
}

module.exports = { buildRegistry, resolveItem, availableTokens, getPath };
