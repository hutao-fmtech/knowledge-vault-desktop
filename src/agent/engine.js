'use strict';

/**
 * Default-mode Agent engines — thin facades over skills-logic (A1/A2/A3).
 *
 * Live path: stream via dsh-runtime (Cordis + dsh-llm).
 * Mock path: same skills-logic with style:'mock' (Cordis uses kvd-llm-mock adapter).
 * Prefer ctx.kvdSkills from the composition root for default-mode IPC.
 */

const { searchVault, listInboxNotes } = require('./search');
const { proposeCreate, proposeMove } = require('./proposals');
const { resolveVaultPath } = require('./paths');
const { streamText } = require('./dsh-runtime');
const {
  createSkillsEngine,
  pickParaDest,
  cardType,
  slugify,
  SYSTEM,
} = require('./skills-logic');

function createMockEngine() {
  return createSkillsEngine(
    {
      style: 'mock',
      hasKey: false,
      backend: 'mock',
      search: searchVault,
      resolve: resolveVaultPath,
      proposeMove,
      proposeCreate,
    },
    { id: 'mock', backend: 'mock' },
  );
}

function createDeepSeekEngine(getApiKey) {
  return createSkillsEngine(
    {
      style: 'live',
      hasKey: () => !!getApiKey(),
      backend: 'dsh-llm',
      provider: 'deepseek-official',
      search: searchVault,
      resolve: resolveVaultPath,
      proposeMove,
      proposeCreate,
      streamText: async ({ system, user, model }) =>
        streamText({
          apiKey: getApiKey(),
          system,
          user,
          model: model || 'deepseek-flash',
        }),
    },
    { id: 'dsh-llm-model-only', backend: 'dsh-llm' },
  );
}

module.exports = {
  createMockEngine,
  createDeepSeekEngine,
  listInboxNotes,
  searchVault,
  // shared helpers (tests / plugins)
  pickParaDest,
  cardType,
  slugify,
  SYSTEM,
};
