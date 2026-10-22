/**
 * kvd-agent-log — append-only audit log of the proposal lifecycle (+ write pause).
 *
 *   <vault>/.vault/agent-log/YYYY-MM-DD.<deviceId>.jsonl
 *
 * Privacy by construction: every record is rebuilt from a field ALLOWLIST with
 * per-field validators. Note content, model summaries, prompts and keys have no
 * field to live in — unknown keys are dropped, and a value that does not match
 * its validator (or looks like a secret) drops the field. Only vault-relative
 * paths, sha256 hashes, sizes and short error codes are stored.
 *
 * Best effort: append / read / prune never throw into callers (AL-5); failures
 * are reported through `onWarn` and Apply results are never affected.
 *
 * Pure package (Node builtins only). Not mounted or wired into proposals yet.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 1;
export const LOG_DIR_REL = '.vault/agent-log';
export const DEFAULT_RETENTION_DAYS = 90;

/** The only events that exist. */
export const EVENTS = Object.freeze([
  'proposal.created',
  'proposal.applied',
  'proposal.apply_failed',
  'proposal.rejected',
  'proposal.expired',
  'pause.on',
  'pause.off',
] as const);
export type AgentLogEventName = (typeof EVENTS)[number];

export type ProposalKind = 'create' | 'edit' | 'move';
export type Actor = 'user' | 'agent' | 'system';

/** One stored line. Everything except v/ts/ev is optional. */
export interface AgentLogRecord {
  v: typeof SCHEMA_VERSION;
  ts: string;
  ev: AgentLogEventName;
  id?: string;
  kind?: ProposalKind;
  path?: string;
  from?: string;
  to?: string;
  origin?: string;
  actor?: Actor;
  beforeSha256?: string;
  afterSha256?: string;
  bytes?: number;
  stale?: boolean;
  error?: string;
  app?: string;
}

/** What callers pass in (ts / v are filled in; unknown keys are ignored). */
export type AgentLogInput = Partial<Omit<AgentLogRecord, 'v' | 'ts' | 'ev'>> & { ev: string } & Record<string, unknown>;

// ---- validators (allowlist) ----
const SECRET_RES = [/sk-[A-Za-z0-9_-]{8,}/, /Bearer\s+\S{8,}/i, /api[_-]?key/i, /DEEPSEEK_API_KEY/];
const SHA_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const ORIGIN_RE = /^[a-z][a-z0-9-]{0,31}(?::[A-Za-z0-9_.-]{1,48})?$/;
const ERROR_RE = /^[a-z][a-z0-9_.-]{0,39}$/;
const APP_RE = /^[0-9A-Za-z.+-]{1,32}$/;
const MAX_PATH = 512;

function looksSecret(s: string): boolean {
  return SECRET_RES.some((re) => re.test(s));
}

/** Vault-relative path, normalised to `/`. Rejects absolute, `..`, control chars, overlong. */
export function normalizeRelPath(p: unknown): string | undefined {
  if (typeof p !== 'string') return undefined;
  const rel = p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
  if (!rel || rel.length > MAX_PATH) return undefined;
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return undefined;
  if (rel.split('/').some((seg) => seg === '..' || seg === '')) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(rel) || looksSecret(rel)) return undefined;
  return rel;
}

function str(re: RegExp, v: unknown): string | undefined {
  return typeof v === 'string' && re.test(v) && !looksSecret(v) ? v : undefined;
}

/** Error is a short code (e.g. `stale`, `write_paused`); free text is reduced to `other`. */
export function normalizeErrorCode(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return ERROR_RE.test(s) && !looksSecret(s) ? s : 'other';
}

/**
 * Rebuild a record from the allowlist. Returns null when `ev` is not a known event.
 * Nothing outside the declared fields can reach disk.
 */
export function sanitizeRecord(input: AgentLogInput | null | undefined, ts: string, app?: string): AgentLogRecord | null {
  if (!input || !(EVENTS as readonly string[]).includes(input.ev)) return null;
  const out: AgentLogRecord = { v: SCHEMA_VERSION, ts, ev: input.ev as AgentLogEventName };
  const id = str(ID_RE, input.id);
  if (id) out.id = id;
  if (input.kind === 'create' || input.kind === 'edit' || input.kind === 'move') out.kind = input.kind;
  for (const k of ['path', 'from', 'to'] as const) {
    const p = normalizeRelPath(input[k]);
    if (p) out[k] = p;
  }
  const origin = str(ORIGIN_RE, input.origin);
  if (origin) out.origin = origin;
  if (input.actor === 'user' || input.actor === 'agent' || input.actor === 'system') out.actor = input.actor;
  for (const k of ['beforeSha256', 'afterSha256'] as const) {
    const h = typeof input[k] === 'string' ? (input[k] as string).toLowerCase() : undefined;
    if (h && SHA_RE.test(h)) out[k] = h;
  }
  if (typeof input.bytes === 'number' && Number.isSafeInteger(input.bytes) && input.bytes >= 0) out.bytes = input.bytes;
  if (typeof input.stale === 'boolean') out.stale = input.stale;
  const error = normalizeErrorCode(input.error);
  if (error) out.error = error;
  const appV = str(APP_RE, app ?? input.app);
  if (appV) out.app = appV;
  return out;
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// ---- time: local wall clock with explicit offset (e.g. +08:00) ----
function pad(n: number, w = 2): string {
  return String(Math.trunc(Math.abs(n))).padStart(w, '0');
}

/** ISO timestamp in the given UTC offset (minutes east), e.g. 2026-10-22T09:00:00.000+08:00. */
export function isoWithOffset(d: Date, offsetMinutes: number): string {
  const local = new Date(d.getTime() + offsetMinutes * 60_000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const off = `${sign}${pad(Math.abs(offsetMinutes) / 60)}:${pad(Math.abs(offsetMinutes) % 60)}`;
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}.${pad(local.getUTCMilliseconds(), 3)}${off}`;
}

/** Calendar day (YYYY-MM-DD) of `d` in the given UTC offset. */
export function dayKey(d: Date, offsetMinutes: number): string {
  return isoWithOffset(d, offsetMinutes).slice(0, 10);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const DEVICE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_RE = /^(\d{4}-\d{2}-\d{2})\.([A-Za-z0-9_-]{1,64})\.jsonl$/;

export function isValidDeviceId(id: unknown): id is string {
  return typeof id === 'string' && DEVICE_RE.test(id);
}

/**
 * Stable per-install device id kept in the app config dir (outside the vault).
 * Created on first use; never throws (falls back to an in-memory id).
 */
export function loadOrCreateDeviceId(file: string): string {
  try {
    const cur = fs.readFileSync(file, 'utf8').trim();
    if (isValidDeviceId(cur)) return cur;
  } catch {
    /* create below */
  }
  const id = crypto.randomBytes(6).toString('hex');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, id, { mode: 0o600 });
  } catch {
    /* in-memory only */
  }
  return id;
}

export interface AgentLogOptions {
  /** Current vault root; null → nothing is logged. */
  getVaultRoot: () => string | null | undefined;
  deviceId: string;
  /** App version stamped on every line. */
  app?: string;
  now?: () => Date;
  /** Minutes east of UTC for `ts` and day files. Default: this machine's local offset. */
  utcOffsetMinutes?: number;
  retentionDays?: number;
  onWarn?: (msg: string) => void;
}

export interface AgentLog {
  /** Append one event. Returns the stored record, or null (invalid / no vault / write failed). Never throws. */
  append(input: AgentLogInput): AgentLogRecord | null;
  /** All records of one day (every device), sorted by ts. Corrupt lines are skipped. Never throws. */
  readDay(day: string): AgentLogRecord[];
  /** Days that have at least one log file, ascending. */
  listDays(): string[];
  /** Delete day files older than the retention window. Returns files removed. Never throws. */
  prune(): number;
  /** Absolute log dir for the current vault (null without a vault). */
  dir(): string | null;
}

export function createAgentLog(opts: AgentLogOptions): AgentLog {
  if (!isValidDeviceId(opts.deviceId)) throw new Error('agent-log: invalid deviceId');
  const now = opts.now ?? (() => new Date());
  const offset = (): number => opts.utcOffsetMinutes ?? -now().getTimezoneOffset();
  const retention = Math.max(1, Math.trunc(opts.retentionDays ?? DEFAULT_RETENTION_DAYS));
  const warn = (msg: string): void => {
    try {
      (opts.onWarn ?? ((m: string) => console.warn(m)))(`[agent-log] ${msg}`);
    } catch {
      /* never throw */
    }
  };

  function dir(): string | null {
    try {
      const root = opts.getVaultRoot();
      return root ? path.join(root, ...LOG_DIR_REL.split('/')) : null;
    } catch {
      return null;
    }
  }

  function append(input: AgentLogInput): AgentLogRecord | null {
    try {
      const d = dir();
      if (!d) return null;
      const at = now();
      const rec = sanitizeRecord(input, isoWithOffset(at, offset()), opts.app);
      if (!rec) {
        warn(`dropped unknown event ${String(input && input.ev).slice(0, 40)}`);
        return null;
      }
      fs.mkdirSync(d, { recursive: true, mode: 0o700 });
      fs.appendFileSync(path.join(d, `${dayKey(at, offset())}.${opts.deviceId}.jsonl`), `${JSON.stringify(rec)}\n`, { mode: 0o600 });
      return rec;
    } catch (err) {
      warn(`append failed: ${(err as NodeJS.ErrnoException)?.code || 'error'}`);
      return null;
    }
  }

  function files(): { name: string; day: string }[] {
    const d = dir();
    if (!d) return [];
    try {
      return fs
        .readdirSync(d)
        .map((name) => ({ name, m: FILE_RE.exec(name) }))
        .filter((x): x is { name: string; m: RegExpExecArray } => !!x.m)
        .map((x) => ({ name: x.name, day: x.m[1]! }));
    } catch {
      return [];
    }
  }

  function readDay(day: string): AgentLogRecord[] {
    if (!DAY_RE.test(day)) return [];
    const d = dir();
    if (!d) return [];
    const out: AgentLogRecord[] = [];
    for (const f of files().filter((x) => x.day === day)) {
      let text = '';
      try {
        text = fs.readFileSync(path.join(d, f.name), 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as AgentLogInput & { ts?: unknown };
          const rec = typeof parsed.ts === 'string' && TS_RE.test(parsed.ts) ? sanitizeRecord(parsed, parsed.ts) : null;
          if (rec) out.push(rec);
        } catch {
          /* half-written line: skip */
        }
      }
    }
    return out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  }

  function listDays(): string[] {
    return [...new Set(files().map((f) => f.day))].sort();
  }

  function prune(): number {
    const d = dir();
    if (!d) return 0;
    const cutoff = dayKey(new Date(now().getTime() - retention * 86_400_000), offset());
    let removed = 0;
    for (const f of files()) {
      if (f.day >= cutoff) continue;
      try {
        fs.unlinkSync(path.join(d, f.name));
        removed += 1;
      } catch (err) {
        warn(`prune failed: ${(err as NodeJS.ErrnoException)?.code || 'error'}`);
      }
    }
    return removed;
  }

  return { append, readDay, listDays, prune, dir };
}
