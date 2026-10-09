'use strict';

/**
 * Offline test double for the DeepSeek Messages (Anthropic-compatible) API.
 * Listens on 127.0.0.1 only; never contacts the network. Each request pops the
 * next scripted step: { tool, input } emits one tool_use block, { text } emits
 * a final text answer. When the queue is empty it answers "done".
 */
const http = require('http');

function startMockAnthropic() {
  const queue = [];
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      requests.push({ url: req.url, headers: { ...req.headers }, body });
      if (!req.url.endsWith('/messages')) { res.writeHead(404); res.end('{}'); return; }
      const step = queue.shift() || { text: 'done' };
      const n = requests.length;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', { message: { id: `msg_${n}`, type: 'message', role: 'assistant', model: 'mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
      if (step.tool) {
        ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: `toolu_${n}`, name: step.tool, input: {} } });
        ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(step.input) } });
        ev('content_block_stop', { index: 0 });
        ev('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } });
      } else {
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: step.text } });
        ev('content_block_stop', { index: 0 });
        ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
      }
      ev('message_stop', {});
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseURL: `http://127.0.0.1:${port}/anthropic`,
        queue,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

module.exports = { startMockAnthropic };
