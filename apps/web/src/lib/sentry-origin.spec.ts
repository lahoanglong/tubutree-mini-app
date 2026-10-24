import { describe, expect, it } from 'vitest';
import { sentryOrigin } from './sentry-origin.mjs';

describe('sentryOrigin', () => {
  it('lấy origin từ DSN, bỏ khoá và id dự án', () => {
    expect(sentryOrigin('https://abc123@o1.ingest.sentry.io/42')).toBe('https://o1.ingest.sentry.io');
    expect(sentryOrigin('https://k@glitchtip.example.com:8443/1')).toBe('https://glitchtip.example.com:8443');
  });
  it.each([undefined, '', 'not-a-dsn'])('%p → rỗng', (v) => {
    expect(sentryOrigin(v)).toBe('');
  });
});
