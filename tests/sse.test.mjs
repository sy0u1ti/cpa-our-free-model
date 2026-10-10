import test from 'node:test';
import assert from 'node:assert/strict';
import { assertJSONSSE } from './sse.mjs';

test('strict SSE client parses multiline JSON, metadata and one terminal', () => {
  const events = assertJSONSSE(': heartbeat\r\n\r\nevent: chunk\r\nid: 1\r\ndata: {"model":"ofm/test",\r\ndata: "choices":[]}\r\n\r\ndata: [DONE]\r\n\r\n', { done: 1 });
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'chunk');
  assert.equal(events[0].value.model, 'ofm/test');
});

test('strict SSE client rejects double framing and duplicate completion', () => {
  assert.throws(() => assertJSONSSE('data: data: {"choices":[]}\n\ndata: [DONE]\n\n', { done: 1 }), /not JSON/);
  assert.throws(() => assertJSONSSE('data: {"choices":[]}\n\ndata: [DONE]\n\ndata: [DONE]\n\n', { done: 1 }), /after \[DONE\]/);
  assert.throws(() => assertJSONSSE('data: {"choices":[]}\n\ndata: : ping\n\ndata: [DONE]\n\n', { done: 1 }), /not JSON/);
  assert.throws(() => assertJSONSSE('data: {"choices":[]}', { done: 0 }), /incomplete/);
  assert.throws(() => assertJSONSSE('data: {"choices":[]}\n', { done: 0 }), /incomplete/);
});
