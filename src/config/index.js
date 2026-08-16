const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { z } = require('zod');

const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');

const registrySchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    source: z.enum(['kundli', 'horoscope', 'panchang']),
    path: z.string().min(1),
    render: z.string().min(1),
    estTokens: z.number().int().positive(),
  })).min(1),
});

const intentSchema = z.object({
  match: z.object({
    keywords: z.array(z.string()),
    patterns: z.array(z.string()),
  }),
  primary: z.array(z.string()),
  secondary: z.array(z.string()),
  exclude: z.array(z.string()),
});

const intentsSchema = z.object({
  threshold: z.number().min(0).max(1),
  intents: z.record(z.string(), intentSchema),
});

const personalizationSchema = z.object({
  tone: z.record(z.string(), z.string()),
  language: z.record(z.string(), z.string()),
  length: z.record(z.string(), z.number().int().positive()),
  defaults: z.object({
    language: z.string(),
    tone: z.string(),
    subscription: z.string(),
  }),
});

const confidenceSchema = z.object({
  weights: z.object({
    intentConfidence: z.number(),
    primaryCoverage: z.number(),
    sourceHealth: z.number(),
  }),
  intentScoreByMethod: z.object({ rule: z.number(), fallback: z.number() }),
  sourceHealthScore: z.object({ fresh: z.number(), stale: z.number(), missing: z.number() }),
  caps: z.object({
    fallbackIntent: z.number(),
    insufficient: z.number(),
    noPrimaryCoverage: z.number(),
  }),
  bands: z.object({ high: z.number(), medium: z.number() }),
});

const servicesSchema = z.object({
  budgetTokens: z.number().int().positive(),
  escalation: z.object({ enabled: z.boolean() }),
  services: z.record(z.string(), z.object({
    path: z.string(),
    timeoutMs: z.number().int().positive(),
    retries: z.number().int().min(0),
    backoffMs: z.number().int().min(0),
    cacheTtlMs: z.number().int().min(0),
    cacheStaleMaxMs: z.number().int().min(0),
  })),
});

function readYaml(name) {
  const file = path.join(CONFIG_DIR, `${name}.yaml`);
  try {
    return yaml.load(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`failed to read config/${name}.yaml: ${err.message}`);
  }
}

function parseOrThrow(schema, value, name) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`invalid config/${name}.yaml at '${issue.path.join('.')}': ${issue.message}`);
  }
  return result.data;
}

/**
 * Cross-file checks a per-file schema cannot express. This is what makes a
 * config-driven engine safe rather than a footgun: a typo'd context ID fails
 * at boot with a readable message, not silently at request time.
 */
function validateConfig(cfg) {
  const ids = new Set();
  for (const item of cfg.registry.items) {
    if (ids.has(item.id)) throw new Error(`duplicate context id '${item.id}' in registry.yaml`);
    ids.add(item.id);
  }

  for (const [name, intent] of Object.entries(cfg.intents.intents)) {
    for (const key of ['primary', 'secondary', 'exclude']) {
      for (const id of intent[key]) {
        if (!ids.has(id)) {
          throw new Error(`unknown context id '${id}' in intents.${name}.${key}`);
        }
      }
    }
  }

  if (!cfg.intents.intents.general) {
    throw new Error("intents.yaml must define a 'general' intent as the fallback");
  }

  const tones = new Set(Object.keys(cfg.personalization.tone));
  if (!tones.has(cfg.personalization.defaults.tone)) {
    throw new Error(`defaults.tone '${cfg.personalization.defaults.tone}' is not a defined tone`);
  }

  return cfg;
}

let cached = null;

function loadConfig({ force = false } = {}) {
  if (cached && !force) return cached;
  const cfg = {
    registry: parseOrThrow(registrySchema, readYaml('registry'), 'registry'),
    intents: parseOrThrow(intentsSchema, readYaml('intents'), 'intents'),
    personalization: parseOrThrow(personalizationSchema, readYaml('personalization'), 'personalization'),
    confidence: parseOrThrow(confidenceSchema, readYaml('confidence'), 'confidence'),
    services: parseOrThrow(servicesSchema, readYaml('services'), 'services'),
  };
  cached = validateConfig(cfg);
  return cached;
}

module.exports = { loadConfig, validateConfig };
