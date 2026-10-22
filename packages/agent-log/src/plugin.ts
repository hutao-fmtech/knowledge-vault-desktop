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
import path from 'node:path';
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type {} from '@kvd/vault';
import { configDir } from '@kvd/shared/config-dir';
import { DEFAULT_RETENTION_DAYS, createAgentLog, loadOrCreateDeviceId } from './index.js';
import type { AgentLog, AgentLogInput, AgentLogRecord } from './index.js';

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
  utcOffsetMinutes: z.number(),
});

export class AgentLogService extends Service {
  static Config = Config;

  readonly deviceId: string;
  private readonly _logs = new Map<string, AgentLog>();
  private _app: string | undefined;
  private readonly _cfg: AgentLogConfig;

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
        if (e && e.root) this._log(e.root);
      } catch {
        /* ignore */
      }
    });
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
        ...(typeof this._cfg.utcOffsetMinutes === 'number' ? { utcOffsetMinutes: this._cfg.utcOffsetMinutes } : {}),
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
}

export default AgentLogService;
