import { Writable } from 'stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { LOG_REDACT_PATHS } from '../src/platform/logging/logger.module';

function logOnce(obj: Record<string, unknown>): string {
  let out = '';
  const sink = new Writable({
    write(chunk, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  pino({ redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' } }, sink).info(obj, 'request completed');
  return out;
}

describe('log redaction', () => {
  it('hides admin key, session cookies and authorization in HTTP request logs', () => {
    const line = logOnce({
      req: {
        method: 'POST',
        url: '/v1/users',
        headers: {
          authorization: 'Bearer metrics-token-secret',
          'x-admin-key': 'admin-key-secret',
          cookie: 'wrm_session=session-secret-1',
        },
      },
      res: { statusCode: 201, headers: { 'set-cookie': 'wrm_session=session-secret-2; HttpOnly' } },
    });
    for (const secret of ['metrics-token-secret', 'admin-key-secret', 'session-secret-1', 'session-secret-2']) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain('/v1/users'); // the rest of the log line stays readable
  });

  it('hides password and API key fields', () => {
    const line = logOnce({ body: { email: 'a@b.c', password: 'pw-secret' }, cfg: { apiKey: 'aba-secret' } });
    expect(line).not.toContain('pw-secret');
    expect(line).not.toContain('aba-secret');
    expect(line).toContain('a@b.c');
  });
});
