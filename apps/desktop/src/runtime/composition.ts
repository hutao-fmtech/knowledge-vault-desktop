/**
 * Composition loader: reads apps/desktop/cordis.yml (the single declarative
 * plugin table, isomorphic with dsh-orb's cordis.yml rows) and resolves rows to
 * Cordis plugins. Nothing about WHICH plugins mount is hardcoded here.
 *
 * Each row: { id, name, config?, disabled?, lazy?, children? }
 *   name = package (or package subpath export) exporting the plugin.
 * The `advanced` lazy group is mounted as a disposable child fiber (PR-7).
 *
 * See docs/decisions/0001-cordis-composition-not-dsh-profile.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import type { Plugin } from '@deepseek-ai/cordis';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** apps/desktop/cordis.yml (also packaged at app.asar/cordis.yml); lib/runtime -> ../../cordis.yml. */
export const CORDIS_YML = path.resolve(HERE, '..', '..', 'cordis.yml');

/** Mount-time inputs for the advanced group (structurally the host's MountAdvancedOptions). */
export interface AdvancedMountOptions {
  workspaceRoot: string;
  bridge?: object;
  audit?: object;
  vaultTools?: object;
}

export interface PluginRow {
  id: string;
  name: string;
  config?: Record<string, unknown>;
  disabled?: boolean;
  lazy?: boolean;
  children?: PluginRow[];
}

/**
 * Parse and validate a cordis.yml document.
 * @param {string} text
 * @returns {PluginRow[]}
 */
export function parseComposition(text: string): PluginRow[] {
  const rows: unknown = yaml.load(text, { schema: yaml.CORE_SCHEMA });
  if (!Array.isArray(rows)) throw new Error('cordis.yml: top level must be a list of rows');
  const seen = new Set<string>();
  const check = (row: PluginRow, where: string): void => {
    if (!row || typeof row !== 'object') throw new Error(`cordis.yml: ${where}: row must be a mapping`);
    if (typeof row.id !== 'string' || !row.id) throw new Error(`cordis.yml: ${where}: missing id`);
    if (typeof row.name !== 'string' || !row.name) throw new Error(`cordis.yml: ${row.id}: missing name`);
    if (seen.has(row.id)) throw new Error(`cordis.yml: duplicate id ${row.id}`);
    seen.add(row.id);
    if (row.children !== undefined) {
      if (!Array.isArray(row.children)) throw new Error(`cordis.yml: ${row.id}: children must be a list`);
      row.children.forEach((c, i) => check(c, `${row.id}.children[${i}]`));
    }
  };
  (rows as PluginRow[]).forEach((r, i) => check(r, `[${i}]`));
  return rows as PluginRow[];
}

export function loadComposition(file: string = CORDIS_YML): PluginRow[] {
  return parseComposition(fs.readFileSync(file, 'utf8'));
}

const ALL_ROWS = loadComposition();

/** Default-mode rows (model-only, mounted at boot). No ctx.tools. */
export const DEFAULT_ROWS: PluginRow[] = ALL_ROWS.filter((r) => !r.lazy);

const advancedGroup = ALL_ROWS.find((r) => r.id === 'advanced' && r.lazy);
if (!advancedGroup || !advancedGroup.children?.length) {
  throw new Error('cordis.yml: missing lazy `advanced` group');
}

/**
 * Advanced-mode group (mounted only while Settings > Advanced is on).
 */
export const ADVANCED_ROWS: PluginRow[] = advancedGroup.children;

/** Flat list of every plugin row id declared in cordis.yml (default + advanced). */
export function compositionPluginIds(): string[] {
  return [...DEFAULT_ROWS.map((r) => r.id), ...ADVANCED_ROWS.map((r) => r.id)];
}

/**
 * Resolve a row to a Cordis plugin export (default or namespace).
 * Package names resolve from apps/desktop (node_modules / app.asar/node_modules).
 * Rows are data (YAML), so the module shape is checked at runtime.
 */
export async function resolvePlugin(row: PluginRow): Promise<Plugin> {
  const spec = row.name;
  const mod = (await import(spec)) as { default?: Plugin; apply?: unknown } | undefined;
  if (mod && typeof mod.default !== 'undefined') return mod.default;
  if (mod && typeof mod.apply === 'function') return mod as Plugin;
  throw new Error(`composition: row "${row.id}" has no plugin export from ${spec}`);
}

/**
 * Build advanced rows with vault-specific sandbox root and bridge config.
 * The sandbox policy is always re-pinned to read-only here, whatever the YAML says.
 */
export function advancedRowsFor(opts: AdvancedMountOptions): PluginRow[] {
  const root = opts.workspaceRoot;
  return ADVANCED_ROWS.map((row) => {
    if (row.id === 'dsh-sandbox-policy') {
      return { ...row, config: { ...(row.config || {}), mode: 'read-only', workspaceRoot: root } };
    }
    if (row.id === 'kvd-approval-bridge') {
      return { ...row, config: { ...(row.config || {}), ...(opts.bridge || {}) } };
    }
    if (row.id === 'kvd-audit-log') {
      return { ...row, config: { ...(row.config || {}), ...(opts.audit || {}) } };
    }
    if (row.id === 'kvd-vault-tools') {
      return { ...row, config: { ...(row.config || {}), ...(opts.vaultTools || {}) } };
    }
    return { ...row };
  });
}
