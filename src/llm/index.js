// The only place a concrete provider is named. Nothing downstream imports
// 'openai' or any provider-specific type — swapping providers is one env var.
function getProvider() {
  if (process.env.LLM_PROVIDER === 'openai') return require('./openaiProvider');
  return require('./mockProvider');
}

module.exports = { getProvider };
