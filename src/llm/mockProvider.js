// A first-class implementation, not a stub: deterministic, offline, and
// contract-identical to openaiProvider so every test can run with no API key.

const LABEL_RE = /^\[([^\]]+)\]\s*(.*)$/;

function parseContext(user) {
  const [, contextBlock = ''] = user.split('CONTEXT:\n');
  return contextBlock
    .split('\n')
    .map((line) => line.match(LABEL_RE))
    .filter(Boolean)
    .map((m) => ({ label: m[1], text: m[2] }));
}

async function generate({ system, user }, { maxWords }) {
  const started = Date.now();
  const items = parseContext(user);
  const question = (user.match(/QUESTION: (.*)/) || [, ''])[1];

  if (items.length === 0) {
    return {
      answer: 'I could not access enough of your chart to answer this reliably right now. Please try again shortly.',
      sourcesUsed: [],
      sufficient: false,
      missingInfo: 'no context items were available',
      model: 'mock-1',
      latencyMs: Date.now() - started,
    };
  }

  const body = [
    `Regarding "${question}" —`,
    ...items.map((i) => `${i.label} indicates: ${i.text}.`),
    'Weigh these signals together and act deliberately rather than abruptly.',
  ].join(' ');

  const words = body.split(/\s+/);
  const answer = words.length > maxWords ? words.slice(0, maxWords).join(' ') : body;

  return {
    answer,
    sourcesUsed: items.map((i) => i.label),
    sufficient: true,
    missingInfo: null,
    model: 'mock-1',
    latencyMs: Date.now() - started,
  };
}

// Deterministic keyword lean so the fallback tier is demonstrable offline.
async function classifyIntent(question, intentNames) {
  const lower = question.toLowerCase();
  const leanings = [
    ['career', ['job', 'work', 'career', 'promotion']],
    ['relationship', ['partner', 'love', 'marriage', 'relationship']],
    ['health', ['health', 'sleep', 'rest', 'energy', 'fitness']],
    ['finance', ['money', 'invest', 'wealth', 'savings']],
    ['daily_summary', ['today', 'week', 'summar', 'prioriti', 'focus']],
  ];
  // Leading word boundary, not substring: bare `includes` matched 'rest' inside
  // "interesting" and classified it as health. A trailing boundary is deliberately
  // omitted so stems like 'summar' still match "summarize".
  const mentions = (w) => new RegExp(`\\b${w}`, 'i').test(lower);

  // Score every lean and take the winner, rather than returning the first match —
  // first-match-wins made the answer depend on the order of this array.
  const scored = leanings
    .filter(([intent]) => intentNames.includes(intent))
    .map(([intent, words]) => ({ intent, hits: words.filter(mentions).length }))
    .filter((s) => s.hits > 0);

  if (scored.length === 0) return { intent: 'general', score: 0.55 };

  const top = Math.max(...scored.map((s) => s.hits));
  const leaders = scored.filter((s) => s.hits === top);

  // Still ambiguous after scoring: 'general' is the safe answer, since it pulls
  // every available context item rather than committing to the wrong domain.
  if (leaders.length > 1) return { intent: 'general', score: 0.5 };

  return { intent: leaders[0].intent, score: 0.75 };
}

module.exports = { name: 'mock', generate, classifyIntent };
