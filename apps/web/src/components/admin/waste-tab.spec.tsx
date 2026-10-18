// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import { expectNoBannedCopy, wasteMetrics, wasteOverview } from '@/test-utils/fixtures/waste-admin';
import type { WasteOverviewDTO } from '@tubutree/shared-types';
import { WasteTab } from './waste-tab';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});
afterEach(() => {
  window.history.replaceState(null, '', '/');
});
beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:1'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
});

const OVERVIEW: WasteOverviewDTO = wasteOverview({
  current: wasteMetrics({
    pointsIssued: 480_000,
    pointsReversed: 30_000,
    requestsCreatedByMethod: { DROP_OFF: 12, MAIL_IN: 5, PICKUP: 0 },
    completeHoursP50: 26,
    completeHoursP90: 70,
    expiredCount: 2,
    carrierCostVnd: 64000,
    costVndPer1000PointsIssued: 133,
    rejectionsByReason: { ...wasteMetrics().rejectionsByReason, HAZARDOUS: 2 },
    receivedDeclaredPctByMethod: { DROP_OFF: 86.7, MAIL_IN: 100, PICKUP: null },
    quotaByPoint: [{ pointId: 'p1', pointName: 'Tạp hoá Cô Ba', quota: 100_000, used: 40_000, confirmations: 6 }],
    unitsByItem: [{ itemId: 'i1', itemName: 'Thùng carton cũ', unitLabel: 'thùng', qty: 40 }],
    receivedWeightGrams: 2500,
    estimatedWeightGrams: 3000,
    ordersOfExchangers: 5,
    ordersOfNonExchangers: 12,
  }),
  previous: wasteMetrics({ pointsIssued: 300_000, pointsReversed: 0 }),
  alerts: [{ kind: 'QUOTA_PACE', pointId: 'p1', pointName: 'Tạp hoá Cô Ba', value: 72, threshold: 60, detail: 'Đã dùng 72% hạn mức trong 10 ngày đầu tháng' }],
});

const CONFIG_OFF = [{ key: 'waste.enabled', value: false, description: null, category: 'waste' }];
const CONFIG_ON = [{ key: 'waste.enabled', value: true, description: null, category: 'waste' }];

type Route = { status?: number; body: unknown };
async function mount(ui: React.ReactElement, overrides: { overview?: Route; config?: Route } = {}) {
  const api = mockFetch({
    '/admin/waste/overview': overrides.overview ?? { body: OVERVIEW },
    '/admin/waste/reports/monthly': { body: 'a,b' },
    '/admin/waste/items': { body: [] },
    '/admin/waste/points': { body: [] },
    '/admin/waste/unmatched': { body: [] },
    '/admin/waste/requests': { body: { rows: [], nextCursor: null } },
    '/admin/waste/gift-redemptions': { body: [] },
    '/admin/waste/gifts': { body: [] },
    '/admin/config': overrides.config ?? { body: CONFIG_OFF },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const r = render(ui);
  mounted.push(r);
  await flush();
  return { r, api, c: r.container };
}

const chips = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="group"][aria-label="Mục đổi rác"] button'));
const metric = (c: HTMLElement, k: string) => c.querySelector(`[data-metric="${k}"]`)?.textContent ?? '';

describe('WasteTab', () => {
  it('ADMIN: năm chip trong role="group", mặc định Hàng nhận, bấm chip đổi mục', async () => {
    const { c } = await mount(<WasteTab isAdmin />);
    expect(chips(c).map((b) => b.textContent)).toEqual(['Hàng nhận', 'Điểm nhận', 'Yêu cầu', 'Quà', 'Cấu hình chung']);
    expect(byText(c, 'button', 'Hàng nhận')!.getAttribute('aria-pressed')).toBe('true');
    click(byText(c, 'button', 'Quà'));
    expect(c.querySelector('[data-waste-section]')!.getAttribute('data-waste-section')).toBe('gifts');
    expect(chips(c).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)).toEqual(['Quà']);
  });

  it('ADMIN: dải số liệu gọn và các chip đứng trước báo cáo chi tiết trong "Xem báo cáo tháng"', async () => {
    const { c } = await mount(<WasteTab isAdmin />);
    const strip = c.querySelector('[data-month-strip]')!;
    const group = c.querySelector('[role="group"][aria-label="Mục đổi rác"]')!;
    const details = c.querySelector('details[data-month-details]')!;
    expect(strip.children.length).toBeLessThanOrEqual(6);
    expect(strip.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(details.querySelector('summary')!.textContent).toBe('Xem báo cáo tháng');
    expect(details.querySelectorAll('[data-metric]').length).toBe(19);
    expect(byText(c, 'button', 'Tải CSV')).not.toBeNull();
  });

  it('ADMIN: thông báo tắt chương trình không nhắc khoá cấu hình', async () => {
    const { c } = await mount(<WasteTab isAdmin />);
    expect(c.textContent).toContain('Chương trình đang tắt với khách. Bật lại ở Cấu hình chung.');
    expect(c.textContent).not.toContain('waste.enabled');
  });

  it('ADMIN: chip Cấu hình chung mở thẻ cấu hình đổi rác', async () => {
    const { c } = await mount(<WasteTab isAdmin />);
    click(byText(c, 'button', 'Cấu hình chung'));
    await flush();
    const card = c.querySelector('[data-waste-config]');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain('Cấu hình chung đổi rác');
  });

  it('ADMIN: dải số liệu tháng này so với tháng trước (17.2)', async () => {
    const { c } = await mount(<WasteTab isAdmin />);
    expect(metric(c, 'pointsIssued')).toContain('480.000');
    expect(metric(c, 'pointsIssued')).toContain('Tháng trước: 300.000');
    expect(metric(c, 'pointsIssued')).toContain('Điểm đã cộng');
    expect(metric(c, 'pointsNet')).toContain('450.000');
    expect(metric(c, 'requestsCreated')).toContain('17');
    expect(metric(c, 'completeHours')).toContain('26 giờ / 70 giờ');
    expect(metric(c, 'carrierCostVnd')).toContain('64.000đ');
    expect(c.textContent).toContain('Tháng 10/2026');
  });

  it('ADMIN: các số còn lại của 17.2: lý do từ chối, thực nhận so với khai, hạn mức đại lý, khối lượng, đơn mua', async () => {
    const { c } = await mount(<WasteTab isAdmin />);
    expect(metric(c, 'rejections')).toContain('Hàng nguy hại (pin, hoá chất)');
    expect(metric(c, 'rejections')).toContain('Hàng nguy hại (pin, hoá chất): 2 · 11,8%');
    expect(metric(c, 'receivedDeclaredPct')).toContain('Mang tới điểm nhận');
    expect(metric(c, 'receivedDeclaredPct')).toContain('86,7%');
    expect(metric(c, 'receivedDeclaredPct')).toContain('Thu kèm đơn: —');
    expect(metric(c, 'quotaByPoint')).toContain('Tạp hoá Cô Ba');
    expect(metric(c, 'quotaByPoint')).toContain('40.000 / 100.000');
    expect(metric(c, 'quotaByPoint')).toContain('6 lượt');
    expect(metric(c, 'unitsByItem')).toContain('Thùng carton cũ · 40 thùng');
    expect(metric(c, 'weight')).toContain('2.500 g / 3.000 g ước tính');
    expect(metric(c, 'orders')).toContain('Khách có đổi rác: 5 đơn');
    expect(metric(c, 'orders')).toContain('Khách không đổi: 12 đơn');
    expect(metric(c, 'orders')).toContain('Chỉ để xem, không kết luận nhân quả');
    expect(metric(c, 'requestsByStatus')).toContain('Hoàn tất');
  });

  it('ADMIN: tải CSV theo tháng', async () => {
    const { c, api } = await mount(<WasteTab isAdmin />);
    typeInto(c.querySelector('input[type="month"]'), '2026-09');
    click(byText(c, 'button', 'Tải CSV'));
    await flush();
    const call = api.calls.find((x) => x.url.includes('/admin/waste/reports/monthly'))!;
    expect(call.url.endsWith('?month=2026-09')).toBe(true);
  });

  it('ADMIN: cảnh báo bất thường ở đầu tab, không vào hộp việc (5.5)', async () => {
    const { c, api } = await mount(<WasteTab isAdmin />);
    const alerts = c.querySelectorAll('[data-waste-alert]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toContain('Tạp hoá Cô Ba');
    expect(alerts[0]!.textContent).toContain('Đã dùng 72% hạn mức trong 10 ngày đầu tháng');
    expect(alerts[0]!.textContent).toContain('72 / ngưỡng 60');
    expect(api.calls.some((x) => x.url.includes('/admin/ops/inbox'))).toBe(false);

    const second = await mount(<WasteTab isAdmin />, {
      overview: {
        body: wasteOverview({
          alerts: [{ kind: 'STAFF_ACCOUNT_CONFIRMED', confirmerName: 'Nguyễn Kho', value: 5, threshold: null, detail: 'Yêu cầu của tài khoản nhân viên do người khác xác nhận' }],
        }),
      },
    });
    const text = second.c.querySelector('[data-waste-alert]')!.textContent!;
    expect(text).toContain('Nguyễn Kho');
    expect(text).toContain('5');
    expect(text).not.toContain('ngưỡng');
  });

  it('ADMIN: nhiều cảnh báo cùng loại ở cùng một điểm đều hiện, không trùng khoá React', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const alert = (name: string) => ({ kind: 'REPEAT_CUSTOMER' as const, pointId: 'p1', pointName: 'Tạp hoá Cô Ba', confirmerName: name, value: 4, threshold: 3, detail: `Khách ${name} lặp lại` });
      const { c } = await mount(<WasteTab isAdmin />, { overview: { body: wasteOverview({ alerts: [alert('An'), alert('Bình'), alert('Chi')] }) } });

      expect(c.querySelectorAll('[data-waste-alert]')).toHaveLength(3);
      expect(err.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(false);
    } finally {
      err.mockRestore();
    }
  });

  it('ADMIN: waste.enabled tắt vẫn dùng được tab, có ghi chú (11.7)', async () => {
    const { c } = await mount(<WasteTab isAdmin />);
    expect(c.textContent).toContain('Chương trình đang tắt với khách');
    expect(chips(c)).toHaveLength(5);
  });

  it('ADMIN: không có ghi chú tắt khi waste.enabled bật hoặc khi cấu hình chưa tải được', async () => {
    const on = await mount(<WasteTab isAdmin />, { config: { body: CONFIG_ON } });
    expect(on.c.textContent).not.toContain('Chương trình đang tắt với khách');
    const err = await mount(<WasteTab isAdmin />, { config: { status: 500, body: { message: 'Lỗi máy chủ' } } });
    expect(err.c.textContent).not.toContain('Chương trình đang tắt với khách');
  });

  it('seed của hộp việc mở đúng mục; nhân viên bỏ qua mục không có (D3)', async () => {
    const a = await mount(<WasteTab isAdmin seed={{ section: 'gifts', preset: 'overdue', n: 1 }} />);
    expect(a.c.querySelector('[data-waste-section]')!.getAttribute('data-waste-section')).toBe('gifts');
    expect(chips(a.c).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)).toEqual(['Quà']);
    const s = await mount(<WasteTab isAdmin={false} seed={{ section: 'points', preset: 'pending', n: 1 }} />);
    expect(s.c.querySelector('[data-waste-section]')!.getAttribute('data-waste-section')).toBe('requests');
    expect(chips(s.c).map((b) => b.textContent)).toEqual(['Yêu cầu', 'Quà']);
  });

  it('link ?tab=waste&wasteUser=u1 mở mục Yêu cầu lọc theo khách (ADMIN)', async () => {
    window.history.replaceState(null, '', '/admin?tab=waste&wasteUser=u1');
    const a = await mount(<WasteTab isAdmin />);
    expect(byText(a.c, 'button', 'Yêu cầu')!.getAttribute('aria-pressed')).toBe('true');
    expect(a.api.calls.some((x) => x.url.includes('?userId=u1'))).toBe(true);
    const s = await mount(<WasteTab isAdmin={false} />);
    expect(s.api.calls.some((x) => x.url.includes('userId='))).toBe(false);
  });

  it('wasteUser sai định dạng bị bỏ qua', async () => {
    window.history.replaceState(null, '', '/admin?tab=waste&wasteUser=' + encodeURIComponent('u1&x=<b>'));
    const a = await mount(<WasteTab isAdmin />);
    expect(a.api.calls.some((x) => x.url.includes('userId='))).toBe(false);
    expect(byText(a.c, 'button', 'Hàng nhận')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('STAFF: chỉ Yêu cầu và Quà, không gọi số liệu tháng (16.2)', async () => {
    const { c, api } = await mount(<WasteTab isAdmin={false} />);
    expect(chips(c).map((b) => b.textContent)).toEqual(['Yêu cầu', 'Quà']);
    expect(byText(c, 'button', 'Yêu cầu')!.getAttribute('aria-pressed')).toBe('true');
    expect(api.calls.some((x) => x.url.includes('/admin/waste/overview'))).toBe(false);
    expect(api.calls.some((x) => x.url.includes('/admin/config'))).toBe(false);
    expect(api.calls.filter((x) => x.url.includes('/admin/waste/requests?filter=TO_COUNT'))).toHaveLength(1);
    expect(c.textContent).not.toContain('Hàng nhận');
    expect(c.textContent).not.toContain('Cấu hình chung');
    expect(c.textContent).not.toContain('Tải CSV');
  });

  it('ADMIN: lỗi tải số liệu hiện thông báo, chip vẫn dùng được', async () => {
    const { c } = await mount(<WasteTab isAdmin />, { overview: { status: 500, body: { message: 'Lỗi máy chủ' } } });
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Không tải được số liệu tháng');
    expect(chips(c)).toHaveLength(5);
  });

  it('không có chữ cấm', async () => {
    const admin = await mount(<WasteTab isAdmin />);
    expectNoBannedCopy(admin.c.textContent);
    const staff = await mount(<WasteTab isAdmin={false} />);
    expectNoBannedCopy(staff.c.textContent);
  });
});
