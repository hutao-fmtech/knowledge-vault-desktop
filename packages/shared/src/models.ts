/**
 * Single source of truth for model routes used by the app.
 * DEFAULT_MODEL must be one of the deepseek-official catalog ids
 * (dsh-llm-deepseek DEFAULT_MODELS: deepseek-flash, deepseek-v4-pro).
 */
export const LIVE_PROVIDER = 'deepseek-official';
export const MOCK_PROVIDER = 'kvd-mock';
export const MOCK_MODEL = 'mock';
export const APP_MODELS = Object.freeze(['deepseek-flash', 'deepseek-v4-pro'] as const);
export type AppModel = (typeof APP_MODELS)[number];
export const DEFAULT_MODEL: AppModel = APP_MODELS[0];
