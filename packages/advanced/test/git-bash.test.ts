import { describe, expect, it } from 'vitest';
import { GitBashNotFoundError, gitBashCandidates, isForbiddenBash, resolveGitBash, sandboxBashProgram } from '../src/git-bash.js';

const env = { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };

describe('git-bash resolution (issue #18)', () => {
  it('never accepts the WSL launcher or WindowsApps aliases', () => {
    expect(isForbiddenBash('C:\\Windows\\System32\\bash.exe', env)).toBe(true);
    expect(isForbiddenBash('c:\\windows\\sysnative\\BASH.EXE', env)).toBe(true);
    expect(isForbiddenBash('C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe', env)).toBe(true);
    expect(isForbiddenBash('C:\\Program Files\\Git\\bin\\bash.exe', env)).toBe(false);
    const all = new Set(['C:\\Windows\\System32\\bash.exe']);
    expect(() => resolveGitBash({ env: { ...env, KVD_GIT_BASH: 'C:\\Windows\\System32\\bash.exe' }, whereGit: () => [], isFile: (p) => all.has(p) }))
      .toThrow(GitBashNotFoundError);
  });

  it('derives bash.exe from git.exe on PATH before known locations', () => {
    const files = new Set(['D:\\tools\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\bin\\bash.exe']);
    expect(resolveGitBash({ env, whereGit: () => ['D:\\tools\\Git\\cmd\\git.exe'], isFile: (p) => files.has(p) }))
      .toBe('D:\\tools\\Git\\bin\\bash.exe');
  });

  it('falls back to Program Files and honours the override first', () => {
    const files = new Set(['C:\\Program Files\\Git\\bin\\bash.exe', 'E:\\g\\bin\\bash.exe']);
    expect(resolveGitBash({ env, whereGit: () => [], isFile: (p) => files.has(p) })).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
    expect(gitBashCandidates({ env: { ...env, KVD_GIT_BASH: 'E:\\g\\bin\\bash.exe' }, whereGit: () => [] })[0]).toBe('E:\\g\\bin\\bash.exe');
  });

  it('fails with a user-facing error when Git Bash is missing', () => {
    expect(() => resolveGitBash({ env, whereGit: () => [], isFile: () => false })).toThrow(/Git for Windows/);
  });

  it('is plain bash off Windows', () => {
    expect(sandboxBashProgram('linux')).toBe('bash');
    expect(sandboxBashProgram('darwin')).toBe('bash');
  });
});
