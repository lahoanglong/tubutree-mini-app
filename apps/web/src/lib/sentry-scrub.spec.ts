import { describe, expect, it } from 'vitest';
import { scrubEvent } from './sentry-scrub';

describe('scrubEvent', () => {
  it('bỏ cookie, header xác thực, thân, query; cắt query và hash khỏi URL; xoá breadcrumb', () => {
    const out = scrubEvent({
      request: {
        url: 'https://app.example.com/thanh-toan?token=abc#x',
        query_string: 'token=abc',
        cookies: { a: '1' },
        data: { phone: '0901' },
        headers: { Authorization: 'Bearer t', Cookie: 'a=b', 'User-Agent': 'ua' },
      },
      breadcrumbs: [{ message: 'click' }],
    });
    expect(out.request).toEqual({ url: 'https://app.example.com/thanh-toan', headers: { 'User-Agent': 'ua' } });
    expect(out.breadcrumbs).toEqual([]);
  });

  it('chỉ giữ header vô hại, referer bị cắt query', () => {
    const out = scrubEvent({
      request: {
        headers: { 'x-accesstrade-token': 'AT', 'x-webhook-token': 's', authorization: 'B', cookie: 'c', 'user-agent': 'ua', Referer: 'https://app.x.com/cb?code=Z&state=S' },
      },
    });
    expect(out.request!.headers).toEqual({ 'user-agent': 'ua', Referer: 'https://app.x.com/cb' });
  });

  it('không init SDK với tracesSampleRate (0 vẫn bật span và nạp thêm integration OTel)', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['sentry-client.ts', 'sentry-server.ts']) {
      expect(readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')).not.toMatch(/tracesSampleRate:/);
    }
  });

  it('event không có request vẫn qua', () => {
    expect(scrubEvent({})).toEqual({});
  });
});
