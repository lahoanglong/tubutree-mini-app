// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import { expectNoBannedCopy, wasteItem, wasteOverview, wastePoint } from '@/test-utils/fixtures/waste-admin';
import type { WasteSeed } from './waste-tab';
import { WastePointsSection } from './waste-points-section';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const ALL = [
  wastePoint(),
  wastePoint({ id: 'p2', name: 'Cửa hàng Bé Hai', quotaFull: true, monthUsage: { monthKey: '2026-10', pointsUsed: 100_000, confirmations: 14 } }),
  wastePoint({ id: 'p5', name: 'Tiệm Sách Sáu', hiddenInactive: true }),
  wastePoint({ id: 'wh', kind: 'WAREHOUSE', name: 'Kho Tubu HCM', monthlyQuotaPoints: null, staff: [] }),
];
const OVERVIEW = wasteOverview({
  alerts: [{ kind: 'QUOTA_PACE', pointId: 'p1', pointName: 'Tạp hoá Cô Ba', value: 72, threshold: 60, detail: 'Đã dùng 72% hạn mức trong 10 ngày đầu tháng' }],
});

async function mount(seed?: WasteSeed | null) {
  const api = mockFetch({
    '/admin/waste/points/p5': { body: wastePoint({ id: 'p5', name: 'Tiệm Sách Sáu' }) },
    '/admin/waste/points?status=PENDING': { body: [wastePoint({ id: 'p3', name: 'Quán Nước Mía Tư', status: 'PENDING', staff: [] })] },
    '/admin/waste/points?perkPending=true': { body: [wastePoint({ id: 'p4', name: 'Sạp Báo Năm', perkPendingText: 'Giảm 10% hoá đơn đầu' })] },
    '/admin/waste/points': { body: ALL },
    '/admin/waste/items': { body: [wasteItem()] },
    '/admin/waste/overview': { body: OVERVIEW },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const r = render(<WastePointsSection seed={seed} />);
  mounted.push(r);
  await flush();
  return { api, c: r.container };
}

const row = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-point="${id}"]`)!;
const btn = (root: Element, label: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label) ?? null;
const chip = (c: HTMLElement, label: string) => btn(c.querySelector('[role="group"][aria-label="Lọc điểm nhận"]')!, label)!;

describe('WastePointsSection', () => {
  it('bảng điểm: loại, địa chỉ phường/xã + tỉnh, hạn mức tháng và mức dùng', async () => {
    const { c } = await mount();
    const p1 = row(c, 'p1').textContent!;
    expect(p1).toContain('Đại lý');
    expect(p1).toContain('12 Lê Lợi, Phường Bến Thành, TP. Hồ Chí Minh');
    expect(p1).toContain('40.000 / 100.000 điểm');
    expect(p1).toContain('6 lượt');
    expect(row(c, 'wh').textContent).toContain('Kho Tubu');
    expect(row(c, 'wh').textContent).toContain('Không hạn mức');
  });

  it('điểm dùng hết hạn mức tháng hiện "Tạm dừng, hết hạn mức" (6)', async () => {
    const { c } = await mount();
    expect(row(c, 'p2').textContent).toContain('Tạm dừng, hết hạn mức');
    expect(row(c, 'p1').textContent).not.toContain('Tạm dừng, hết hạn mức');
  });

  it('điểm bị ẩn do không hoạt động có nhãn riêng và nút Kích hoạt lại (5.5)', async () => {
    const { c, api } = await mount();
    expect(row(c, 'p5').textContent).toContain('Ẩn khỏi khách do không hoạt động');
    expect(btn(row(c, 'p5'), 'Kích hoạt lại')).not.toBeNull();
    expect(btn(row(c, 'p1'), 'Kích hoạt lại')).toBeNull();
    const before = api.calls.length;
    click(btn(row(c, 'p5'), 'Kích hoạt lại'));
    await flush();
    const patches = api.calls.filter((x) => x.url.includes('/admin/waste/points/p5') && x.init?.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(JSON.parse(String(patches[0]!.init!.body))).toEqual({ status: 'ACTIVE' });
    expect(api.calls.slice(before).some((x) => x.url.endsWith('/admin/waste/points') && (x.init?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('lọc Tất cả, Chờ duyệt và Ưu đãi chờ duyệt gọi đúng bộ lọc', async () => {
    const { c, api } = await mount();
    const group = c.querySelector('[role="group"][aria-label="Lọc điểm nhận"]')!;
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Tất cả', 'Chờ duyệt', 'Ưu đãi chờ duyệt']);
    expect(chip(c, 'Tất cả').getAttribute('aria-pressed')).toBe('true');
    click(chip(c, 'Chờ duyệt'));
    await flush();
    expect(api.calls.some((x) => x.url.endsWith('/admin/waste/points?status=PENDING'))).toBe(true);
    expect(c.textContent).toContain('Quán Nước Mía Tư');
    click(chip(c, 'Ưu đãi chờ duyệt'));
    await flush();
    expect(api.calls.some((x) => x.url.endsWith('?perkPending=true'))).toBe(true);
    expect(row(c, 'p4').textContent).toContain('Có ưu đãi chờ duyệt');
    click(chip(c, 'Tất cả'));
    await flush();
    expect(chip(c, 'Tất cả').getAttribute('aria-pressed')).toBe('true');
    expect(c.textContent).toContain('Tạp hoá Cô Ba');
  });

  it('seed của hộp việc mở đúng bộ lọc (D3)', async () => {
    const a = await mount({ section: 'points', preset: 'perk', n: 1 });
    expect(chip(a.c, 'Ưu đãi chờ duyệt').getAttribute('aria-pressed')).toBe('true');
    expect(a.api.calls.some((x) => x.url.endsWith('/admin/waste/points?perkPending=true'))).toBe(true);
    const b = await mount({ section: 'points', preset: 'pending', n: 2 });
    expect(chip(b.c, 'Chờ duyệt').getAttribute('aria-pressed')).toBe('true');
    expect(b.api.calls.some((x) => x.url.endsWith('/admin/waste/points?status=PENDING'))).toBe(true);
    const d = await mount({ section: 'gifts', preset: 'overdue', n: 3 });
    expect(chip(d.c, 'Tất cả').getAttribute('aria-pressed')).toBe('true');
  });

  it('Đăng ký điểm mới mở form; đã có kho thì không chọn được loại kho', async () => {
    const { c } = await mount();
    click(btn(c, 'Đăng ký điểm mới'));
    await flush();
    expect(c.querySelector<HTMLInputElement>('input[name="kind"][value="WAREHOUSE"]')!.disabled).toBe(true);
  });

  it('cảnh báo bất thường hiện ở đúng điểm (5.5)', async () => {
    const { c } = await mount();
    expect(c.querySelector('[data-point-alerts="p1"]')!.textContent).toContain('Đã dùng 72% hạn mức trong 10 ngày đầu tháng');
    expect(c.querySelector('[data-point-alerts="p2"]')).toBeNull();
  });

  it('không có chữ cấm, không có câu sai về cộng tác viên', async () => {
    const { c } = await mount();
    expectNoBannedCopy(c.textContent);
    expect(c.textContent).not.toContain('Cộng tác viên không được làm điểm nhận');
  });
});
