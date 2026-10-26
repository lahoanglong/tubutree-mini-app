// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnalyticsTab } from './analytics-tab';
import { flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import type { RetentionDailyRow } from '@/lib/admin-client';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};

const row = (date: string, over: Partial<RetentionDailyRow> = {}): RetentionDailyRow => ({
  date,
  newBuyers: 3,
  activeBuyers: 10,
  ordersCount: 7,
  ordersPerBuyerMtd: 1.25,
  dauProxyRefreshToken: 12,
  dauEventBased: null,
  ns1CohortSize: null,
  ns1RepeatCount: null,
  ...over,
});

// C-097 (Q-25/Q-29): tab Phân tích dùng token DS v2; bảng số liệu cuộn ngang trong khung riêng ở 390px.
describe('AnalyticsTab — DS v2', () => {
  it('hiện thẻ số liệu hôm qua (lấy dòng cuối) và bảng 30 ngày trong khung cuộn ngang, thẻ dùng token card', async () => {
    const api = mockFetch({
      '/admin/analytics/retention-daily': { body: [row('2026-10-09', { newBuyers: 1 }), row('2026-10-10', { newBuyers: 5, ordersCount: 9 })] },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<AnalyticsTab />);
    await flush();
    expect(api.calls[0]!.url).toContain('days=30');
    const t = container.textContent ?? '';
    expect(t).toContain('Khách mới hôm qua5');
    expect(t).toContain('Đơn hôm qua9');
    expect(t).toContain('1.25');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.querySelector('table')?.parentElement?.className).toContain('overflow-x-auto');
    const card = Array.from(container.querySelectorAll('div')).find((d) => d.textContent?.startsWith('Khách mới hôm qua') && d.className.includes('border'));
    expect(card?.className).toContain('rounded-card');
    expect(card?.className).toContain('bg-stone-0');
  });

  // e2e (apps/e2e/tests/admin-analytics.spec.ts) định vị thẻ qua role+tên, không qua class styling.
  it('mỗi thẻ số liệu là role="group" có tên = nhãn thẻ, chứa đúng giá trị của thẻ đó', async () => {
    const api = mockFetch({
      '/admin/analytics/retention-daily': { body: [row('2026-10-10', { newBuyers: 5, ordersCount: 9 })] },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<AnalyticsTab />);
    await flush();
    const groups = Array.from(container.querySelectorAll('[role="group"]'));
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([
      'Khách mới hôm qua',
      'Khách hoạt động hôm qua',
      'Đơn hôm qua',
      'Đơn/khách/tháng (luỹ kế)',
    ]);
    const newBuyers = container.querySelector('[role="group"][aria-label="Khách mới hôm qua"]');
    expect(newBuyers?.textContent).toBe('Khách mới hôm qua5');
    expect(container.querySelector('[role="group"][aria-label="Đơn hôm qua"]')?.textContent).toBe('Đơn hôm qua9');
  });

  it('chưa có snapshot và lỗi tải: thông báo bằng token (stone-500 / danger-fg)', async () => {
    const empty = mockFetch({ '/admin/analytics/retention-daily': { body: [] } });
    vi.stubGlobal('fetch', vi.fn(empty.fn));
    const a = mount(<AnalyticsTab />);
    await flush();
    expect(a.container.querySelector('p')?.textContent).toMatch(/Chưa có số liệu.*sáng mai/);
    expect(a.container.querySelector('p')?.className).toContain('text-stone-500');

    const bad = mockFetch({ '/admin/analytics/retention-daily': { status: 500, body: { message: 'x' } } });
    vi.stubGlobal('fetch', vi.fn(bad.fn));
    const b = mount(<AnalyticsTab />);
    await flush();
    expect(b.container.querySelector('p')?.className).toContain('text-danger-fg');
  });
});
