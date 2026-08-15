const OpenAI = require('openai');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

let client = null;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    sourcesUsed: { type: 'array', items: { type: 'string' } },
    sufficient: { type: 'boolean' },
    missingInfo: { type: ['string', 'null'] },
  },
  required: ['answer', 'sourcesUsed', 'sufficient', 'missingInfo'],
  additionalProperties: false,
};

async function generate({ system, user }) {
  const started = Date.now();
  const res = await getClient().chat.completions.create({
    model: MODEL,
    temperature: 0.6,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'grounded_answer', strict: true, schema: ANSWER_SCHEMA },
    },
  });

  const parsed = JSON.parse(res.choices[0].message.content);
  return { ...parsed, model: MODEL, latencyMs: Date.now() - started };
}

const INTENT_SCHEMA = {
  type: 'object',
  properties: { intent: { type: 'string' }, score: { type: 'number' } },
  required: ['intent', 'score'],
  additionalProperties: false,
};

async function classifyIntent(question, intentNames) {
  const res = await getClient().chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: `Classify the user's astrology question into exactly one of: ${intentNames.join(', ')}. Score is your confidence from 0 to 1.` },
      { role: 'user', content: question },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'intent_classification', strict: true, schema: INTENT_SCHEMA },
    },
  });
  return JSON.parse(res.choices[0].message.content);
}

module.exports = { name: 'openai', generate, classifyIntent };
