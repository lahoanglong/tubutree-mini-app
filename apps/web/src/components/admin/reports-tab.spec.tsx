// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { ReportsTab } from './reports-tab';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({
  getRevenueReport: vi.fn(),
  downloadOrderItemsCsv: vi.fn(),
  downloadOrdersCsv: vi.fn(),
}));
vi.mock('@/lib/admin-reports-client', async (orig) => ({ ...(await orig<typeof import('@/lib/admin-reports-client')>()), getRevenueReport: mocks.getRevenueReport, downloadOrderItemsCsv: mocks.downloadOrderItemsCsv }));
vi.mock('@/lib/admin-client', async (orig) => ({ ...(await orig<typeof import('@/lib/admin-client')>()), downloadOrdersCsv: mocks.downloadOrdersCsv }));

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};

const cell = (over: Record<string, unknown>) => ({ orders: 0, cancelled: 0, paidOrders: 0, gross: 0, partialRefund: 0, revenue: 0, gmv: 0, ...over });
const REPORT = {
  range: { from: '2026-09-19', to: '2026-10-18', days: 30 },
  basis: 'ngày đặt đơn, giờ Việt Nam',
  totals: { ...cell({ orders: 6, cancelled: 1, paidOrders: 4, gross: 480_000, partialRefund: 30_000, revenue: 450_000, gmv: 500_000 }), newUsers: 9 },
  byDay: [
    { ...cell({ orders: 4, revenue: 300_000 }), day: '2026-10-17', channel: 'checkout', label: 'Giỏ hàng' },
    { ...cell({ orders: 2, revenue: 150_000 }), day: '2026-10-18', channel: 'storefront', label: 'Gian hàng (khách tự mua)' },
  ],
  byChannel: [
    { ...cell({ revenue: 300_000 }), key: 'checkout', label: 'Giỏ hàng' },
    { ...cell({ revenue: 150_000 }), key: 'storefront', label: 'Gian hàng (khách tự mua)' },
  ],
  byPlatform: [],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-17T20:00:00Z'));
  mocks.getRevenueReport.mockResolvedValue(REPORT);
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('ReportsTab (D1-04: báo cáo theo khoảng ngày)', () => {
  it('mặc định 30 ngày gần nhất theo giờ VN và gọi API với đúng khoảng đó', async () => {
    const { container } = mount(<ReportsTab />);
    await flush();
    const [from, to] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]'));
    expect([from!.value, to!.value]).toEqual(['2026-09-19', '2026-10-18']);
    expect(mocks.getRevenueReport).toHaveBeenCalledWith({ from: '2026-09-19', to: '2026-10-18' });
  });

  it('KPI và bảng ngày × kênh, cộng cuối bảng bằng tổng KPI', async () => {
    const { container } = mount(<ReportsTab />);
    await flush();
    expect(container.querySelector('[data-kpi="Doanh thu (đã thu)"]')?.textContent).toContain('450.000');
    expect(container.querySelector('[data-kpi="Đơn huỷ / trả"]')?.textContent).toContain('1');
    expect(container.querySelector('[data-kpi="Khách mới"]')?.textContent).toContain('9');
    const rows = Array.from(container.querySelectorAll('tr[data-day]'));
    expect(rows.map((r) => r.getAttribute('data-day'))).toEqual(['2026-10-18', '2026-10-17']);
    expect(container.querySelector('tr[data-total]')?.textContent).toContain('450.000');
    expect(container.querySelector('thead')?.textContent).toContain('Gian hàng (khách tự mua)');
  });

  it('đổi khoảng ngày thì tải lại; khoảng quá 366 ngày báo lỗi và không gọi API', async () => {
    const { container } = mount(<ReportsTab />);
    await flush();
    const from = container.querySelector<HTMLInputElement>('input[type="date"]')!;
    typeInto(from, '2026-10-01');
    await flush();
    expect(mocks.getRevenueReport).toHaveBeenLastCalledWith({ from: '2026-10-01', to: '2026-10-18' });
    mocks.getRevenueReport.mockClear();
    typeInto(from, '2024-01-01');
    await flush();
    expect(container.textContent).toContain('tối đa 366 ngày');
    expect(mocks.getRevenueReport).not.toHaveBeenCalled();
  });

  it('chọn nhanh 7 ngày', async () => {
    const { container } = mount(<ReportsTab />);
    await flush();
    const chip = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '7 ngày')!;
    click(chip);
    await flush();
    expect(mocks.getRevenueReport).toHaveBeenLastCalledWith({ from: '2026-10-12', to: '2026-10-18' });
  });

  it('xuất CSV đơn và CSV dòng hàng theo khoảng ngày đang chọn; lỗi hiện thông báo', async () => {
    mocks.downloadOrdersCsv.mockResolvedValue({ filename: 'don-hang.csv', bytes: 10 });
    mocks.downloadOrderItemsCsv.mockRejectedValue(new Error('Hết phiên'));
    const { container } = mount(<ReportsTab />);
    await flush();
    const btn = (t: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === t)!;
    click(btn('Xuất CSV đơn hàng'));
    await flush();
    expect(mocks.downloadOrdersCsv).toHaveBeenCalledWith({ from: '2026-09-19', to: '2026-10-18' });
    expect(container.textContent).toContain('Đã tải don-hang.csv');
    click(btn('Xuất CSV theo dòng hàng'));
    await flush();
    expect(mocks.downloadOrderItemsCsv).toHaveBeenCalledWith({ from: '2026-09-19', to: '2026-10-18' });
    expect(container.textContent).toContain('Hết phiên');
  });

  it('không có đơn trong khoảng: nói rõ thay vì bảng trống', async () => {
    mocks.getRevenueReport.mockResolvedValue({ ...REPORT, byDay: [], byChannel: [], totals: { ...REPORT.totals, orders: 0, revenue: 0 } });
    const { container } = mount(<ReportsTab />);
    await flush();
    expect(container.textContent).toContain('Không có đơn nào trong khoảng ngày này');
  });
});
