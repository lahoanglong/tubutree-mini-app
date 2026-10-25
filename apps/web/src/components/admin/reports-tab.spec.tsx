// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { ReportsTab, reportSectionsFor } from './reports-tab';
import { click, flush, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({
  getRevenueReport: vi.fn(),
  getSourceReport: vi.fn(),
  downloadOrderItemsCsv: vi.fn(),
  downloadOrdersCsv: vi.fn(),
  downloadPitCsv: vi.fn(),
  downloadPayoutsCsv: vi.fn(),
  downloadRefundsCsv: vi.fn(),
}));
vi.mock('@/lib/admin-reports-client', async (orig) => ({ ...(await orig<typeof import('@/lib/admin-reports-client')>()), getRevenueReport: mocks.getRevenueReport, getSourceReport: mocks.getSourceReport, downloadOrderItemsCsv: mocks.downloadOrderItemsCsv, downloadPitCsv: mocks.downloadPitCsv, downloadPayoutsCsv: mocks.downloadPayoutsCsv, downloadRefundsCsv: mocks.downloadRefundsCsv }));
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

const SOURCES = {
  range: { from: '2026-09-19', to: '2026-10-18', days: 30 },
  windowDays: 30,
  rows: [
    { week: '2026-10-12', source: 'shopee', label: 'Shopee', newUsers: 20, firstOrderUsers: 5, secondOrderUsers: 0, revenue: 500_000, firstWindowClosed: false, secondWindowClosed: false },
    { week: '2026-09-21', source: 'card-2610', label: 'Thẻ hộp hàng 2610', newUsers: 10, firstOrderUsers: 4, secondOrderUsers: 1, revenue: 400_000, firstWindowClosed: true, secondWindowClosed: false },
  ],
  bySource: [
    { source: 'shopee', label: 'Shopee', newUsers: 20, firstOrderUsers: 5, secondOrderUsers: 0, revenue: 500_000 },
    { source: 'card-2610', label: 'Thẻ hộp hàng 2610', newUsers: 10, firstOrderUsers: 4, secondOrderUsers: 1, revenue: 400_000 },
  ],
  totals: { newUsers: 30, firstOrderUsers: 9, secondOrderUsers: 1, revenue: 900_000 },
};

beforeEach(() => {
  mocks.getSourceReport.mockResolvedValue(SOURCES);
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

  it('chuyển sang "Khách mới theo đợt thẻ": gọi báo cáo theo chiến dịch, cột đổi tên', async () => {
    const { container } = mount(<ReportsTab sections={['sources']} />);
    await flush();
    const chip = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Khách mới theo đợt thẻ')!;
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    click(chip);
    await flush();
    expect(mocks.getSourceReport).toHaveBeenLastCalledWith({ from: '2026-09-19', to: '2026-10-18' }, 'campaign');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('Chiến dịch');
  });

  it('bảng nguồn × tuần: khách mới, đơn đầu, đơn 2, doanh thu; tuần chưa đóng kỳ ghi "đang tăng"', async () => {
    const { container } = mount(<ReportsTab />);
    await flush();
    expect(mocks.getSourceReport).toHaveBeenCalledWith({ from: '2026-09-19', to: '2026-10-18' }, 'source');
    const total = container.querySelector('tr[data-source-total]')?.textContent ?? '';
    expect(total).toContain('30');
    expect(total).toContain('900.000');
    const shopee = container.querySelector('tr[data-source-row="2026-10-12|shopee"]')?.textContent ?? '';
    expect(shopee).toContain('Tuần 12/10/2026');
    expect(shopee).toContain('Shopee');
    expect(shopee).toContain('5 (25%)');
    expect(shopee).toContain('đang tăng');
    const card = container.querySelector('tr[data-source-row="2026-09-21|card-2610"]')?.textContent ?? '';
    expect(card).toContain('4 (40%)');
    expect(card).toContain('1 (25% của có đơn đầu)');
    expect(container.querySelector('tr[data-source-row="2026-09-21|card-2610"]')?.querySelectorAll('td')[4]?.textContent).toContain('đang tăng');
    expect(container.querySelector('tr[data-source-row="2026-09-21|card-2610"]')?.querySelectorAll('td')[3]?.textContent).not.toContain('đang tăng');
  });

  it('khoảng quá 180 ngày: báo cáo nguồn báo lỗi và không gọi API (báo cáo doanh thu vẫn chạy tới 366 ngày)', async () => {
    const { container } = mount(<ReportsTab />);
    await flush();
    mocks.getSourceReport.mockClear();
    typeInto(container.querySelector<HTMLInputElement>('input[type="date"]'), '2026-01-01');
    await flush();
    expect(container.textContent).toContain('tối đa 180 ngày');
    expect(mocks.getSourceReport).not.toHaveBeenCalled();
    expect(mocks.getRevenueReport).toHaveBeenLastCalledWith({ from: '2026-01-01', to: '2026-10-18' });
  });

  it('không có khách mới: nói rõ', async () => {
    mocks.getSourceReport.mockResolvedValue({ ...SOURCES, rows: [], bySource: [], totals: { newUsers: 0, firstOrderUsers: 0, secondOrderUsers: 0, revenue: 0 } });
    const { container } = mount(<ReportsTab />);
    await flush();
    expect(container.textContent).toContain('Không có khách mới nào trong khoảng ngày này');
  });

  it('chọn nhanh "Tháng trước" cho kỳ kê khai thuế', async () => {
    const { container } = mount(<ReportsTab />);
    await flush();
    click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Tháng trước')!);
    await flush();
    expect(mocks.getRevenueReport).toHaveBeenLastCalledWith({ from: '2026-09-01', to: '2026-09-30' });
  });

  describe('xuất file cho kế toán (D1-14)', () => {
    const btn = (container: HTMLElement, t: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === t)!;

    it('mỗi nút gọi đúng file với khoảng ngày đang chọn và bộ lọc trạng thái', async () => {
      mocks.downloadPitCsv.mockResolvedValue({ filename: 'thue.csv', bytes: 1 });
      mocks.downloadPayoutsCsv.mockResolvedValue({ filename: 'rut.csv', bytes: 1 });
      mocks.downloadRefundsCsv.mockResolvedValue({ filename: 'hoan.csv', bytes: 1 });
      const { container } = mount(<ReportsTab />);
      await flush();
      const range = { from: '2026-09-19', to: '2026-10-18' };
      click(btn(container, 'Xuất CSV thuế TNCN'));
      await flush();
      expect(mocks.downloadPitCsv).toHaveBeenCalledWith(range);
      expect(container.textContent).toContain('Đã tải thue.csv');

      click(btn(container, 'Xuất CSV lệnh rút tiền'));
      await flush();
      expect(mocks.downloadPayoutsCsv).toHaveBeenLastCalledWith(range, undefined);
      const selects = container.querySelectorAll('select');
      selectValue(selects[0]!, 'PAID');
      click(btn(container, 'Xuất CSV lệnh rút tiền'));
      await flush();
      expect(mocks.downloadPayoutsCsv).toHaveBeenLastCalledWith(range, 'PAID');

      selectValue(selects[1]!, 'OPEN');
      click(btn(container, 'Xuất CSV hoàn tiền'));
      await flush();
      expect(mocks.downloadRefundsCsv).toHaveBeenCalledWith(range, 'OPEN');
    });

    it('câu chỉ sang tab rút tiền dùng đúng tên mục trên thanh bên ("Yêu cầu rút tiền")', async () => {
      const { container } = mount(<ReportsTab />);
      await flush();
      expect(container.textContent).toContain('mục Yêu cầu rút tiền');
      expect(container.textContent).not.toContain('Duyệt yêu cầu rút tiền');
    });

    it('lỗi tải (hết phiên, không đủ quyền) hiện thông báo; khoảng ngày sai thì khoá nút', async () => {
      mocks.downloadPitCsv.mockRejectedValue(new Error('Bạn không có quyền.'));
      const { container } = mount(<ReportsTab />);
      await flush();
      click(btn(container, 'Xuất CSV thuế TNCN'));
      await flush();
      expect(container.textContent).toContain('Bạn không có quyền.');
      typeInto(container.querySelector<HTMLInputElement>('input[type="date"]'), '2024-01-01');
      await flush();
      expect(btn(container, 'Xuất CSV thuế TNCN').disabled).toBe(true);
      expect(btn(container, 'Xuất CSV hoàn tiền').disabled).toBe(true);
    });
  });
});

// D1-05: nhân viên chỉ thấy (và chỉ gọi API của) phần báo cáo thuộc nhóm việc của mình.
describe('ReportsTab — phần theo nhóm việc', () => {
  it('marketing (chỉ "sources"): bảng nguồn khách, không gọi báo cáo doanh thu, không có nút xuất file tài chính', async () => {
    const { container } = mount(<ReportsTab sections={['sources']} />);
    await flush();
    expect(mocks.getSourceReport).toHaveBeenCalled();
    expect(mocks.getRevenueReport).not.toHaveBeenCalled();
    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(labels.some((l) => l.includes('Xuất CSV'))).toBe(false);
  });

  it('kế toán ("revenue" + "finance"): doanh thu và file xuất, không gọi báo cáo nguồn', async () => {
    const { container } = mount(<ReportsTab sections={['revenue', 'finance']} />);
    await flush();
    expect(mocks.getRevenueReport).toHaveBeenCalled();
    expect(mocks.getSourceReport).not.toHaveBeenCalled();
    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(labels).toEqual(expect.arrayContaining(['Xuất CSV đơn hàng', 'Xuất CSV thuế TNCN']));
  });
});

describe('reportSectionsFor — khớp @AllowStaff của AdminReportsController', () => {
  it('ADMIN thấy hết; KE_TOAN doanh thu + file tài chính; MARKETING nguồn khách; CSKH/KHO không phần nào', () => {
    expect(reportSectionsFor(true, [])).toEqual(['revenue', 'sources', 'finance']);
    expect(reportSectionsFor(false, ['KE_TOAN'])).toEqual(['revenue', 'finance']);
    expect(reportSectionsFor(false, ['MARKETING'])).toEqual(['sources']);
    expect(reportSectionsFor(false, ['MARKETING', 'KE_TOAN'])).toEqual(['revenue', 'sources', 'finance']);
    expect(reportSectionsFor(false, ['CSKH', 'KHO'])).toEqual([]);
  });
});
