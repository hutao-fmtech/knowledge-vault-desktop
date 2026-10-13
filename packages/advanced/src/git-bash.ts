/**
 * Git Bash resolution for the advanced-mode bash sandbox on Windows (issue #18).
 *
 * The dsh bash sandbox runs a bare `bash -c …` command. On Windows, CreateProcess
 * looks in System32 before PATH, so `bash` turns into the WSL launcher
 * (`C:\Windows\System32\bash.exe`). Under the restricted token that launcher
 * fails with `Bash/E_ACCESSDENIED` before the command ever runs. This module
 * finds Git for Windows' bash explicitly and refuses any WSL launcher.
 */
import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Environment override: absolute path to a Git Bash `bash.exe`. */
export const BASH_PATH_ENV = 'KVD_GIT_BASH';

export const GIT_BASH_MISSING_MESSAGE =
  '高级档在 Windows 上需要 Git for Windows（Git Bash）。请安装 https://git-scm.com/download/win 后重试，' +
  `或设置环境变量 ${BASH_PATH_ENV} 指向 Git 的 bin\\bash.exe。` +
  ' / Advanced mode on Windows needs Git for Windows (Git Bash). Install it from https://git-scm.com/download/win, ' +
  `or set ${BASH_PATH_ENV} to Git's bin\\bash.exe.`;

export class GitBashNotFoundError extends Error {
  readonly code = 'KVD_GIT_BASH_NOT_FOUND';
  constructor(readonly tried: readonly string[]) {
    super(GIT_BASH_MISSING_MESSAGE);
    this.name = 'GitBashNotFoundError';
  }
}

export interface ResolveDeps {
  env?: NodeJS.ProcessEnv;
  isFile?: (p: string) => boolean;
  /** Full paths of git.exe on PATH (as `where.exe git` reports them). */
  whereGit?: () => string[];
}

const win = path.win32;

function defaultIsFile(p: string): boolean {
  try { return existsSync(p) && statSync(p).isFile(); } catch { return false; }
}

function defaultWhereGit(): string[] {
  try {
    return execFileSync('where.exe', ['git'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

/**
 * True for paths that must never be used as the sandbox bash: the WSL launcher
 * under %SystemRoot% (System32 / SysWOW64 / Sysnative) and the WindowsApps
 * execution aliases.
 */
export function isForbiddenBash(p: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const norm = win.normalize(p).toLowerCase();
  const sysRoot = win.normalize(env.SystemRoot || env.windir || 'C:\\Windows').toLowerCase();
  if (norm === sysRoot || norm.startsWith(sysRoot + '\\')) return true;
  if (norm.includes('\\windowsapps\\')) return true;
  return false;
}

/** Git install root for a git.exe path: `<root>\cmd\git.exe`, `<root>\bin\git.exe`, `<root>\mingw64\bin\git.exe`. */
function gitRootFromExe(gitExe: string): string | null {
  let dir = win.dirname(gitExe);
  for (let i = 0; i < 3; i++) {
    const base = win.basename(dir).toLowerCase();
    if (base === 'cmd' || base === 'bin' || base === 'mingw64' || base === 'mingw32') dir = win.dirname(dir);
    else break;
  }
  return dir || null;
}

/** Candidate Git Bash paths in priority order (override first). */
export function gitBashCandidates(deps: ResolveDeps = {}): string[] {
  const env = deps.env ?? process.env;
  const out: string[] = [];
  const add = (p: string | undefined | null) => { if (p && !out.includes(p)) out.push(p); };
  add(env[BASH_PATH_ENV]);
  for (const g of (deps.whereGit ?? defaultWhereGit)()) {
    const root = gitRootFromExe(g);
    if (root) add(win.join(root, 'bin', 'bash.exe'));
  }
  for (const base of [env.ProgramFiles, env.ProgramW6432, env['ProgramFiles(x86)']]) {
    if (base) add(win.join(base, 'Git', 'bin', 'bash.exe'));
  }
  if (env.LOCALAPPDATA) add(win.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'));
  if (env.USERPROFILE) add(win.join(env.USERPROFILE, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'));
  return out;
}

/**
 * Resolve Git Bash on Windows. Throws {@link GitBashNotFoundError} (user-facing
 * message) rather than falling back to a bare `bash`.
 */
export function resolveGitBash(deps: ResolveDeps = {}): string {
  const env = deps.env ?? process.env;
  const isFile = deps.isFile ?? defaultIsFile;
  const tried = gitBashCandidates(deps);
  for (const c of tried) {
    if (!win.isAbsolute(c) || isForbiddenBash(c, env)) continue;
    if (isFile(c)) return c;
  }
  throw new GitBashNotFoundError(tried);
}

let cached: string | null = null;

/** argv[0] for the sandboxed `bash -c`: Git Bash on win32, plain `bash` elsewhere. */
export function sandboxBashProgram(platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32') return 'bash';
  cached ??= resolveGitBash();
  return cached;
}
