import { describe, expect, it } from 'vitest';
import { ENCODING_PREAMBLE } from '@deepseek-ai/dsh-pwsh-local';
import {
  SAFE_ENCODING_PREAMBLE,
  installSafePwshEncodingPreamble,
  isSafePwshEncodingPreambleInstalled,
  probePwshArgvCommand,
  withSafeEncodingPreamble,
} from '../src/runtime/pwsh-encoding.js';

describe('pwsh encoding preamble (issue #20)', () => {
  it('SAFE preamble still attempts UTF-8 pin but wraps failures', () => {
    expect(SAFE_ENCODING_PREAMBLE).toContain('[Console]::OutputEncoding');
    expect(SAFE_ENCODING_PREAMBLE).toContain('[System.Text.UTF8Encoding]::new($false)');
    expect(SAFE_ENCODING_PREAMBLE).toContain('$OutputEncoding');
    expect(SAFE_ENCODING_PREAMBLE).toMatch(/try\s*\{/);
    expect(SAFE_ENCODING_PREAMBLE).toMatch(/catch\s*\{\s*\}/);
    expect(SAFE_ENCODING_PREAMBLE).toContain('SilentlyContinue');
    expect(SAFE_ENCODING_PREAMBLE).not.toBe(ENCODING_PREAMBLE);
  });

  it('withSafeEncodingPreamble replaces only the upstream prefix', () => {
    const cmd = "Get-Content -Encoding utf8 '01-收件箱/idea.md'";
    expect(withSafeEncodingPreamble(ENCODING_PREAMBLE + cmd)).toBe(SAFE_ENCODING_PREAMBLE + cmd);
    expect(withSafeEncodingPreamble(cmd)).toBe(cmd);
  });

  it('install patches PwshLocalExecutor.argv to emit the safe preamble', () => {
    installSafePwshEncodingPreamble();
    expect(isSafePwshEncodingPreambleInstalled()).toBe(true);
    installSafePwshEncodingPreamble(); // idempotent
    const cmd = 'Get-ChildItem';
    const commandArg = probePwshArgvCommand(cmd, 'C:\\pwsh.exe');
    expect(commandArg).toBe(SAFE_ENCODING_PREAMBLE + cmd);
    expect(commandArg.startsWith(ENCODING_PREAMBLE)).toBe(false);
  });
});
