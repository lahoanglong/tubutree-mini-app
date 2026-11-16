// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { RECYCLE_FUNNEL_STEPS, type LaunchWatchDTO, type LaunchWatchFraud, type LaunchWatchFunnelRow } from '@tubutree/shared-types';
import { LaunchWatchTab } from './launch-watch-tab';
import { click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';

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

const rows = (over: Partial<Record<(typeof RECYCLE_FUNNEL_STEPS)[number], [number, number, number]>> = {}): LaunchWatchFunnelRow[] =>
  RECYCLE_FUNNEL_STEPS.map((step) => {
    const [web, miniapp, total] = over[step] ?? [0, 0, 0];
    return { step, web, miniapp, total };
  });

const fraud = (over: Partial<LaunchWatchFraud> = {}): LaunchWatchFraud => ({
  unverifiedPhone: { totalRequests: 10, requests: 4, users: 2, pointsAwarded: 35 },
  zeroGift: { attached: 3, accounts: 2, maxPerAccount: 2, ordersOverOne: 0, ordersBelowMin: 0, countedSince: '2026-11-16T08:17:00.000Z' },
  freeShipRecycle: { orders: 3, users: 2, totalOrders: 5, shareOfOrdersPct: 60, withConfirmedWaste: 2 },
  ...over,
});

const dto = (over: Partial<LaunchWatchDTO> = {}): LaunchWatchDTO => ({
  generatedAt: '2026-11-16T07:05:00.000Z',
  windows: {
    h72: {
      funnel: { rows: rows({ enter: [6, 5, 8], submitted: [2, 2, 3] }), confirmedRequests: 3, confirmedUsers: 2 },
      fraud: fraud(),
    },
    d7: {
      funnel: { rows: rows({ enter: [60, 50, 80], submitted: [20, 20, 40] }), confirmedRequests: 31, confirmedUsers: 25 },
      fraud: fraud({ freeShipRecycle: { orders: 10, users: 9, totalOrders: 40, shareOfOrdersPct: 25, withConfirmedWaste: 7 } }),
    },
    d30: {
      funnel: { rows: rows({ enter: [600, 500, 1234], submitted: [200, 200, 400] }), confirmedRequests: 310, confirmedUsers: 250 },
      fraud: fraud(),
    },
  },
  secondOrder: { windowDays: 14, matured: { customers: 8, withSecond: 3 }, pending: { customers: 5, withSecond: 2 } },
  ...over,
});

const mountWith = async (body: LaunchWatchDTO | null, status = 200) => {
  const api = mockFetch({ '/admin/analytics/launch-watch': { status, body: body ?? { message: 'x' } } });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const r = mount(<LaunchWatchTab />);
  await flush();
  return { api, ...r };
};

const group = (c: HTMLElement, name: string) => c.querySelector<HTMLElement>(`[role="group"][aria-label="${name}"]`)!;
const funnelRow = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll('tbody tr')).find((tr) => tr.querySelector('th')?.textContent === label)!;
const cells = (tr: Element) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent);
const windowButton = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Khoảng thời gian"] button')).find((b) => b.textContent === label)!;

describe('LaunchWatchTab', () => {
  it('đang tải: hiện khung xương, chưa có bảng', async () => {
    const api = mockFetch({ '/admin/analytics/launch-watch': { body: dto() } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<LaunchWatchTab />);
    expect(container.querySelector('[aria-busy="true"][aria-label="Đang tải số liệu theo dõi"]')).not.toBeNull();
    expect(container.querySelector('table')).toBeNull();
    await flush();
    expect(container.querySelector('[data-skeleton]')).toBeNull();
  });

  it('lỗi tải: câu thông báo tiếng Việt kèm nút Thử lại, tải lại được', async () => {
    const calls: number[] = [];
    const fn = vi.fn(async () => {
      calls.push(1);
      return calls.length === 1
        ? new Response(JSON.stringify({ message: 'x' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
        : new Response(JSON.stringify(dto()), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fn);
    const { container } = mount(<LaunchWatchTab />);
    await flush();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Không tải được số liệu theo dõi.');
    expect(container.querySelector('table')).toBeNull();
    const retry = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Thử lại');
    click(retry ?? null);
    await flush();
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.textContent).not.toContain('Không tải được số liệu theo dõi.');
  });

  it('đầu trang: tiêu đề, ba nút khoảng thời gian (mặc định 72 giờ, aria-pressed), nút Làm mới, giờ cập nhật theo giờ Việt Nam', async () => {
    const { container, api } = await mountWith(dto());
    expect(api.calls).toHaveLength(1);
    expect(container.querySelector('h2')?.textContent).toBe('Theo dõi 72h sau launch');
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Khoảng thời gian"] button'));
    expect(buttons.map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['72 giờ', 'true'],
      ['7 ngày', 'false'],
      ['30 ngày', 'false'],
    ]);
    expect(buttons.every((b) => b.className.includes('min-h-[44px]'))).toBe(true);
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Làm mới' && b.className.includes('min-h-[44px]'))).toBe(true);
    expect(container.textContent).toContain('Cập nhật lúc 14:05');
  });

  it('phễu: mỗi bước một hàng (nhãn tiếng Việt, Web, Mini App, Tổng, % so với bước vào) và dòng kho đã nhận rác thật', async () => {
    const { container } = await mountWith(dto());
    expect(container.querySelectorAll('tbody tr')).toHaveLength(RECYCLE_FUNNEL_STEPS.length);
    expect(Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual(['Bước', 'Web', 'Mini App', 'Tổng', 'So với bước vào']);
    expect(cells(funnelRow(container, 'Vào màn Đổi rác'))).toEqual(['6', '5', '8', '100%']);
    expect(cells(funnelRow(container, 'Đã gửi yêu cầu'))).toEqual(['2', '2', '3', '37,5%']);
    expect(cells(funnelRow(container, 'Từ chối vị trí'))).toEqual(['0', '0', '0', '0%']);
    expect(container.textContent).toContain('Kho đã nhận rác thật: 3 yêu cầu · 2 khách');
    expect(container.querySelector('table')?.parentElement?.className).toContain('overflow-x-auto');
    expect(container.querySelector('table')?.className).toContain('tabular-nums');
  });

  it('một nút khoảng thời gian đổi cả phễu lẫn chống gian lận, còn khối đơn thứ 2 giữ nguyên', async () => {
    const { container, api } = await mountWith(dto());
    const secondBefore = container.querySelector('section[aria-label="Khách đặt đơn thứ 2 trong 14 ngày"]')?.textContent;
    click(windowButton(container, '7 ngày'));
    await flush();
    expect(api.calls).toHaveLength(1); // đổi cửa sổ chỉ chọn lại số liệu đã tải, không gọi API lại
    expect(windowButton(container, '7 ngày').getAttribute('aria-pressed')).toBe('true');
    expect(windowButton(container, '72 giờ').getAttribute('aria-pressed')).toBe('false');
    expect(cells(funnelRow(container, 'Vào màn Đổi rác'))).toEqual(['60', '50', '80', '100%']);
    expect(cells(funnelRow(container, 'Đã gửi yêu cầu'))[3]).toBe('50%');
    expect(container.textContent).toContain('Kho đã nhận rác thật: 31 yêu cầu · 25 khách');
    expect(group(container, 'Đơn miễn ship kèm rác').textContent).toContain('10 / 40');
    expect(group(container, 'Đơn miễn ship kèm rác').textContent).toContain('25%');

    click(windowButton(container, '30 ngày'));
    await flush();
    expect(cells(funnelRow(container, 'Vào màn Đổi rác'))).toEqual(['600', '500', '1.234', '100%']);
    expect(container.querySelector('section[aria-label="Khách đặt đơn thứ 2 trong 14 ngày"]')?.textContent).toBe(secondBefore);
  });

  it('chống gian lận: ba nhóm nhãn - giá trị; mọi chỉ số đúng kỳ vọng thì không có ô cảnh báo', async () => {
    const { container } = await mountWith(dto());
    const phone = group(container, 'SĐT chưa xác thực');
    expect(phone.textContent).toContain('Yêu cầu từ SĐT chưa xác thực4 / 10');
    expect(phone.textContent).toContain('Tỉ lệ trên mọi yêu cầu40%');
    expect(phone.textContent).toContain('Số khách2');
    expect(phone.textContent).toContain('Điểm Xanh đã cộng (kho đã xác nhận)35');
    expect(phone.textContent).not.toContain('Kỳ vọng');
    const gift = group(container, 'Quà 0đ gắn đơn');
    expect(gift.textContent).toContain('Chỉ đếm đơn tạo từ');
    expect(gift.textContent).toContain('15:17');
    expect(gift.textContent).toContain('Đơn trước luật W179 đi theo luật cũ');
    expect(gift.textContent).toContain('Quà đã gắn vào đơn3');
    expect(gift.textContent).toContain('Nhiều nhất một tài khoản2');
    const ship = group(container, 'Đơn miễn ship kèm rác');
    expect(ship.textContent).toContain('Đơn mua có thu rác3 / 5');
    expect(ship.textContent).toContain('Tỉ lệ trên mọi đơn60%');
    expect(ship.textContent).toContain('Đơn có rác kho đã xác nhận2');
    expect(container.querySelectorAll('[data-level="red"], [data-level="amber"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });

  it('vi phạm bất biến: dòng ĐỎ kèm câu giải thích role=alert; 3 quà một tài khoản: dòng VÀNG; điểm của SĐT chưa xác thực không bao giờ báo động', async () => {
    const bad = dto();
    bad.windows.h72.fraud = fraud({
      unverifiedPhone: { totalRequests: 50, requests: 50, users: 40, pointsAwarded: 30 },
      zeroGift: { attached: 6, accounts: 2, maxPerAccount: 3, ordersOverOne: 1, ordersBelowMin: 2, countedSince: '2026-11-16T08:17:00.000Z' },
    });
    const { container } = await mountWith(bad);
    const red = Array.from(container.querySelectorAll<HTMLElement>('[data-level="red"]'));
    expect(red.map((r) => r.querySelector('dt')?.textContent?.replace('Kỳ vọng 0', ''))).toEqual(['Đơn mang hơn 1 quà', 'Đơn dưới mức tối thiểu']);
    expect(red.every((r) => r.className.includes('bg-danger-bg') && r.className.includes('text-danger-fg'))).toBe(true);
    const amber = Array.from(container.querySelectorAll<HTMLElement>('[data-level="amber"]'));
    expect(amber).toHaveLength(1);
    expect(amber[0]!.querySelector('dt')?.textContent).toBe('Nhiều nhất một tài khoản');
    expect(amber[0]!.className).toContain('bg-warning-bg');

    const alerts = Array.from(container.querySelectorAll('[role="alert"]')).map((a) => a.textContent);
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toContain('1 đơn mang hơn 1 quà 0đ');
    expect(alerts[1]).toContain('2 đơn gắn quà 0đ');
    expect(alerts[1]).toContain('99.000đ');
    expect(group(container, 'SĐT chưa xác thực').querySelector('[data-level="red"], [data-level="amber"], [role="alert"]')).toBeNull();
    const status = container.querySelectorAll('[role="status"]');
    expect(Array.from(status).some((s) => s.textContent?.includes('3 quà 0đ'))).toBe(true);
  });

  it('cảnh báo theo cửa sổ đang chọn: vi phạm chỉ ở 30 ngày thì chuyển sang 30 ngày mới thấy', async () => {
    const d = dto();
    d.windows.d30.fraud = fraud({ zeroGift: { attached: 9, accounts: 3, maxPerAccount: 2, ordersOverOne: 2, ordersBelowMin: 0, countedSince: '2026-11-16T08:17:00.000Z' } });
    const { container } = await mountWith(d);
    expect(container.querySelectorAll('[data-level="red"]')).toHaveLength(0);
    click(windowButton(container, '30 ngày'));
    await flush();
    expect(container.querySelectorAll('[data-level="red"]')).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('2 đơn mang hơn 1 quà 0đ');
  });

  it('đơn thứ 2: tỉ lệ nhóm đủ 14 ngày kèm số khách, nhóm đang chạy ghi rõ "Đang chạy"', async () => {
    const { container } = await mountWith(dto());
    const matured = group(container, 'Nhóm đã đủ 14 ngày');
    expect(matured.textContent).toContain('37,5%');
    expect(matured.textContent).toContain('3 / 8 khách');
    const pending = group(container, 'Nhóm đang chạy');
    expect(pending.textContent).toContain('Đang chạy');
    expect(pending.textContent).toContain('2 / 5');
  });

  it('chưa có số liệu: mọi số là 0, tỉ lệ đơn miễn ship và đơn thứ 2 là "—", có câu giải thích bằng tiếng Việt, không lỗi chia 0', async () => {
    const empty: LaunchWatchDTO = {
      generatedAt: '2026-11-16T07:05:00.000Z',
      windows: Object.fromEntries(
        (['h72', 'd7', 'd30'] as const).map((w) => [
          w,
          {
            funnel: { rows: rows(), confirmedRequests: 0, confirmedUsers: 0 },
            fraud: {
              unverifiedPhone: { totalRequests: 0, requests: 0, users: 0, pointsAwarded: 0 },
              zeroGift: { attached: 0, accounts: 0, maxPerAccount: 0, ordersOverOne: 0, ordersBelowMin: 0, countedSince: '2026-11-16T08:17:00.000Z' },
              freeShipRecycle: { orders: 0, users: 0, totalOrders: 0, shareOfOrdersPct: null, withConfirmedWaste: 0 },
            },
          },
        ]),
      ) as LaunchWatchDTO['windows'],
      secondOrder: { windowDays: 14, matured: { customers: 0, withSecond: 0 }, pending: { customers: 0, withSecond: 0 } },
    };
    const { container } = await mountWith(empty);
    expect(cells(funnelRow(container, 'Vào màn Đổi rác'))).toEqual(['0', '0', '0', '—']);
    expect(container.textContent).toContain('Chưa có khách nào đi qua phễu');
    expect(container.textContent).toContain('Kho đã nhận rác thật: 0 yêu cầu · 0 khách');
    expect(group(container, 'Đơn miễn ship kèm rác').textContent).toContain('Tỉ lệ trên mọi đơn—');
    expect(group(container, 'SĐT chưa xác thực').textContent).toContain('Yêu cầu từ SĐT chưa xác thực0 / 0');
    expect(group(container, 'SĐT chưa xác thực').textContent).toContain('Tỉ lệ trên mọi yêu cầu—');
    const matured = group(container, 'Nhóm đã đủ 14 ngày');
    expect(matured.textContent).toContain('—');
    expect(matured.textContent).toContain('0 / 0 khách');
    expect(container.textContent).toContain('Chưa có khách nào đủ 14 ngày');
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
    expect(container.querySelectorAll('[data-level="red"], [data-level="amber"]')).toHaveLength(0);
  });

  it('Làm mới gọi lại API một lần và cập nhật giờ; đang tải thì bấm tiếp không gọi thêm', async () => {
    let n = 0;
    let release: (() => void) | undefined;
    const fn = vi.fn(async () => {
      n++;
      const body = dto({ generatedAt: n === 1 ? '2026-11-16T07:05:00.000Z' : '2026-11-16T07:09:00.000Z' });
      if (n === 2) await new Promise<void>((r) => (release = r));
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fn);
    const { container } = mount(<LaunchWatchTab />);
    await flush();
    const refresh = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Làm mới')!;
    click(refresh);
    await flush();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(refresh.getAttribute('aria-disabled')).toBe('true');
    click(refresh);
    await flush();
    expect(fn).toHaveBeenCalledTimes(2);
    release?.();
    await flush();
    expect(container.textContent).toContain('Cập nhật lúc 14:09');
    expect(refresh.getAttribute('aria-disabled')).toBeNull();
  });

  it('không lộ thông tin cá nhân: chỉ có số tổng hợp, không có email, số điện thoại hay mã khách trong chữ hiển thị', async () => {
    const { container } = await mountWith(dto());
    const t = container.textContent ?? '';
    expect(t).not.toMatch(/@|\b0\d{9}\b|userId|cm[a-z0-9]{20,}/);
  });
});
