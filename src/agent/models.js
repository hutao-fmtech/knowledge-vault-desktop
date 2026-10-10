'use strict';

/**
 * Single source of truth for model routes used by the app.
 * DEFAULT_MODEL must be one of the deepseek-official catalog ids
 * (dsh-llm-deepseek DEFAULT_MODELS: deepseek-flash, deepseek-v4-pro).
 */
const LIVE_PROVIDER = 'deepseek-official';
const MOCK_PROVIDER = 'kvd-mock';
const MOCK_MODEL = 'mock';
const APP_MODELS = Object.freeze(['deepseek-flash', 'deepseek-v4-pro']);
const DEFAULT_MODEL = APP_MODELS[0];

module.exports = { LIVE_PROVIDER, MOCK_PROVIDER, MOCK_MODEL, APP_MODELS, DEFAULT_MODEL };
