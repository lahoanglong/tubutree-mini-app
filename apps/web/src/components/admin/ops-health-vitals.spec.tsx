// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpsHealthTab } from './ops-health-tab';
import { byText, click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import { scrollRegionProblems, smallTouchTargets } from '@/test-utils/a11y';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const HEALTH = {
  generatedAt: '2026-11-18T03:00:00.000Z',
  thresholds: { unsyncedMinutes: 30, stuckOrders: 1, webhookFailed: 1, queueFailed1h: 5, repeatHours: 6, gomdonBacklogMinutes: 15 },
  pancake: {
    configured: true,
    lastPushOkAt: '2026-11-18T02:55:00.000Z',
    lastWebhookAt: '2026-11-18T02:58:00.000Z',
    lastWebhookProcessedAt: '2026-11-18T02:58:00.000Z',
    webhookFailed24h: 0,
    webhookFailedOpen: 0,
    webhookStuck: 0,
    failedEvents: [],
    unsynced: 0,
    stuck: 0,
    stuckOrders: [],
    attention: 0,
    attentionOrders: [],
    catalog: { lastOkAt: '2026-11-18T02:45:00.000Z', lastErrorAt: null, lastError: null, detail: { count: 120, failed: 0 } },
  },
  gomdon: {
    configured: true,
    connection: { lastOkAt: '2026-11-18T02:00:00.000Z', lastErrorAt: null, lastError: null, credentialsRejected: false },
    credentialsRejected: false,
    lastWebhookAt: null,
    webhookFailed24h: 0,
    webhookFailedOpen: 0,
    failedEvents: [],
    openAlerts: 0,
    alerts: [],
    attention: 0,
    backlog: 0,
    backlogOrders: [],
  },
  queues: { ok: true, items: [] },
  problems: [],
};

const row = (over: Record<string, unknown>) => ({
  platform: 'web',
  name: 'LCP',
  route: '*',
  viewport: 's',
  samples: 120,
  p75: 2300,
  good: 90,
  needsImprovement: 20,
  poor: 10,
  rating: 'good',
  enoughSamples: true,
  ...over,
});

const SUMMARY = (days: number) => ({
  days,
  since: '2026-11-11T03:00:00.000Z',
  minSamples: 50,
  rows: [
    row({}),
    row({ name: 'INP', p75: 620, rating: 'poor', good: 40, needsImprovement: 30, poor: 50 }),
    row({ route: '/san-pham/[slug]', p75: 4100, rating: 'poor', samples: 12, enoughSamples: false, good: 2, needsImprovement: 4, poor: 6 }),
    row({ platform: 'miniapp', name: 'READY', p75: 5200, rating: 'needs-improvement' }),
  ],
});

const mount = async (isAdmin = true) => {
  const api = mockFetch({
    '/admin/ops/health': { body: HEALTH },
    '/admin/perf/vitals?days=28': { body: SUMMARY(28) },
    '/admin/perf/vitals?days=7': { body: SUMMARY(7) },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const r = render(<OpsHealthTab isAdmin={isAdmin} />);
  mounted.push(r);
  await flush();
  return { c: r.container, api };
};

describe('OpsHealthTab — Tốc độ trên máy khách', () => {
  it('lỗi tải số đo không thành báo động của trang Sức khoẻ, có nút Thử lại', async () => {
    const api = mockFetch({ '/admin/ops/health': { body: HEALTH } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<OpsHealthTab />);
    mounted.push(r);
    await flush();
    const card = r.container.querySelector('section[aria-label="Tốc độ trên máy khách"]')!;
    expect(card.textContent).toContain('Không tải được số đo tốc độ.');
    expect(r.container.querySelector('[role="alert"]')).toBeNull();
    click(byText(card as HTMLElement, 'button', 'Thử lại'));
    await flush();
    expect(api.calls.filter((x) => x.url.includes('/admin/perf/vitals')).length).toBeGreaterThanOrEqual(2);
  });

  it('bảng p75 theo route và khung nhìn, tô màu theo ngưỡng, dưới 50 mẫu ghi "chưa đủ mẫu" và không tô màu', async () => {
    const { c } = await mount();
    const card = c.querySelector('section[aria-label="Tốc độ trên máy khách"]')!;
    expect(card).not.toBeNull();
    const rows = [...card.querySelectorAll('tbody tr')].map((tr) => tr.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('Web · Mọi trang');
    expect(rows[0]).toContain('Điện thoại (≤ 480px)');
    expect(rows[0]).toContain('2,3 s (tốt)');
    expect(rows[0]).toContain('620 ms (kém)');
    expect(rows[1]).toContain('/san-pham/[slug]');
    expect(rows[1]).toContain('4,1 s (chưa đủ mẫu)');
    expect(rows[2]).toContain('Mini App · Mọi trang');
    expect(rows[2]).toContain('5,2 s (cần cải thiện)');
    expect(card.querySelector('.text-danger-fg')?.textContent).toContain('620 ms');
    expect(card.querySelector('.text-success-fg')?.textContent).toContain('2,3 s');
    expect([...card.querySelectorAll('.text-danger-fg')].some((x) => x.textContent?.includes('4,1 s'))).toBe(false);
    expect([...card.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Nơi đo', 'LCP', 'INP', 'Mở tới bấm được']);
    expect(card.textContent).toContain('LCP: tốt ≤ 2,5 s, kém > 4,0 s');
    expect(scrollRegionProblems(c)).toEqual([]);
    expect(smallTouchTargets(card as HTMLElement).filter((x) => !x.includes('min-h-[44px]'))).toEqual([]);
  });

  it('đổi sang 28 ngày gọi lại API với days=28', async () => {
    const { c, api } = await mount();
    expect(api.calls.some((x) => x.url.includes('/admin/perf/vitals?days=7'))).toBe(true);
    click(byText(c, 'button', '28 ngày'));
    await flush();
    expect(api.calls.some((x) => x.url.includes('/admin/perf/vitals?days=28'))).toBe(true);
    expect(byText(c, 'button', '28 ngày')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('chưa có số đo: ghi rõ cờ perf.rum_enabled; nhân viên không phải admin thì không gọi API số đo', async () => {
    const empty = mockFetch({ '/admin/ops/health': { body: HEALTH }, '/admin/perf/vitals': { body: { ...SUMMARY(7), rows: [] } } });
    vi.stubGlobal('fetch', vi.fn(empty.fn));
    const r = render(<OpsHealthTab />);
    mounted.push(r);
    await flush();
    expect(r.container.textContent).toContain('Chưa có số đo trong 7 ngày qua. Số đo chỉ được gửi khi cờ perf.rum_enabled đang bật.');

    const { c, api } = await mount(false);
    expect(c.querySelector('section[aria-label="Tốc độ trên máy khách"]')).toBeNull();
    expect(api.calls.some((x) => x.url.includes('/admin/perf/vitals'))).toBe(false);
  });
});
