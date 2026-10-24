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

  it('event không có request vẫn qua', () => {
    expect(scrubEvent({})).toEqual({});
  });
});
