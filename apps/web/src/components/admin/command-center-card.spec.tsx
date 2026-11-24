// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CommandCenterCard, restLine } from './command-center-card';
import { OpsInboxTab } from './ops-inbox-tab';
import { click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import type { CommandCenterSummary } from '@/lib/admin-client';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const b = (count: number, amount: number) => ({ count, amount });
const SUMMARY: CommandCenterSummary = {
  generatedAt: '2026-11-24T01:00:00.000Z',
  ordersToday: {
    total: 14,
    paid: b(3, 900_000),
    bankTransferUnpaid: b(2, 400_000),
    cod: b(5, 1_250_000),
    merchantCod: b(0, 0),
    cancelled: b(1, 199_000),
    pilot: b(0, 0),
    other: b(3, 100_000),
  },
  lowStock: {
    threshold: 5,
    count: 7,
    outOfStock: 2,
    items: [
      { sku: 'NG-5L', productName: 'Nước giặt', variationName: 'Can 5L', stock: 0 },
      { sku: 'XP-H', productName: 'Xà phòng', variationName: 'Hộp', stock: 3 },
    ],
  },
  ctvPayouts: { approvedAmount: 450_000, approvedCtvs: 3, holdingAmount: 120_000, pendingAmount: 80_000, withdrawingAmount: 0, autoWalletTransfer: true },
};

const stub = (body: unknown, status = 200) => {
  const api = mockFetch({ '/admin/dashboard/command-center': { status, body } });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  return api;
};

const mount = async () => {
  const r = render(<CommandCenterCard />);
  mounted.push(r);
  await flush();
  return r.container;
};

const group = (c: HTMLElement, label: string) => c.querySelector(`[role="group"][aria-label="${label}"]`)!;

describe('CommandCenterCard (thẻ "Điều phối hôm nay")', () => {
  it('ba nhóm tiền của đơn hôm nay: số đơn và tổng tiền; dòng phụ nêu đơn huỷ/hoàn và chờ cổng thanh toán', async () => {
    stub(SUMMARY);
    const c = await mount();
    expect(c.querySelector('h3')!.textContent).toBe('Điều phối hôm nay');
    expect(group(c, 'Đã thanh toán').textContent).toContain('3 đơn');
    expect(group(c, 'Đã thanh toán').textContent).toContain('900.000');
    expect(group(c, 'Chờ chuyển khoản').textContent).toContain('2 đơn');
    expect(group(c, 'Chờ chuyển khoản').textContent).toContain('400.000');
    expect(group(c, 'Thu khi giao (COD)').textContent).toContain('5 đơn');
    expect(group(c, 'Thu khi giao (COD)').textContent).toContain('1.250.000');
    expect(c.textContent).toContain('Huỷ hoặc hoàn tiền 1 · Chờ cổng thanh toán 3');
  });

  it('hàng sắp hết: một dòng đếm, bấm mới mở tên từng phân loại (hết hàng tô đỏ) và số phân loại không liệt kê', async () => {
    stub(SUMMARY);
    const c = await mount();
    const low = group(c, 'Hàng sắp hết');
    const toggle = low.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(toggle.textContent).toContain('7 phân loại còn từ 5 trở xuống');
    expect(toggle.textContent).toContain('2 đã hết');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(low.querySelector('ul')).toBeNull();
    click(toggle);
    await flush();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const items = [...low.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['Nước giặt · Can 5Lhết hàng', 'Xà phòng · Hộpcòn 3', 'và 5 phân loại khác']);
    expect(low.querySelector('li span:last-child')!.className).toContain('text-danger-fg');
  });

  it('không có hàng sắp hết: một câu, không có nút mở', async () => {
    stub({ ...SUMMARY, lowStock: { threshold: 5, count: 0, outOfStock: 0, items: [] } });
    const c = await mount();
    const low = group(c, 'Hàng sắp hết');
    expect(low.textContent).toBe('Không phân loại nào còn từ 5 trở xuống.');
    expect(low.querySelector('button')).toBeNull();
  });

  it('hoa hồng CTV chờ chi: số đã duyệt và số CTV, kèm đang giữ, đơn chưa giao và cách chuyển vào Ví theo cờ', async () => {
    stub(SUMMARY);
    const c = await mount();
    const ctv = group(c, 'Hoa hồng CTV chờ chi');
    expect(ctv.textContent).toContain('Hoa hồng CTV chờ chi 450.000');
    expect(ctv.textContent).toContain('3 CTV');
    expect(ctv.textContent).toContain('Tự vào Ví lúc 8 giờ sáng mỗi ngày, trừ CTV bị khoá');
    expect(ctv.textContent).toContain('Đang giữ sau giao 120.000');
    expect(ctv.textContent).toContain('Đơn chưa giao 80.000');
    expect(ctv.textContent).not.toContain('lệnh rút cũ');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    stub({ ...SUMMARY, ctvPayouts: { ...SUMMARY.ctvPayouts, approvedAmount: 0, approvedCtvs: 0, withdrawingAmount: 2_000_000, autoWalletTransfer: false } });
    const off = group(await mount(), 'Hoa hồng CTV chờ chi');
    expect(off.textContent).toContain('Đang tắt tự chuyển vào Ví, chờ CTV tự bấm');
    expect(off.textContent).toContain('Trong lệnh rút cũ 2.000.000');
    expect(off.textContent).not.toContain(' CTV ·');
  });

  it('thẻ chỉ để xem: không có nút dẫn đi ngoài nút mở danh sách hàng sắp hết', async () => {
    stub(SUMMARY);
    const c = await mount();
    expect([...c.querySelectorAll('button')].map((x) => x.getAttribute('aria-expanded'))).toEqual(['false']);
    expect(c.querySelectorAll('a').length).toBe(0);
  });

  it('lỗi tải: báo trong thẻ kèm nút thử lại', async () => {
    stub({ message: 'lỗi' }, 500);
    const c = await mount();
    expect(c.textContent).toContain('Không tải được thẻ điều phối hôm nay.');
    expect(c.querySelector('[data-command-center]')).toBeNull();
  });
});

describe('restLine', () => {
  it('chỉ nêu nhóm có đơn', () => {
    const o = SUMMARY.ordersToday;
    expect(restLine({ ...o, cancelled: b(0, 0), other: b(0, 0) })).toBe('');
    expect(restLine({ ...o, cancelled: b(2, 1), other: b(0, 0) })).toBe('Huỷ hoặc hoàn tiền 2');
    expect(restLine({ ...o, cancelled: b(0, 0), other: b(1, 1) })).toBe('Chờ cổng thanh toán 1');
    expect(restLine({ ...o, merchantCod: b(2, 1), pilot: b(4, 1) })).toBe('Huỷ hoặc hoàn tiền 1 · COD gian hàng tự thu 2 · Đơn thử Giờ G 4 · Chờ cổng thanh toán 3');
  });
});

describe('OpsInboxTab có thẻ điều phối', () => {
  it('ADMIN thấy thẻ ngay dưới bốn số bán hàng; nhân viên không gọi API thẻ', async () => {
    const api = mockFetch({
      '/admin/ops/inbox': { body: { generatedAt: '2026-11-24T01:00:00.000Z', items: [] } },
      '/admin/dashboard/today': { body: { orders: { today: 14, yesterday: 3, week: 20 }, revenue: { today: 0, yesterday: 0, week: 0 }, newUsers: { today: 0, yesterday: 0, week: 0 } } },
      '/admin/dashboard/command-center': { body: SUMMARY },
      '/admin/analytics/retention': { body: [] },
      '/admin/ops/health': { body: { problems: [], cronJobs: [] } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const admin = render(<OpsInboxTab onOpen={vi.fn()} isAdmin />);
    mounted.push(admin);
    await flush();
    const stats = admin.container.querySelector('section[aria-label="Số bán hàng hôm nay"]')!;
    const card = admin.container.querySelector('[data-command-center]')!;
    expect(card).not.toBeNull();
    expect(stats.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    admin.unmount();
    mounted = [];
    api.calls.length = 0;
    const staff = render(<OpsInboxTab onOpen={vi.fn()} />);
    mounted.push(staff);
    await flush();
    expect(api.calls.some((x) => x.url.includes('/admin/dashboard/command-center'))).toBe(false);
    expect(staff.container.querySelector('[data-command-center]')).toBeNull();
  });
});
