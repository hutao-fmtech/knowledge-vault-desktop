/**
 * Daily report rebuilt purely from one day's agent-log JSONL (AL-6).
 *
 *   <vault>/00-系统/agent-日报/YYYY-MM-DD.md
 *
 * Deterministic: same events twice → byte-identical markdown. Paths are inline
 * code (`path`), never `[[wikilinks]]`. Zero events → null (caller must not write).
 * Written by the app (main process) only — not through proposal→Apply — so the
 * agent still cannot create or forge reports (00-系统/ is forbidden).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AgentLogRecord } from './index.js';

export const REPORT_DIR_REL = '00-系统/agent-日报';
export const REPORT_KIND = 'agent-report';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Vault-relative path of the report for `day` (always `/` separators). */
export function reportRelPath(day: string): string {
  return `${REPORT_DIR_REL}/${day}.md`;
}

export function reportAbsPath(vaultRoot: string, day: string): string {
  return path.join(vaultRoot, ...REPORT_DIR_REL.split('/'), `${day}.md`);
}

/** Calendar day (YYYY-MM-DD) of `d` in the given UTC offset. Local to this module to avoid a cycle with index.ts. */
function dayKeyLocal(d: Date, offsetMinutes: number): string {
  const local = new Date(d.getTime() + offsetMinutes * 60_000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Calendar day of "yesterday" in the given UTC offset (AL-8: Asia/Shanghai = 480). */
export function yesterdayKey(d: Date, offsetMinutes: number): string {
  return dayKeyLocal(new Date(d.getTime() - 86_400_000), offsetMinutes);
}

const ACTION_LABEL: Record<string, string> = {
  'proposal.created': '提出',
  'proposal.applied': '应用',
  'proposal.rejected': '拒绝',
  'proposal.expired': '失效',
  'proposal.apply_failed': '应用失败',
  'apply.verify_failed': '校验失败',
  'pause.on': '暂停写入',
  'pause.off': '解除暂停',
};

function actionLabel(ev: string): string {
  return ACTION_LABEL[ev] ?? ev;
}

/** Path column: vault-relative `/` paths as inline code; move → `from` → `to`. */
function pathCell(r: AgentLogRecord): string {
  if (r.kind === 'move' || (r.from && r.to)) {
    const from = (r.from || '').replace(/\\/g, '/');
    const to = (r.to || '').replace(/\\/g, '/');
    if (from || to) return `\`${from}\` → \`${to}\``;
  }
  const p = (r.path || '').replace(/\\/g, '/');
  return p ? `\`${p}\`` : '—';
}

function originKey(r: AgentLogRecord): string {
  return r.origin && r.origin.trim() ? r.origin : '—';
}

/** HH:mm:ss from an ISO ts that already carries its offset (e.g. …T09:01:02.000+08:00). */
function timeOf(ts: string): string {
  const m = /T(\d{2}:\d{2}:\d{2})/.exec(ts);
  return m ? m[1]! : ts.slice(11, 19);
}

type Counts = { created: number; applied: number; rejected: number; expired: number; failed: number };

function emptyCounts(): Counts {
  return { created: 0, applied: 0, rejected: 0, expired: 0, failed: 0 };
}

/**
 * Rebuild one day's markdown from the day's records.
 * Returns `null` when there are no events (caller must not write a file).
 * Stable sort: ts → id → ev. Origins in the summary table are sorted lexically.
 */
export function buildDailyReport(day: string, events: readonly AgentLogRecord[]): string | null {
  if (!DAY_RE.test(day)) return null;
  if (!events.length) return null;

  const sorted = [...events].sort((a, b) => {
    if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1;
    const idA = a.id || '';
    const idB = b.id || '';
    if (idA !== idB) return idA < idB ? -1 : 1;
    return a.ev < b.ev ? -1 : a.ev > b.ev ? 1 : 0;
  });

  const byOrigin = new Map<string, Counts>();
  for (const r of sorted) {
    const key = originKey(r);
    let c = byOrigin.get(key);
    if (!c) {
      c = emptyCounts();
      byOrigin.set(key, c);
    }
    switch (r.ev) {
      case 'proposal.created':
        c.created += 1;
        break;
      case 'proposal.applied':
        c.applied += 1;
        break;
      case 'proposal.rejected':
        c.rejected += 1;
        break;
      case 'proposal.expired':
        c.expired += 1;
        break;
      case 'proposal.apply_failed':
      case 'apply.verify_failed':
        c.failed += 1;
        break;
      default:
        break;
    }
  }

  const origins = [...byOrigin.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const summaryRows = origins
    .map((o) => {
      const c = byOrigin.get(o)!;
      return `| \`${o}\` | ${c.created} | ${c.applied} | ${c.rejected} | ${c.expired} | ${c.failed} |`;
    })
    .join('\n');

  const detailRows = sorted
    .map((r) => `| ${timeOf(r.ts)} | \`${originKey(r)}\` | ${actionLabel(r.ev)} | ${pathCell(r)} |`)
    .join('\n');

  // Fixed template — no generation timestamp — so the same input is byte-identical.
  return (
    `---\n` +
    `kvd: ${REPORT_KIND}\n` +
    `date: ${day}\n` +
    `---\n` +
    `\n` +
    `# Agent 日报 · ${day}\n` +
    `\n` +
    `由 \`.vault/agent-log/${day}.*.jsonl\` 重建；路径以行内代码写出，不含 wikilink。\n` +
    `\n` +
    `## 按来源汇总\n` +
    `\n` +
    `| 来源 | 提出 | 应用 | 拒绝 | 失效 | 失败 |\n` +
    `| --- | ---: | ---: | ---: | ---: | ---: |\n` +
    `${summaryRows}\n` +
    `\n` +
    `## 明细\n` +
    `\n` +
    `| 时间 | 来源 | 动作 | 路径 |\n` +
    `| --- | --- | --- | --- |\n` +
    `${detailRows}\n`
  );
}

export type WriteReportResult =
  | { ok: true; abs: string; rel: string; bytes: number }
  | { ok: false; error: string };

/**
 * Atomically write a report markdown into the vault. Bypasses FORBIDDEN_PREFIXES
 * (app-owned write into 00-系统/). Never throws.
 */
export function writeDailyReport(vaultRoot: string, day: string, markdown: string): WriteReportResult {
  try {
    if (!DAY_RE.test(day)) return { ok: false, error: '无效的日期' };
    if (!vaultRoot || typeof vaultRoot !== 'string') return { ok: false, error: '未打开 vault' };
    const dir = path.join(vaultRoot, ...REPORT_DIR_REL.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    const abs = path.join(dir, `${day}.md`);
    const tmp = path.join(dir, `.${day}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, markdown, 'utf8');
    fs.renameSync(tmp, abs);
    return { ok: true, abs, rel: reportRelPath(day), bytes: Buffer.byteLength(markdown, 'utf8') };
  } catch (err) {
    return { ok: false, error: `写日报失败：${(err as Error).message}` };
  }
}
