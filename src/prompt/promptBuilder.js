// Receives ONLY resolved+rendered items. The fetched payload is deliberately
// out of scope here, so excluded context is unreachable rather than merely unused.

const SYSTEM_TEMPLATE = `You are an astrology guidance assistant for MyNaksh.

GROUNDING
- Use ONLY the context provided in the user message.
- Never invent placements, dashas, nakshatras, or dates.
- If the context is insufficient to answer well, say so plainly and set sufficient=false.
- Never mention that any context was withheld or excluded.

STYLE
- Language: {languageName}
- Tone: {toneInstruction}
- Length: at most {maxWords} words.

OUTPUT
Return JSON with keys: answer (string), sourcesUsed (array of the exact bracketed
labels you relied on), sufficient (boolean), missingInfo (string or null).`;

function buildPrompt({ selected, persona, question }) {
  const system = SYSTEM_TEMPLATE
    .replace('{languageName}', persona.languageName)
    .replace('{toneInstruction}', persona.toneInstruction)
    .replace('{maxWords}', String(persona.maxWords));

  const contextBlock = selected.length
    ? selected.map((s) => `[${s.label}] ${s.text}`).join('\n')
    : '(no context available)';

  const user = `QUESTION: ${question}\n\nCONTEXT:\n${contextBlock}`;

  const chars = system.length + user.length;
  return { system, user, chars, estTokens: Math.ceil(chars / 4) };
}

/**
 * The model may only credit sources that were actually sent. Anything else is
 * dropped and reported. An empty intersection falls back to the primary labels
 * so the client never receives an empty sourcesUsed for an answered question.
 */
function validateSources(claimed, selected, primaryLabels) {
  const sent = new Set(selected.map((s) => s.label));
  const list = Array.isArray(claimed) ? claimed : [];

  const sourcesUsed = list.filter((label) => sent.has(label));
  const hallucinated = list.filter((label) => !sent.has(label));

  if (sourcesUsed.length === 0) {
    const fallback = primaryLabels.filter((label) => sent.has(label));
    return { sourcesUsed: fallback, hallucinated, fellBack: true };
  }
  return { sourcesUsed, hallucinated, fellBack: false };
}

module.exports = { buildPrompt, validateSources };
