// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
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

  it('cột nhân viên không đếm người đã gỡ', async () => {
    const staff = (userId: string, isActive: boolean) => ({ userId, role: 'STAFF' as const, isActive, fullName: userId, phone: null });
    const api = mockFetch({
      '/admin/waste/points': { body: [wastePoint({ id: 'p9', staff: [staff('a', true), staff('b', false), staff('c', false)] })] },
      '/admin/waste/items': { body: [wasteItem()] },
      '/admin/waste/overview': { body: OVERVIEW },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<WastePointsSection seed={null} />);
    mounted.push(r);
    await flush();
    expect(row(r.container, 'p9').textContent).toContain('1 nhân viên');
    expect(row(r.container, 'p9').textContent).not.toContain('3 nhân viên');
  });

  it('bảng điểm: 7 cột và bề rộng tối thiểu vừa cột nội dung 1280 px, lượt xác nhận và nhân viên chung một ô', async () => {
    const { c } = await mount();
    const heads = Array.from(c.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(heads).toEqual(['Điểm', 'Giờ mở cửa', 'Hàng nhận', 'Trạng thái', 'Hạn mức tháng', 'Lượt và nhân viên', 'Thao tác']);
    expect(c.querySelector('table')!.className).toContain('min-w-[900px]');
    expect(row(c, 'p1').textContent).toMatch(/6 lượt\d+ nhân viên/);
  });

  it('bảng điểm: giờ mở cửa, hàng nhận và thanh mức dùng đổi màu theo cảnh báo và khi đầy', async () => {
    const { c } = await mount();
    expect(row(c, 'p1').textContent).toContain('T2 08:00–20:00');
    expect(row(c, 'p1').textContent).toContain('Thùng carton cũ');
    expect(row(c, 'wh').querySelector('[role="progressbar"]')).toBeNull();
    const bar = (id: string) => row(c, id).querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(bar('p1').getAttribute('aria-valuenow')).toBe('40');
    expect(bar('p1').getAttribute('data-quota-bar')).toBe('bg-warning-fg');
    expect(bar('p2').getAttribute('aria-valuenow')).toBe('100');
    expect(bar('p2').getAttribute('data-quota-bar')).toBe('bg-danger-fg');
    expect(bar('p5').getAttribute('data-quota-bar')).toBe('bg-forest-600');
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

  it('Chi tiết mở chi tiết điểm (người ở điểm, ưu đãi, nhật ký, số lượng tháng)', async () => {
    const api = mockFetch({
      '/admin/waste/points/p1/report': { body: { pointId: 'p1', month: '2026-10', confirmations: 0, pointsAwarded: 0, quotaUsed: 0, units: [] } },
      '/admin/waste/requests': { body: { rows: [], nextCursor: null } },
      '/admin/waste/points/p5': { body: wastePoint({ id: 'p5', name: 'Tiệm Sách Sáu' }) },
      '/admin/waste/points': { body: ALL },
      '/admin/waste/items': { body: [wasteItem()] },
      '/admin/waste/overview': { body: OVERVIEW },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<WastePointsSection />);
    mounted.push(r);
    await flush();
    expect(r.container.querySelector('[data-point-detail]')).toBeNull();
    click(btn(row(r.container, 'p1'), 'Chi tiết'));
    await flush();
    expect(r.container.querySelector('[data-point-detail="p1"]')).not.toBeNull();
    expectNoBannedCopy(r.container.textContent);
  });

  it('mở chi tiết điểm khác thì bỏ người đã chọn và vai Chủ điểm của điểm trước', async () => {
    const api = mockFetch({
      '/admin/waste/points/pa/report': { body: { pointId: 'pa', month: '2026-10', confirmations: 0, pointsAwarded: 0, quotaUsed: 0, units: [] } },
      '/admin/waste/points/p1/report': { body: { pointId: 'p1', month: '2026-10', confirmations: 0, pointsAwarded: 0, quotaUsed: 0, units: [] } },
      '/admin/waste/requests': { body: { rows: [], nextCursor: null } },
      '/admin/users': { body: { data: [{ id: 'u7', fullName: 'Phạm Bảy', phone: '0907000777', role: 'CUSTOMER', pointsBalance: 0, createdAt: '2026-01-01T00:00:00.000Z' }], meta: { page: 1, limit: 8, total: 1 } } },
      '/admin/waste/points': { body: [wastePoint({ id: 'pa', name: 'Điểm chưa có chủ', staff: [] }), wastePoint()] },
      '/admin/waste/items': { body: [wasteItem()] },
      '/admin/waste/overview': { body: OVERVIEW },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<WastePointsSection />);
    mounted.push(r);
    await flush();
    const c = r.container;
    click(btn(row(c, 'pa'), 'Chi tiết'));
    await flush();
    selectValue(c.querySelector('select[name="staffRole"]'), 'OWNER');
    typeInto(c.querySelector('input[type="search"]'), '0907');
    await new Promise((res) => setTimeout(res, 500));
    await flush();
    click(c.querySelector('[role="option"]'));
    expect(btn(c.querySelector('[data-point-detail="pa"]')!, 'Thêm người')!.disabled).toBe(false);
    click(btn(row(c, 'p1'), 'Chi tiết'));
    await flush();
    const detail = c.querySelector('[data-point-detail="p1"]')!;
    expect(detail.querySelector<HTMLSelectElement>('select[name="staffRole"]')!.value).toBe('STAFF');
    expect(btn(detail, 'Thêm người')!.disabled).toBe(true);
    expect(detail.textContent).not.toContain('Phạm Bảy');
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
