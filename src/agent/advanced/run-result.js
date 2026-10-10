'use strict';

/** Shape a host.run() result for the renderer (exported shape is smoke-tested). */
function advancedRunResult(res, runtime) {
  const toolCalls = (res.toolCalls || []).map((c) => ({
    name: c.name,
    command: c.arguments && typeof c.arguments.command === 'string' ? c.arguments.command : null,
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

module.exports = { advancedRunResult };
