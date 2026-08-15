// Pure. No I/O, no imports from gateway/llm/store.

/**
 * confidence = 0.4*intent + 0.4*primaryCoverage + 0.2*sourceHealth, then capped.
 * Weights, caps and band thresholds all live in config/confidence.yaml.
 * Returns the contributing factors so every band has a recorded reason.
 */
function computeConfidence({ intentMethod, intentScore, primaryCoverage, sourceStates, sufficient }, cfg) {
  const intentConfidence = intentMethod === 'llm'
    ? intentScore
    : cfg.intentScoreByMethod[intentMethod] ?? intentScore;

  const states = Object.values(sourceStates || {});
  const sourceHealth = states.length === 0
    ? 1
    : states.reduce((a, s) => a + (cfg.sourceHealthScore[s] ?? 0), 0) / states.length;

  const w = cfg.weights;
  let score = w.intentConfidence * intentConfidence
    + w.primaryCoverage * primaryCoverage
    + w.sourceHealth * sourceHealth;

  const caps = [];
  const applyCap = (name, limit) => {
    if (score > limit) { score = limit; caps.push(name); }
  };

  if (intentMethod === 'fallback') applyCap('fallbackIntent', cfg.caps.fallbackIntent);
  if (sufficient === false) applyCap('insufficient', cfg.caps.insufficient);
  if (primaryCoverage === 0) applyCap('noPrimaryCoverage', cfg.caps.noPrimaryCoverage);

  const band = score >= cfg.bands.high ? 'HIGH' : score >= cfg.bands.medium ? 'MEDIUM' : 'LOW';

  return {
    band,
    score: Number(score.toFixed(3)),
    factors: { intentConfidence, primaryCoverage, sourceHealth },
    caps,
  };
}

module.exports = { computeConfidence };
