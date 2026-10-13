'use strict';

const RESERVED = new Set(
  [
    'CON', 'PRN', 'AUX', 'NUL',
    ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
    ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
  ]
);

/**
 * Cross-platform vault folder name sanitize (M0 locked).
 * alphanumeric + _- ; spaces → _; strip other chars; length 1–64.
 * @param {string} raw
 * @returns {{ ok: true, name: string } | { ok: false, error: string }}
 */
function sanitizeVaultName(raw) {
  if (raw == null || typeof raw !== 'string') {
    return { ok: false, error: '请输入知识库名称' };
  }
  let s = raw.trim().replace(/\s+/g, '_');
  s = s.replace(/[^A-Za-z0-9_-]/g, '');
  s = s.replace(/_+/g, '_');
  if (!s || s === '_' || s === '-') {
    return { ok: false, error: '名称无效：请使用字母、数字、下划线或连字符（空格会变成 _）' };
  }
  if (s === '.' || s === '..') {
    return { ok: false, error: '名称无效' };
  }
  if (RESERVED.has(s.toUpperCase())) {
    return { ok: false, error: `名称「${s}」为系统保留名，请换一个` };
  }
  if (s.length > 64) {
    return { ok: false, error: '名称过长：最多 64 个字符' };
  }
  return { ok: true, name: s };
}

module.exports = { sanitizeVaultName, RESERVED };
