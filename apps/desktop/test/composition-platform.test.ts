import { describe, expect, it } from 'vitest';
import { loadComposition, rowsForPlatform, shellToolOf, shellToolSentence } from '../src/runtime/composition.js';

const advancedOf = (platform: string) =>
  rowsForPlatform(loadComposition(), platform).find((r) => r.id === 'advanced')?.children ?? [];

describe('per-platform advanced shell (issue #18)', () => {
  it('mounts pwsh on Windows and bash elsewhere, never both', () => {
    for (const [platform, tool] of [['win32', 'pwsh'], ['darwin', 'bash'], ['linux', 'bash']] as const) {
      const ids = advancedOf(platform).map((r) => r.id);
      expect(shellToolOf(advancedOf(platform))).toBe(tool);
      expect(ids.filter((id) => /^dsh-(tool|bash|pwsh)-?(bash|pwsh|sandbox)$/.test(id)).sort())
        .toEqual(tool === 'pwsh' ? ['dsh-pwsh-sandbox', 'dsh-tool-pwsh'] : ['dsh-bash-sandbox', 'dsh-tool-bash']);
    }
  });
  it('mounts the same number of plugins on every platform', () => {
    const n = (p: string) => rowsForPlatform(loadComposition(), p).flatMap((r) => r.children ?? [r]).length;
    expect(n('win32')).toBe(n('linux'));
    expect(n('darwin')).toBe(n('linux'));
  });
  it('prompt sentence names the platform shell', () => {
    expect(shellToolSentence('pwsh')).toMatch(/PowerShell/);
    expect(shellToolSentence('bash')).not.toMatch(/PowerShell|pwsh/);
  });
});
