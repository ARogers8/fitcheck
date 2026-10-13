/**
 * Keeps API keys out of anything the server sends back or logs. Error text can come
 * from other services (FASHN, Hugging Face, Anthropic, stores), so every message is
 * scrubbed of the server's secret values and anything shaped like a key.
 */
const SECRET_ENV = /KEY|TOKEN|SECRET|PASSWORD/i;
const KEY_SHAPES = [
  /sk-ant-[A-Za-z0-9_-]+/g, // Anthropic
  /\bhf_[A-Za-z0-9]{16,}/g, // Hugging Face
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, // auth headers
  /([?&](?:api[_-]?key|key|token|access_token)=)[^&\s"']+/gi, // keys in URLs
];

const secretValues = () =>
  Object.entries(process.env)
    .filter(([name, value]) => SECRET_ENV.test(name) && value && value.length >= 8)
    .map(([, value]) => value);

export function redact(text) {
  let out = String(text ?? '');
  for (const value of secretValues()) out = out.split(value).join('[redacted]');
  return KEY_SHAPES.reduce((s, re) => s.replace(re, (_m, prefix) => (typeof prefix === 'string' && prefix.endsWith('=') ? `${prefix}[redacted]` : '[redacted]')), out);
}

/** Logs an unexpected error with its stack, scrubbed. */
export const logError = (label, err) => console.error(label, redact(err?.stack || err?.message || err));

const GENERIC = 'Something went wrong on the server. Please try again.';

/**
 * Sends an error as JSON. Errors the server raised on purpose (they carry a status)
 * keep their message, scrubbed; anything unexpected gets a generic message, and the
 * details only go to the server log.
 */
export function sendError(res, err, { expected = false, extra = {} } = {}) {
  const status = expected && Number.isInteger(err?.status) ? err.status : 500;
  if (status >= 500 && !expected) logError('[error]', err);
  res.status(status).json({ error: expected ? redact(err.message) : GENERIC, ...extra });
}

/** Last Express handler: bad JSON bodies, oversized uploads, anything thrown. Never a stack trace. */
export function errorHandler(err, _req, res, next) {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) logError('[error]', err);
  const message = status === 413 ? 'That upload is too large.' : status === 400 ? 'The request was not valid.' : GENERIC;
  res.status(status).json({ error: message });
}
