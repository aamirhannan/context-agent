// Pure. No I/O, no imports from gateway/llm/store.

/**
 * Turn a user profile into response configuration.
 * A null profile (User service unreachable) yields defaults with usedDefaults=true,
 * which Task 6 folds into the confidence score.
 */
function resolvePersona(userProfile, cfg) {
  const profile = userProfile || {};
  let usedDefaults = !userProfile;

  const langKey = cfg.language[profile.language] ? profile.language : cfg.defaults.language;
  if (langKey !== profile.language) usedDefaults = true;

  const toneKey = cfg.tone[profile.tonePreference] ? profile.tonePreference : cfg.defaults.tone;
  if (toneKey !== profile.tonePreference) usedDefaults = true;

  const subKey = cfg.length[profile.subscription] != null ? profile.subscription : cfg.defaults.subscription;
  if (subKey !== profile.subscription) usedDefaults = true;

  return {
    language: langKey,
    languageName: cfg.language[langKey],
    tone: toneKey,
    toneInstruction: cfg.tone[toneKey],
    maxWords: cfg.length[subKey],
    usedDefaults,
  };
}

module.exports = { resolvePersona };
