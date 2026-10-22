/**
 * Global write pause (spec R2) + Apply origin rule (spec R1).
 *
 *   writePaused  boolean in the app config prefs.json (outside the vault —
 *                never a note file, so the agent cannot lift it by editing notes).
 *
 * Rules:
 *   - Anyone / any origin may turn the pause ON (it only removes capability).
 *   - Turning it OFF requires a LOCAL origin: a manual click in the desktop
 *     renderer. Agent, tool layer and remote channels are rejected.
 *   - Listeners run synchronously, so the change is effective immediately.
 */

/** Same tag as @kvd/advanced/origin LOCAL (structural; no package dependency). */
export const LOCAL_UI = 'local-renderer';

/** Who is asking. Only `{ kind: 'local-renderer' }` is a human click in our UI. */
export type ActionOrigin = Readonly<{ kind: string; channel?: string }>;

export const LOCAL_UI_ORIGIN: ActionOrigin = Object.freeze({ kind: LOCAL_UI });

export function isLocalUiOrigin(origin: ActionOrigin | null | undefined): boolean {
  return !!origin && origin.kind === LOCAL_UI;
}

export function describeOrigin(origin: ActionOrigin | null | undefined): string {
  if (!origin) return 'none';
  return origin.channel ? `${origin.kind}:${origin.channel}` : origin.kind;
}

export const WRITE_PAUSED_MSG = '写入已暂停';

export interface WritePauseState {
  paused: boolean;
  pausedAt?: string;
}

export type WritePauseResult =
  | { ok: true; state: WritePauseState }
  | { ok: false; code: 'REMOTE_FORBIDDEN'; error: string; state: WritePauseState };

export type WritePauseListener = (state: WritePauseState, reason: string, origin: string) => void;

export interface WritePause {
  getState(): WritePauseState;
  isPaused(): boolean;
  pause(origin?: ActionOrigin | null): WritePauseResult;
  resume(origin: ActionOrigin | null | undefined): WritePauseResult;
  onChange(fn: WritePauseListener): () => boolean;
}

type PrefsRecord = Record<string, unknown>;

export function createWritePause({
  readPrefs,
  writePrefs,
  now = () => new Date(),
}: {
  readPrefs: () => PrefsRecord | null | undefined;
  writePrefs: (patch: PrefsRecord) => unknown;
  now?: () => Date;
}): WritePause {
  const listeners = new Set<WritePauseListener>();

  function getState(): WritePauseState {
    const p = readPrefs() || {};
    const st: WritePauseState = { paused: p.writePaused === true };
    if (st.paused && typeof p.writePausedAt === 'string') st.pausedAt = p.writePausedAt;
    return st;
  }

  function emit(reason: string, origin: ActionOrigin | null | undefined): WritePauseState {
    const st = getState();
    for (const fn of listeners) {
      try { fn(st, reason, describeOrigin(origin)); } catch { /* never block a state change */ }
    }
    return st;
  }

  function pause(origin?: ActionOrigin | null): WritePauseResult {
    if (getState().paused) return { ok: true, state: getState() };
    writePrefs({ writePaused: true, writePausedAt: now().toISOString() });
    return { ok: true, state: emit('paused', origin) };
  }

  function resume(origin: ActionOrigin | null | undefined): WritePauseResult {
    if (!isLocalUiOrigin(origin)) {
      emit('resume-rejected', origin);
      return {
        ok: false,
        code: 'REMOTE_FORBIDDEN',
        error: '解除写入暂停只能在本机由用户手动操作，Agent / 远程请求已拒绝',
        state: getState(),
      };
    }
    if (!getState().paused) return { ok: true, state: getState() };
    writePrefs({ writePaused: false, writeResumedAt: now().toISOString() });
    return { ok: true, state: emit('resumed', origin) };
  }

  function onChange(fn: WritePauseListener): () => boolean {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { getState, isPaused: () => getState().paused, pause, resume, onChange };
}
