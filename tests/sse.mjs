import assert from 'node:assert/strict';

// Parse what a real SSE client receives, not substrings in the HTTP body.
export function assertJSONSSE(text, { done = 0, allowErrors = false } = {}) {
  const events = [];
  let fields = [];
  let event = '';
  let terminals = 0;
  const dispatch = () => {
    if (!fields.length) { event = ''; return; }
    const data = fields.join('\n');
    fields = [];
    assert.equal(terminals, 0, 'Received an SSE event after [DONE]');
    if (data === '[DONE]') { terminals++; event = ''; return; }
    let value;
    try { value = JSON.parse(data); }
    catch { assert.fail('SSE data is not JSON: ' + data.slice(0, 180)); }
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Expected a JSON object in SSE data');
    if (!allowErrors) assert.ok(!value.error, 'Unexpected SSE error: ' + JSON.stringify(value.error));
    events.push({ event, value });
    event = '';
  };
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    if (line === '') { dispatch(); continue; }
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const name = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (name === 'data') fields.push(value);
    if (name === 'event') event = value;
  }
  assert.equal(fields.length, 0, 'SSE stream ended with an incomplete event');
  assert.equal(terminals, done, 'Unexpected number of [DONE] events');
  assert.ok(events.length, 'SSE stream did not contain JSON events');
  return events;
}
