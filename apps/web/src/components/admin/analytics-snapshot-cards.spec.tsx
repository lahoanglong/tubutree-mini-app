// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CohortRepeatRowDTO, FunnelDailyDTO } from '@tubutree/shared-types';
import { flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import { CohortRepeatCard, FunnelDailyCard, cohortCell, funnelRecentTotals, medianCell } from './analytics-snapshot-cards';

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

const cohort = (month: string, over: Partial<CohortRepeatRowDTO> = {}): CohortRepeatRowDTO => ({
  cohortMonth: month,
  newBuyers: 40,
  d30: { count: 6, complete: true },
  d60: { count: 9, complete: true },
  d90: { count: 10, complete: false },
  medianDaysToSecondOrder: 12.5,
  computedAt: '2026-11-24T20:00:00.000Z',
  ...over,
});

const funnelDay = (date: string, sessions: number, placed: number): FunnelDailyDTO => ({
  date,
  sessions: { web: sessions, miniapp: 0, total: sessions },
  rows: [
    { step: 'product_viewed', web: sessions, miniapp: 0, total: sessions },
    { step: 'add_or_buy', web: 0, miniapp: 0, total: 0 },
    { step: 'checkout_started', web: 0, miniapp: 0, total: 0 },
    { step: 'place_order_click', web: placed, miniapp: 0, total: placed },
    { step: 'order_placed', web: placed, miniapp: 0, total: placed },
  ],
});

describe('cohortCell / funnelRecentTotals', () => {
  it('ô cohort: "% (số)", thêm * khi cửa sổ chưa đủ ngày; 0 khách mới thì —', () => {
    expect(cohortCell({ count: 6, complete: true }, 40)).toBe('15% (6)');
    expect(cohortCell({ count: 1, complete: false }, 3)).toBe('33,3% (1)*');
    expect(cohortCell({ count: 0, complete: true }, 0)).toBe('— (0)');
  });

  it('trung vị: dấu phẩy thập phân; nhóm chưa đủ 90 ngày có *; chưa ai có đơn 2 thì —', () => {
    expect(medianCell({ medianDaysToSecondOrder: 12.5, d90: { count: 3, complete: true } })).toBe('12,5 ngày');
    expect(medianCell({ medianDaysToSecondOrder: 9, d90: { count: 3, complete: false } })).toBe('9 ngày*');
    expect(medianCell({ medianDaysToSecondOrder: null, d90: { count: 0, complete: false } })).toBe('—');
  });

  it('tổng N ngày cuối: cộng phiên và đơn đặt thành công, % trên tổng phiên', () => {
    const rows = [funnelDay('2026-11-20', 1000, 50), funnelDay('2026-11-21', 100, 2), funnelDay('2026-11-22', 100, 3)];
    expect(funnelRecentTotals(rows, 2)).toEqual({ sessions: 200, placed: 5, pct: 2.5 });
    expect(funnelRecentTotals([], 7)).toEqual({ sessions: 0, placed: 0, pct: null });
  });
});

describe('CohortRepeatCard', () => {
  it('bảng số dạng tabular-nums: tháng MM/YYYY, khách mới, ba cửa sổ, trung vị dấu phẩy; ô chưa đủ ngày có dấu * và chú thích', async () => {
    const api = mockFetch({ '/admin/analytics/cohort-repeat': { body: [cohort('2026-11', { medianDaysToSecondOrder: null }), cohort('2026-10')] } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<CohortRepeatCard />);
    await flush();
    expect(api.calls[0]!.url).toContain('months=12');
    const section = container.querySelector('section[aria-label="Khách quay lại theo tháng mua đầu"]')!;
    expect(section.querySelector('table')!.className).toContain('tabular-nums');
    const rows = Array.from(section.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.children).map((c) => c.textContent));
    expect(rows).toEqual([
      ['11/2026', '40', '15% (6)', '22,5% (9)', '25% (10)*', '—'],
      ['10/2026', '40', '15% (6)', '22,5% (9)', '25% (10)*', '12,5 ngày*'],
    ]);
    const pending = section.querySelector('tbody tr td[title]');
    expect(pending?.getAttribute('title')).toMatch(/chưa đủ ngày/);
  });

  it('chưa có nhóm nào: lời giải thích; lỗi tải: nút thử lại', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetch({ '/admin/analytics/cohort-repeat': { body: [] } }).fn));
    const a = mount(<CohortRepeatCard />);
    await flush();
    expect(a.container.textContent).toContain('Chưa có nhóm khách nào');
    vi.stubGlobal('fetch', vi.fn(mockFetch({ '/admin/analytics/cohort-repeat': { status: 500, body: { message: 'x' } } }).fn));
    const b = mount(<CohortRepeatCard />);
    await flush();
    expect(b.container.textContent).toContain('Không tải được số khách quay lại theo tháng.');
    expect(b.container.querySelector('button')).not.toBeNull();
  });
});

describe('FunnelDailyCard', () => {
  it('dòng tóm tắt 7 ngày cuối; bảng 14 ngày mới nhất trước, mỗi dòng đủ cột bước và tỉ lệ đặt/phiên', async () => {
    const days = Array.from({ length: 20 }, (_, i) => funnelDay(`2026-11-${String(i + 1).padStart(2, '0')}`, 100 + i, i % 3));
    const api = mockFetch({ '/admin/analytics/funnel-daily': { body: days } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<FunnelDailyCard />);
    await flush();
    expect(api.calls[0]!.url).toContain('days=30');
    const section = container.querySelector('section[aria-label="Phễu mua theo ngày"]')!;
    const last7 = funnelRecentTotals(days, 7);
    expect(section.querySelector('[data-funnel-summary]')!.textContent).toContain(`7 ngày gần nhất: ${last7.sessions} phiên, ${last7.placed} phiên đặt`);
    const trs = Array.from(section.querySelectorAll('tbody tr'));
    expect(trs).toHaveLength(14);
    expect(trs[0]!.firstElementChild!.textContent).toBe('20/11');
    expect(trs[13]!.firstElementChild!.textContent).toBe('07/11');
    expect(Array.from(trs[0]!.children).map((c) => c.textContent)).toEqual(['20/11', '119', '119', '0', '0', '1', '1', '0,8%']);
    expect(section.querySelector('table')!.className).toContain('tabular-nums');
  });

  it('chưa có ngày nào được chốt: lời giải thích, không bảng', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetch({ '/admin/analytics/funnel-daily': { body: [] } }).fn));
    const { container } = mount(<FunnelDailyCard />);
    await flush();
    expect(container.textContent).toContain('Chưa có ngày nào được chốt');
    expect(container.querySelector('table')).toBeNull();
  });
});
