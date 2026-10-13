'use strict';

/**
 * Advanced-mode tool-call log (AC-11c, AC-14).
 *
 * One JSON object per line in `<app config dir>/logs/tool-calls.jsonl` —
 * never inside the vault. Every record passes through `redact()`, which
 * removes the live API key (exact match), anything that looks like a DeepSeek
 * / bearer secret, and values under secret-looking property names. The log
 * never receives the key from us; redaction is defense in depth against a
 * model echoing a secret into tool arguments or output.
 */
const fs = require('fs');
const path = require('path');

const MAX_FIELD_CHARS = 8000;
const SECRET_KEY_RE = /(api[_-]?key|authorization|secret|token|password|DEEPSEEK_API_KEY|KVD_DSH_API_KEY)/i;
const SECRET_VALUE_RES = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
];
const REDACTED = '[REDACTED]';

function redactString(s, secrets) {
  let out = String(s);
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join(REDACTED);
  }
  for (const re of SECRET_VALUE_RES) out = out.replace(re, REDACTED);
  if (out.length > MAX_FIELD_CHARS) out = `${out.slice(0, MAX_FIELD_CHARS)}…[truncated ${out.length - MAX_FIELD_CHARS} chars]`;
  return out;
}

function redact(value, secrets = [], depth = 0) {
  if (depth > 12) return '[depth-limit]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redact(v, secrets, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY_RE.test(k) && typeof v === 'string' ? REDACTED : redact(v, secrets, depth + 1);
    }
    return out;
  }
  return redactString(String(value), secrets);
}

/**
 * @param {{ dir: string, getSecrets?: () => (string|null|undefined)[], now?: () => Date }} opts
 */
function createToolLog({ dir, getSecrets = () => [], now = () => new Date() }) {
  const file = path.join(dir, 'tool-calls.jsonl');
  function append(record) {
    const secrets = (getSecrets() || []).filter(Boolean).map(String);
    const line = JSON.stringify(redact({ time: now().toISOString(), ...record }, secrets));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(file, line + '\n', { mode: 0o600 });
    return line;
  }
  function read() {
    try {
      return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }
  return { file, append, read };
}

module.exports = { createToolLog, redact, REDACTED };
