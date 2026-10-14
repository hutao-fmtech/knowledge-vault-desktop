/**
 * Pack-smoke probes for the advanced tier (issue: v0.2.3 mac app failed every
 * advanced task with "Cannot find package '@deepseek-ai/dsh-scope' imported from
 * app.asar/node_modules/@deepseek-ai/dsh-session/lib/index.js").
 *
 * 1. probeDshImports(): walks the @deepseek-ai closure reachable from
 *    dsh-session (plus every @deepseek-ai dep the app declares) through
 *    dependencies + non-optional peerDependencies, as seen from THIS module's
 *    location (inside app.asar when packaged), and dynamically imports each one.
 * 2. probeAdvancedTask(): runs a real advanced task through @kvd/advanced/host
 *    offline (scripted model on a local-only kvd-pack-smoke route) until the
 *    model's shell tool call reaches approval/request; the call is denied, so
 *    nothing executes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { Context } from '@deepseek-ai/cordis';
import type { ApprovalUiRequest } from '@kvd/advanced/approval-bridge';
import { createAdvancedController } from '@kvd/advanced/controller';
import { localOrigin } from '@kvd/advanced/origin';

const SCOPE = '@deepseek-ai/';
const PACK_SMOKE_PROVIDER = 'kvd-pack-smoke';

interface Manifest {
  name: string;
  version?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

export interface DshImportProbe {
  ok: boolean;
  count: number;
  modules: string[];
  outsideAsar: string[];
  failures: { name: string; error: string }[];
}

function readManifest(pkgJson: string): Manifest {
  return JSON.parse(fs.readFileSync(pkgJson, 'utf8')) as Manifest;
}

/** Packages that only load on Windows (native addons / win32 APIs). */
function isPlatformOnly(m: Manifest & { os?: string[] }): boolean {
  return Array.isArray(m.os) && !m.os.includes(process.platform);
}

function entrySpecifiers(name: string, m: Manifest & { main?: string; exports?: unknown }): string[] {
  const ex = m.exports;
  if (ex && typeof ex === 'object' && !Array.isArray(ex)) {
    const keys = Object.keys(ex);
    if (keys.some((k) => k.startsWith('.'))) {
      if (keys.includes('.')) return [name];
      return keys.filter((k) => k.startsWith('./') && !k.includes('*') && !k.endsWith('.json')).map((k) => `${name}/${k.slice(2)}`);
    }
  }
  return [name];
}

export async function probeDshImports(appPkgJson: string): Promise<DshImportProbe> {
  const appManifest = readManifest(appPkgJson);
  const roots = ['@deepseek-ai/dsh-session', ...Object.keys(appManifest.dependencies || {}).filter((n) => n.startsWith(SCOPE))];
  const seen = new Map<string, string>(); // name -> package dir
  const failures: { name: string; error: string }[] = [];
  const queue: { name: string; from: string }[] = roots.map((name) => ({ name, from: appPkgJson }));
  while (queue.length) {
    const next = queue.shift();
    if (!next || seen.has(next.name)) continue;
    let pkgJson: string;
    try {
      // Resolve from the importer's own location, exactly like Node does at runtime.
      pkgJson = createRequire(next.from).resolve(`${next.name}/package.json`);
    } catch {
      // Some packages do not export ./package.json: walk node_modules ourselves.
      let dir = path.dirname(next.from);
      let found = '';
      for (;;) {
        const cand = path.join(dir, 'node_modules', next.name, 'package.json');
        if (fs.existsSync(cand)) { found = cand; break; }
        const up = path.dirname(dir);
        if (up === dir) break;
        dir = up;
      }
      if (!found) {
        seen.set(next.name, '');
        failures.push({ name: next.name, error: `not found from ${next.from}` });
        continue;
      }
      pkgJson = found;
    }
    seen.set(next.name, path.dirname(pkgJson));
    const m = readManifest(pkgJson);
    const optional = m.peerDependenciesMeta || {};
    const deps = [
      ...Object.keys(m.dependencies || {}),
      ...Object.keys(m.peerDependencies || {}).filter((d) => !optional[d]?.optional),
    ].filter((d) => d.startsWith(SCOPE));
    for (const d of deps) queue.push({ name: d, from: pkgJson });
  }
  const outsideAsar: string[] = [];
  const inAsar = appPkgJson.includes('app.asar');
  for (const [name, dir] of seen) {
    if (!dir) continue;
    if (inAsar && !dir.includes('app.asar')) outsideAsar.push(name);
    const m = readManifest(path.join(dir, 'package.json'));
    if (isPlatformOnly(m as Manifest & { os?: string[] })) continue;
    // Import by bare specifier from the app root: Node then resolves every
    // transitive import from the package's own location in app.asar. Packages
    // without a root entry (subpath exports only) import each subpath.
    for (const spec of entrySpecifiers(name, m)) {
      try {
        await import(spec);
      } catch (err) {
        failures.push({ name: spec, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  const modules = [...seen.keys()].sort();
  return { ok: failures.length === 0 && outsideAsar.length === 0, count: modules.length, modules, outsideAsar, failures };
}

class PackSmokeScriptedAdapter extends LlmAdapter {
  calls = 0;
  constructor(private readonly toolName: string, private readonly command: string) {
    super();
  }
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'KVD pack-smoke scripted' };
  }
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: 'mock', name: 'mock' }]);
  }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model || 'mock', name: model || 'mock' });
  }
  async *stream(_options: GenerateOptions): AsyncGenerator<StreamChunk> {
    this.calls += 1;
    if (this.calls === 1) {
      const id = ToolCallId('call_pack_smoke');
      const args = JSON.stringify({ command: this.command, description: 'pack-smoke' });
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id, name: this.toolName, argumentsDelta: args };
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: this.toolName, arguments: args } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
      return;
    }
    const text = 'pack-smoke done';
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

export interface AdvancedTaskProbe {
  ok: boolean;
  tool?: string;
  approvals?: number;
  modelCalls?: number;
  executed?: boolean;
  error?: string;
}

export async function probeAdvancedTask(): Promise<AdvancedTaskProbe> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-pack-smoke-adv-'));
  const vault = path.join(scratch, 'vault');
  fs.mkdirSync(vault, { recursive: true });
  const sentinel = 'pack-smoke-must-not-exist.txt';
  const toolName = process.platform === 'win32' ? 'pwsh' : 'bash';
  const command = process.platform === 'win32' ? `Set-Content -Path ${sentinel} -Value x` : `echo x > ${sentinel}`;
  const approvals: ApprovalUiRequest[] = [];
  let host: { run: (o: { prompt?: string; timeoutMs?: number }) => Promise<unknown>; stop: (reason?: string) => Promise<unknown> } | null = null;
  try {
    // Statically imports @deepseek-ai/dsh-session (the v0.2.3 failure point).
    const { createAdvancedHost } = await import('@kvd/advanced/host');
    const runtime = await import('./boot.js');
    const { ctx } = (await runtime.getRuntime()) as { ctx: Context };
    const adapter = new PackSmokeScriptedAdapter(toolName, command);
    // Own offline route. kvd-privacy gates every non-kvd-mock route on consent stored in
    // the user's prefs; never write those from a smoke, so this route answers ahead of the
    // gate (prepend) and never reaches the network.
    ctx.llm.registerAdapter([PACK_SMOKE_PROVIDER], adapter);
    ctx.on(
      'llm/stream',
      (options, next) => (options && options.provider === PACK_SMOKE_PROVIDER ? adapter.stream(options) : next()),
      true,
    );
    let prefs: Record<string, unknown> = {};
    const controller = createAdvancedController({
      readPrefs: () => ({ ...prefs }),
      writePrefs: (p: Record<string, unknown>) => {
        prefs = { ...prefs, ...p };
        return prefs;
      },
    });
    controller.enable(localOrigin(), { acknowledgeRisk: true });
    host = createAdvancedHost({
      runtime,
      controller,
      log: { append: () => '' },
      requestApproval: (req: ApprovalUiRequest) => {
        approvals.push(req);
        return 'deny';
      },
      onPropose: async () => ({ ok: false, error: 'pack-smoke' }),
      getVaultRoot: () => vault,
      getSecrets: () => [],
      getModelRoute: () => ({ provider: PACK_SMOKE_PROVIDER, model: 'mock' }),
    });
    await host.run({ prompt: 'pack-smoke: run one shell command', timeoutMs: 30000 });
    const executed = fs.existsSync(path.join(vault, sentinel));
    const hit = approvals.find((a) => a.tool === toolName && a.command === command);
    return { ok: !!hit && !executed && adapter.calls >= 1, tool: toolName, approvals: approvals.length, modelCalls: adapter.calls, executed };
  } catch (err) {
    return { ok: false, approvals: approvals.length, error: err instanceof Error ? (err.stack || err.message) : String(err) };
  } finally {
    try { if (host) await host.stop('pack-smoke'); } catch { /* ignore */ }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
