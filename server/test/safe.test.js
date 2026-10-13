import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, sendError, errorHandler } from '../src/safe.js';

const fakeRes = () => {
  const res = { headersSent: false, code: 0, body: null };
  res.status = (c) => ((res.code = c), res);
  res.json = (b) => ((res.body = b), res);
  return res;
};
const quiet = (fn) => {
  const orig = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  try { fn(); } finally { console.error = orig; }
  return logged;
};

test('redact removes the server key values and key-shaped text', () => {
  process.env.FASHN_API_KEY = 'fa-secret-value-123456';
  const text = redact('bad key fa-secret-value-123456, sk-ant-api03-abcDEF_12-x, hf_abcdefghijklmnopqrstu, Authorization: Bearer abc.def, https://x.io/a?key=zzz&b=1');
  for (const leak of ['fa-secret-value-123456', 'sk-ant-api03', 'hf_abcdefghij', 'abc.def', 'zzz']) assert.ok(!text.includes(leak), `${leak} leaked: ${text}`);
  assert.match(text, /\?key=\[redacted\]&b=1/);
  delete process.env.FASHN_API_KEY;
});

test('unexpected errors send a generic message and log a scrubbed stack', () => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-supersecret';
  const res = fakeRes();
  const logged = quiet(() => sendError(res, new Error('upstream said sk-ant-api03-supersecret is invalid')));
  assert.equal(res.code, 500);
  assert.ok(!JSON.stringify(res.body).includes('supersecret'));
  assert.ok(!logged.join('').includes('supersecret'));
  delete process.env.ANTHROPIC_API_KEY;
});

test('expected errors keep their message and status, scrubbed', () => {
  const err = Object.assign(new Error('The try-on model failed: Bearer abc123'), { status: 502 });
  const res = fakeRes();
  sendError(res, err, { expected: true, extra: { blocked: false } });
  assert.equal(res.code, 502);
  assert.equal(res.body.error, 'The try-on model failed: [redacted]');
  assert.equal(res.body.blocked, false);
});

test('the Express error handler never returns a stack trace', () => {
  const res = fakeRes();
  errorHandler(Object.assign(new SyntaxError('Unexpected token'), { status: 400 }), {}, res, () => {});
  assert.deepEqual([res.code, res.body], [400, { error: 'The request was not valid.' }]);
  const res2 = fakeRes();
  quiet(() => errorHandler(new Error('boom'), {}, res2, () => {}));
  assert.equal(res2.code, 500);
  assert.ok(!('stack' in res2.body));
});
