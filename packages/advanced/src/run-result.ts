/** Shape a host.run() result for the renderer (exported shape is smoke-tested). */
export interface RunToolCall {
  name: string;
  arguments?: unknown;
  isError: boolean | null;
}

export interface HostRunLike {
  answer?: string;
  toolCalls?: readonly RunToolCall[];
  requestErrors?: readonly string[];
  timedOut?: boolean;
  route?: string;
}

export interface RendererToolCall {
  name: string;
  command: string | null;
  isError: boolean | null;
}

export type AdvancedRunResult =
  | { ok: false; error: string; answer?: string; toolCalls: RendererToolCall[]; runtime: unknown }
  | { ok: true; answer: string; toolCalls: RendererToolCall[]; route: string | undefined; runtime: unknown };

function commandOf(args: unknown): string | null {
  if (args && typeof args === 'object' && typeof (args as { command?: unknown }).command === 'string') {
    return (args as { command: string }).command;
  }
  return null;
}

export function advancedRunResult(res: HostRunLike, runtime: unknown): AdvancedRunResult {
  const toolCalls = (res.toolCalls || []).map((c) => ({
    name: c.name,
    command: commandOf(c.arguments),
    isError: c.isError,
  }));
  if (!res.answer && res.requestErrors && res.requestErrors.length) {
    return { ok: false, error: `模型调用失败：${res.requestErrors[0]}`, toolCalls, runtime };
  }
  if (res.timedOut) {
    return { ok: false, error: '高级档任务超时，已取消', answer: res.answer || '', toolCalls, runtime };
  }
  return { ok: true, answer: res.answer || '（模型未返回文本）', toolCalls, route: res.route, runtime };
}
