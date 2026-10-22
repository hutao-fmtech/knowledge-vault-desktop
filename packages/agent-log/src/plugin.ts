/**
 * kvd-agent-log Cordis plugin (`@kvd/agent-log/plugin`, cordis.yml row `kvd-agent-log`).
 *
 * Listens to `kvd/agent-log` events ({ root, record }) and appends them to
 * `<root>/.vault/agent-log/…` through the allowlisted core (index.ts). Emitters
 * (kvd-proposals, the shell for pause.on/off) pass the vault root explicitly so
 * `proposal.expired` lands in the vault that was just closed.
 *
 *   - device id: `<app config dir>/agent-log-device-id` (outside every vault)
 *   - retention: prune once per vault per process, when the vault is opened
 *     (`kvd/vault-changed`) or first written to — i.e. at startup/open
 *   - never throws into the emitter (AL-5): every handler is wrapped
 */
import fs from 'node:fs';
import path from 'node:path';
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type {} from '@kvd/vault';
import { configDir } from '@kvd/shared/config-dir';
import { DEFAULT_RETENTION_DAYS, createAgentLog, dayKey, loadOrCreateDeviceId } from './index.js';
import type { AgentLog, AgentLogInput, AgentLogRecord } from './index.js';
import { buildDailyReport, reportAbsPath, writeDailyReport, yesterdayKey } from './report.js';
import type { WriteReportResult } from './report.js';

/** Asia/Shanghai — AL-8 day boundaries and report catch-up. */
export const DEFAULT_UTC_OFFSET_MINUTES = 480;

export const name = 'kvd-agent-log';

/** Payload of the `kvd/agent-log` event. */
export interface AgentLogEmit {
  root: string | null | undefined;
  record: AgentLogInput;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentLog: AgentLogService;
  }
  interface Events {
    'kvd/agent-log'(event: AgentLogEmit): void;
  }
}

export interface AgentLogConfig {
  deviceIdFile?: string;
  retentionDays?: number;
  utcOffsetMinutes?: number;
}

export const Config = z.object({
  deviceIdFile: z.string(),
  retentionDays: z.number().default(DEFAULT_RETENTION_DAYS),
  utcOffsetMinutes: z.number().default(DEFAULT_UTC_OFFSET_MINUTES),
});

export class AgentLogService extends Service {
  static Config = Config;

  readonly deviceId: string;
  private readonly _logs = new Map<string, AgentLog>();
  private _app: string | undefined;
  private readonly _cfg: AgentLogConfig;
  private _now: () => Date = () => new Date();

  constructor(ctx: Context, config: AgentLogConfig = {}) {
    super(ctx, 'agentLog');
    this._cfg = config || {};
    let file = this._cfg.deviceIdFile;
    if (!file) {
      try {
        file = path.join(configDir(), 'agent-log-device-id');
      } catch {
        file = '';
      }
    }
    // No config dir → in-memory id (loadOrCreateDeviceId never throws).
    this.deviceId = loadOrCreateDeviceId(file || '');

    ctx.on('kvd/agent-log', (e) => {
      try {
        if (e && e.root) this.append(e.root, e.record);
      } catch {
        /* never throw into the emitter */
      }
    });
    ctx.on('kvd/vault-changed', (e) => {
      try {
        if (e && e.root) {
          this._log(e.root); // prune once per vault
          this.catchUpYesterday(e.root); // AL-6: write yesterday's report if missing
        }
      } catch {
        /* ignore */
      }
    });
  }

  /** @internal Tests only: freeze "now" for catch-up / today. */
  setNowForTests(fn: (() => Date) | null): void {
    this._now = fn ?? (() => new Date());
  }

  /** UTC offset used for day files and reports (default Asia/Shanghai = +08:00). */
  utcOffsetMinutes(): number {
    return typeof this._cfg.utcOffsetMinutes === 'number' ? this._cfg.utcOffsetMinutes : DEFAULT_UTC_OFFSET_MINUTES;
  }

  /** Version stamped as `app` on every line (the shell passes app.getVersion()). */
  setAppVersion(v: string | null | undefined): void {
    this._app = v || undefined;
  }

  /** Logger for one vault; the first use per process prunes expired day files. */
  private _log(root: string): AgentLog {
    const key = path.resolve(root);
    let log = this._logs.get(key);
    if (!log) {
      const opts = {
        getVaultRoot: () => key,
        deviceId: this.deviceId,
        app: this._app,
        retentionDays: this._cfg.retentionDays ?? DEFAULT_RETENTION_DAYS,
        utcOffsetMinutes: this.utcOffsetMinutes(),
        now: () => this._now(),
      };
      log = createAgentLog(opts);
      this._logs.set(key, log);
      log.prune();
    }
    return log;
  }

  append(root: string, record: AgentLogInput): AgentLogRecord | null {
    try {
      const log = this._log(root);
      return log.append(this._app && !record.app ? { ...record, app: this._app } : record);
    } catch {
      return null;
    }
  }

  readDay(root: string, day: string): AgentLogRecord[] {
    try {
      return this._log(root).readDay(day);
    } catch {
      return [];
    }
  }

  dir(root: string): string | null {
    try {
      return this._log(root).dir();
    } catch {
      return null;
    }
  }

  /**
   * Rebuild one day's report from that day's JSONL and write it (AL-6).
   * Zero events → `{ ok: true, empty: true }` and no file is written.
   * Idempotent overwrite when events exist. Never throws.
   */
  generateReport(root: string, day: string):
    | { ok: true; empty: true; day: string }
    | { ok: true; empty: false; abs: string; rel: string; bytes: number }
    | { ok: false; error: string } {
    try {
      const events = this.readDay(root, day);
      const md = buildDailyReport(day, events);
      if (!md) return { ok: true, empty: true, day };
      const written = writeDailyReport(root, day, md);
      if (!written.ok) return written;
      return { ok: true, empty: false, abs: written.abs, rel: written.rel, bytes: written.bytes };
    } catch (err) {
      return { ok: false, error: `生成日报失败：${(err as Error).message}` };
    }
  }

  /** Today's report (UTC+8 calendar day), rebuilt on demand. */
  generateToday(root: string): ReturnType<AgentLogService['generateReport']> {
    return this.generateReport(root, dayKey(this._now(), this.utcOffsetMinutes()));
  }

  /**
   * Hivemynd-style catch-up: if yesterday's report is missing, rebuild it from
   * JSONL (no-op when the day has zero events or the file already exists).
   */
  catchUpYesterday(root: string): { wrote: boolean; day: string; empty?: boolean } {
    const day = yesterdayKey(this._now(), this.utcOffsetMinutes());
    try {
      if (fsExists(reportAbsPath(root, day))) return { wrote: false, day };
      const res = this.generateReport(root, day);
      if (!res.ok) return { wrote: false, day };
      if ('empty' in res && res.empty) return { wrote: false, day, empty: true };
      return { wrote: true, day };
    } catch {
      return { wrote: false, day };
    }
  }
}

function fsExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

export default AgentLogService;
