// Pure. No I/O, no imports from gateway/llm/store.
const { resolveItem, availableTokens } = require('./contextRegistry');

/**
 * selected = (primary ∪ secondary) − exclude
 *
 * Exclude always wins. Primary is never dropped for budget — missing primary
 * is a confidence signal (Task 6), not a budgeting one.
 */
function selectContext({ intentConfig, registry, bundle, budgetTokens }) {
  const excludeIds = new Set(intentConfig.exclude);
  const primaryIds = intentConfig.primary.filter((id) => !excludeIds.has(id));
  const secondaryIds = intentConfig.secondary.filter(
    (id) => !excludeIds.has(id) && !primaryIds.includes(id),
  );

  const excluded = [];
  const notSelected = [];
  const unavailable = [];

  const resolve = (id) => {
    const entry = registry.get(id);
    const item = resolveItem(entry, bundle);
    if (!item) unavailable.push({ id, label: entry.label, source: entry.source });
    return item;
  };

  const primary = primaryIds.map(resolve).filter(Boolean);
  const secondary = secondaryIds.map(resolve).filter(Boolean);

  const primaryCoverage = primaryIds.length === 0 ? 1 : primary.length / primaryIds.length;

  // Budget: primary is protected; trim the secondary tail until it fits.
  let sent = primary.reduce((a, s) => a + s.estTokens, 0);
  const keptSecondary = [];
  for (const item of secondary) {
    if (sent + item.estTokens <= budgetTokens) {
      keptSecondary.push(item);
      sent += item.estTokens;
    } else {
      notSelected.push({ id: item.id, label: item.label, reason: 'budget' });
    }
  }

  const selected = [...primary, ...keptSecondary];
  const selectedIds = new Set(selected.map((s) => s.id));

  // Deliberate exclusions — the contrastive list the debug endpoint reports.
  for (const id of intentConfig.exclude) {
    const entry = registry.get(id);
    excluded.push({ id, label: entry.label, reason: 'intent_rule' });
  }

  // Everything else: the implicit remainder, reported in detail only.
  for (const entry of registry.values()) {
    if (selectedIds.has(entry.id) || excludeIds.has(entry.id)) continue;
    if (notSelected.some((n) => n.id === entry.id)) continue;
    const isUnavailable = unavailable.some((u) => u.id === entry.id);
    notSelected.push({
      id: entry.id,
      label: entry.label,
      reason: isUnavailable ? 'upstream_unavailable' : 'not_relevant',
    });
  }

  const available = availableTokens(registry, bundle);

  return {
    selected,
    excluded,
    notSelected,
    unavailable,
    primaryCoverage,
    budget: {
      available,
      sent,
      reductionPct: available === 0 ? 0 : Math.round((1 - sent / available) * 100),
    },
  };
}

module.exports = { selectContext };
