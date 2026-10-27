// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SeasonAdmin, seasonDayEnd, seasonDayStart } from './season-admin';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const ENDED = { id: 's1', name: 'Mùa Xuân', theme: null, region: 'Hà Nội', startAt: '2026-03-01T00:00:00.000Z', endAt: '2026-04-01T00:00:00.000Z', status: 'ENDED' };

describe('SeasonAdmin', () => {
  it('ngày chọn là giờ VN: đầu ngày 00:00 và cuối ngày 23:59:59', () => {
    expect(seasonDayStart('2026-11-01')).toBe('2026-10-31T17:00:00.000Z');
    expect(seasonDayEnd('2026-11-30')).toBe('2026-11-30T16:59:59.000Z');
  });

  it('không có mùa chạy thì báo rõ; tạo mùa mới gửi POST với ngày giờ VN', async () => {
    const m = mockFetch({ '/admin/engagement/seasons': (init?: RequestInit) => ({ body: init?.method === 'POST' ? { ...ENDED, id: 's2', status: 'UPCOMING' } : [ENDED] }) });
    vi.stubGlobal('fetch', vi.fn(m.fn));
    const r = render(<SeasonAdmin />);
    mounted.push(r);
    await flush();
    expect(r.container.textContent).toContain('Hiện không có mùa nào đang chạy');
    expect(r.container.textContent).toContain('Đã hết hạn');
    typeInto(r.container.querySelector('input[name="season-name"]')!, 'Mùa Thu');
    typeInto(r.container.querySelector('input[name="season-start"]')!, '2026-11-01');
    typeInto(r.container.querySelector('input[name="season-end"]')!, '2026-11-30');
    click(byText(r.container, 'button', 'Tạo mùa'));
    await flush();
    const post = m.calls.find((c) => c.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ name: 'Mùa Thu', startAt: '2026-10-31T17:00:00.000Z', endAt: '2026-11-30T16:59:59.000Z' });
  });
});
