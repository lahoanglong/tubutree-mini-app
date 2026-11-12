// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AdvisorStatsDto } from '@tubutree/shared-types';
import { AdvisorStatsCard } from './advisor-stats-card';
import { byText, click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});
const mount = () => {
  const r = render(<AdvisorStatsCard />);
  mounted.push(r);
  return r;
};

const STATS: AdvisorStatsDto = {
  since: '2026-11-12T01:04:00.000Z',
  total: 120,
  ok: 90,
  fallback: 30,
  latencyP95Ms: 3240,
  latencySamples: 100,
  topSkus: [
    { slug: 'nuoc-rua-chen', name: 'Nước rửa chén Fuwa3e 500ml', count: 14 },
    { slug: 'xit-tram', name: 'Xịt tràm cho bé Pineboo 150ml', count: 9 },
  ],
};
const stub = (body: Partial<AdvisorStatsDto> = {}) => {
  const m = mockFetch({ '/admin/ai-advisor/stats': { body: { ...STATS, ...body } } });
  vi.stubGlobal('fetch', m.fn);
  return m;
};
const stat = (r: Rendered, label: string) => r.container.querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`)!;

describe('AdvisorStatsCard', () => {
  it('gọi đúng một lần GET /admin/ai-advisor/stats và hiện tổng, AI/dự phòng kèm phần trăm, p95 theo giây', async () => {
    const m = stub();
    const r = mount();
    await flush(10);
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]!.url).toContain('/admin/ai-advisor/stats');
    expect(r.container.querySelector('h2')!.textContent).toBe('AI tư vấn khách');
    expect(stat(r, 'Tổng lượt hỏi').textContent).toContain('120');
    expect(stat(r, 'AI trả lời').textContent).toContain('90');
    expect(stat(r, 'AI trả lời').textContent).toContain('75%');
    expect(stat(r, 'Trả lời dự phòng').textContent).toContain('30');
    expect(stat(r, 'Trả lời dự phòng').textContent).toContain('25%');
    expect(stat(r, 'Độ trễ p95').textContent).toContain('3,2 giây');
    expect(stat(r, 'Độ trễ p95').textContent).toContain('trên 100 lượt gần nhất');
  });

  it('top SKU gợi ý: tên và số lần, theo thứ tự máy chủ trả', async () => {
    stub();
    const r = mount();
    await flush(10);
    const items = Array.from(r.container.querySelectorAll('ol[aria-label="Sản phẩm được gợi ý nhiều nhất"] > li')).map((li) => li.textContent);
    expect(items).toEqual(['Nước rửa chén Fuwa3e 500ml14 lần', 'Xịt tràm cho bé Pineboo 150ml9 lần']);
  });

  it('p95 chưa có mẫu (null): hiện "—", không hiện "0 giây"', async () => {
    stub({ latencyP95Ms: null, latencySamples: 0 });
    const r = mount();
    await flush(10);
    const p95 = stat(r, 'Độ trễ p95').textContent!;
    expect(p95).toContain('—');
    expect(p95).not.toContain('giây');
    expect(p95).not.toContain('lượt gần nhất');
  });

  it('ghi chú nói rõ mốc tính theo giờ Việt Nam (không in chuỗi ISO), khởi động lại là về 0, chưa đo lượt bấm', async () => {
    stub();
    const r = mount();
    await flush(10);
    const t = r.container.textContent!;
    expect(t).toContain('Tính từ 08:04 12/11/2026 (giờ Việt Nam); khởi động lại API là về 0. Chưa đo lượt bấm.');
    expect(t).not.toContain('2026-11-12');
    expect(t).not.toContain('T01:04');
  });

  it('mọi con số đều tabular-nums', async () => {
    stub();
    const r = mount();
    await flush(10);
    for (const label of ['Tổng lượt hỏi', 'AI trả lời', 'Trả lời dự phòng', 'Độ trễ p95']) {
      const g = stat(r, label);
      expect(g.querySelector('.tabular-nums'), label).not.toBeNull();
      expect(g.querySelector('.text-lg')!.className).toContain('tabular-nums');
    }
    for (const li of Array.from(r.container.querySelectorAll('ol li'))) expect(li.querySelector('.tabular-nums')).not.toBeNull();
  });

  it('0 lượt hỏi: hiện trạng thái trống, không dựng thẻ số, vẫn có ghi chú mốc đo', async () => {
    stub({ total: 0, ok: 0, fallback: 0, latencyP95Ms: null, latencySamples: 0, topSkus: [] });
    const r = mount();
    await flush(10);
    const t = r.container.textContent!;
    expect(t).toContain('Chưa có lượt hỏi nào');
    expect(r.container.querySelector('[role="group"]')).toBeNull();
    expect(t).toContain('Tính từ 08:04 12/11/2026');
    expect(t).not.toContain('NaN');
  });

  it('có lượt hỏi nhưng chưa có sản phẩm nào được gợi ý: nói rõ thay vì để trống', async () => {
    stub({ topSkus: [] });
    const r = mount();
    await flush(10);
    expect(r.container.textContent).toContain('Chưa có sản phẩm nào được gợi ý.');
    expect(r.container.querySelector('ol')).toBeNull();
  });

  it('đang tải: khung xương có aria-busy, chưa có số', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => (release = res));
    const m = mockFetch({ '/admin/ai-advisor/stats': { body: STATS } });
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      await gate;
      return m.fn(url, init);
    });
    const r = mount();
    await flush(2);
    const sk = r.container.querySelector('[data-skeleton="stats"]')!;
    expect(sk.getAttribute('aria-busy')).toBe('true');
    expect(sk.getAttribute('aria-label')).toBe('Đang tải thống kê AI tư vấn');
    expect(r.container.querySelector('[role="group"]')).toBeNull();
    release();
    await flush(10);
    expect(r.container.querySelector('[data-skeleton="stats"]')).toBeNull();
    expect(stat(r, 'Tổng lượt hỏi')).not.toBeNull();
  });

  it('lỗi: báo lỗi kèm Thử lại (44px); thử lại thành công thì hiện số', async () => {
    let fail = true;
    const m = mockFetch({ '/admin/ai-advisor/stats': () => (fail ? { status: 500, body: { message: 'x' } } : { body: STATS }) });
    vi.stubGlobal('fetch', m.fn);
    const r = mount();
    await flush(10);
    const alert = r.container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Không tải được thống kê AI tư vấn');
    expect(r.container.querySelector('[role="group"]')).toBeNull();
    const retry = byText(alert, 'button', 'Thử lại')!;
    expect(retry.className).toMatch(/min-h-\[44px\]/);
    fail = false;
    click(retry);
    await flush(10);
    expect(r.container.querySelector('[role="alert"]')).toBeNull();
    expect(stat(r, 'Tổng lượt hỏi').textContent).toContain('120');
    expect(m.calls).toHaveLength(2);
  });

  it('403: nói đúng lời máy chủ trả cho lỗi nghiệp vụ, không rơi về câu chung', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/admin/ai-advisor/stats': { status: 403, body: { message: 'Chỉ quản trị viên được xem.' } } }).fn);
    const r = mount();
    await flush(10);
    expect(r.container.querySelector('[role="alert"]')!.textContent).toContain('Chỉ quản trị viên được xem.');
  });
});
