// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  PURCHASE_FUNNEL_STEPS,
  RECYCLE_FUNNEL_STEPS,
  type LaunchWatchDTO,
  type LaunchWatchFraud,
  type LaunchWatchFunnelRow,
  type LaunchWatchWebhookReject,
  type PurchaseFunnelDTO,
} from '@tubutree/shared-types';
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
  webhookRejects: {
    thresholdPerHour: 10,
    sources: [
      { source: 'pancake', lastHour: 0, last24h: 0, peakPerHour: 0, lastAt: null, alert: false },
      { source: 'gomdon', lastHour: 0, last24h: 0, peakPerHour: 0, lastAt: null, alert: false },
    ],
  },
  ...over,
});

const rejected = (source: 'pancake' | 'gomdon', lastHour: number, last24h: number, alert: boolean): LaunchWatchWebhookReject => ({
  source,
  lastHour,
  last24h,
  peakPerHour: lastHour,
  lastAt: lastHour > 0 ? '2026-11-16T06:55:00.000Z' : null,
  alert,
});
const quiet = (source: 'pancake' | 'gomdon') => rejected(source, 0, 0, false);
const purchase = (scale: number) => ({
  rows: PURCHASE_FUNNEL_STEPS.map((step, i) => ({ step, web: (5 - i) * scale, miniapp: (4 - i) * scale, total: (9 - 2 * i) * scale })),
  sessions: { web: 12 * scale, miniapp: 8 * scale, total: 20 * scale },
});
const funnelDto: PurchaseFunnelDTO = { generatedAt: '2026-11-16T07:05:00.000Z', windows: { h72: purchase(1), d7: purchase(10), d30: purchase(100) } };
const FUNNEL_ROUTE = { '/admin/analytics/purchase-funnel': { body: funnelDto } };
/** Bảng Phễu mua gọi API riêng: trả số mẫu cho nó, mọi URL khác đi qua `fn` của ca kiểm. */
const withFunnel = (fn: (url: string, init?: RequestInit) => Promise<Response>) =>
  vi.fn(async (url: string, init?: RequestInit) =>
    url.includes('/admin/analytics/purchase-funnel')
      ? new Response(JSON.stringify(funnelDto), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : fn(url, init),
  );
const lwCalls = (calls: { url: string }[]) => calls.filter((c) => c.url.includes('/admin/analytics/launch-watch'));

const mountWith = async (body: LaunchWatchDTO | null, status = 200) => {
  const api = mockFetch({ '/admin/analytics/launch-watch': { status, body: body ?? { message: 'x' } }, ...FUNNEL_ROUTE });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const r = mount(<LaunchWatchTab />);
  await flush();
  return { api, ...r };
};

const group = (c: HTMLElement, name: string) => c.querySelector<HTMLElement>(`[role="group"][aria-label="${name}"]`)!;
const recycle = (c: HTMLElement) => c.querySelector<HTMLElement>('section[aria-label="Phễu Đổi rác"]')!;
const buy = (c: HTMLElement) => c.querySelector<HTMLElement>('section[aria-label="Phễu mua"]')!;
const funnelRow = (c: HTMLElement, label: string) =>
  Array.from(recycle(c).querySelectorAll('tbody tr')).find((tr) => tr.querySelector('th')?.textContent === label)!;
const cells = (tr: Element) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent);
const windowButton = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Khoảng thời gian"] button')).find((b) => b.textContent === label)!;

describe('LaunchWatchTab', () => {
  it('đang tải: hiện khung xương, chưa có bảng', async () => {
    const api = mockFetch({ '/admin/analytics/launch-watch': { body: dto() }, ...FUNNEL_ROUTE });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<LaunchWatchTab />);
    expect(container.querySelector('[aria-busy="true"][aria-label="Đang tải số liệu theo dõi"]')).not.toBeNull();
    expect(container.querySelector('table')).toBeNull();
    await flush();
    expect(container.querySelector('[data-skeleton]')).toBeNull();
  });

  it('lỗi tải: câu thông báo tiếng Việt kèm nút Thử lại, tải lại được', async () => {
    const calls: number[] = [];
    const fn = withFunnel(async () => {
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
    expect(lwCalls(api.calls)).toHaveLength(1);
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
    expect(recycle(container).querySelectorAll('tbody tr')).toHaveLength(RECYCLE_FUNNEL_STEPS.length);
    expect(Array.from(recycle(container).querySelectorAll('thead th')).map((th) => th.textContent)).toEqual(['Bước', 'Web', 'Mini App', 'Tổng', 'So với bước vào']);
    expect(cells(funnelRow(container, 'Vào màn Đổi rác'))).toEqual(['6', '5', '8', '100%']);
    expect(cells(funnelRow(container, 'Đã gửi yêu cầu'))).toEqual(['2', '2', '3', '37,5%']);
    expect(cells(funnelRow(container, 'Từ chối vị trí'))).toEqual(['0', '0', '0', '0%']);
    expect(container.textContent).toContain('Kho đã nhận rác thật: 3 yêu cầu · 2 khách');
    expect(recycle(container).querySelector('table')?.parentElement?.className).toContain('overflow-x-auto');
    expect(recycle(container).querySelector('table')?.className).toContain('tabular-nums');
  });

  it('một nút khoảng thời gian đổi cả phễu lẫn chống gian lận, còn khối đơn thứ 2 giữ nguyên', async () => {
    const { container, api } = await mountWith(dto());
    const secondBefore = container.querySelector('section[aria-label="Khách đặt đơn thứ 2 trong 14 ngày"]')?.textContent;
    click(windowButton(container, '7 ngày'));
    await flush();
    expect(lwCalls(api.calls)).toHaveLength(1); // đổi cửa sổ chỉ chọn lại số liệu đã tải, không gọi API lại
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
      webhookRejects: { thresholdPerHour: 10, sources: [quiet('pancake'), quiet('gomdon')] },
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
    const fn = vi.fn(async (_url?: string) => {
      n++;
      const body = dto({ generatedAt: n === 1 ? '2026-11-16T07:05:00.000Z' : '2026-11-16T07:09:00.000Z' });
      if (n === 2) await new Promise<void>((r) => (release = r));
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', withFunnel(fn));
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

  describe('cảnh báo webhook bị từ chối 401 (W184)', () => {
    const banner = (c: HTMLElement) => c.querySelector<HTMLElement>('section[aria-label="Cảnh báo webhook"]');

    it('Pancake vượt ngưỡng: khối cảnh báo ĐỎ ở đầu tab (trước phễu) với tiêu đề, số lần trong 1 giờ và 24 giờ, gợi ý kiểm token', async () => {
      const d = dto({ webhookRejects: { thresholdPerHour: 10, sources: [rejected('pancake', 52, 1234, true), quiet('gomdon')] } });
      const { container } = await mountWith(d);
      const b = banner(container)!;
      expect(b).not.toBeNull();
      const alerts = b.querySelectorAll('[role="alert"]');
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.className).toContain('text-danger-fg');
      expect(alerts[0]!.className).toContain('bg-danger-bg');
      expect(alerts[0]!.textContent).toContain('Webhook Pancake đang bị từ chối');
      expect(alerts[0]!.textContent).toContain('52 lần trong 1 giờ qua (24 giờ: 1.234)');
      expect(alerts[0]!.textContent).toContain('x-webhook-token');
      expect(alerts[0]!.textContent).toContain('PANCAKE_WEBHOOK_SECRET');
      // Đứng trước mọi khối số liệu và ngay dưới tiêu đề/nút khoảng thời gian.
      const funnel = container.querySelector('section[aria-label="Phễu Đổi rác"]')!;
      expect(b.compareDocumentPosition(funnel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(container.querySelector('header')!.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('không thêm nút hay đường dẫn mới: khối cảnh báo chỉ là chữ', async () => {
      const d = dto({ webhookRejects: { thresholdPerHour: 10, sources: [rejected('pancake', 52, 1234, true), quiet('gomdon')] } });
      const { container } = await mountWith(d);
      expect(banner(container)!.querySelectorAll('button, a, input')).toHaveLength(0);
      expect(container.querySelectorAll('button')).toHaveLength(4); // 3 khoảng thời gian + Làm mới, như khi không cảnh báo
    });

    it('Gomdon vượt ngưỡng: tên nguồn Gomdon và gợi ý kiểm secret hoặc khoá HMAC', async () => {
      const d = dto({ webhookRejects: { thresholdPerHour: 10, sources: [quiet('pancake'), rejected('gomdon', 11, 11, true)] } });
      const { container } = await mountWith(d);
      const alerts = banner(container)!.querySelectorAll('[role="alert"]');
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.textContent).toContain('Webhook Gomdon đang bị từ chối');
      expect(alerts[0]!.textContent).toContain('11 lần trong 1 giờ qua (24 giờ: 11)');
      expect(alerts[0]!.textContent).toContain('khoá HMAC');
      expect(alerts[0]!.textContent).not.toContain('Pancake');
    });

    it('cả hai nguồn vượt ngưỡng: hai cảnh báo, Pancake trước Gomdon', async () => {
      const d = dto({ webhookRejects: { thresholdPerHour: 10, sources: [rejected('pancake', 50, 600, true), rejected('gomdon', 30, 90, true)] } });
      const { container } = await mountWith(d);
      const titles = Array.from(banner(container)!.querySelectorAll('strong')).map((s) => s.textContent);
      expect(titles).toEqual(['Webhook Pancake đang bị từ chối', 'Webhook Gomdon đang bị từ chối']);
    });

    it('không nguồn nào vượt ngưỡng (kể cả có vài lần bị từ chối): không hiện gì thêm, không ô role=alert', async () => {
      const d = dto({ webhookRejects: { thresholdPerHour: 10, sources: [rejected('pancake', 9, 100, false), rejected('gomdon', 1, 1, false)] } });
      const { container } = await mountWith(d);
      expect(banner(container)).toBeNull();
      expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
      expect(container.textContent).not.toContain('bị từ chối');
    });

    it('thiếu webhookRejects trong phản hồi (API cũ): tab vẫn dựng bình thường, không cảnh báo', async () => {
      const old: Partial<LaunchWatchDTO> = dto();
      delete old.webhookRejects;
      const { container } = await mountWith(old as LaunchWatchDTO);
      expect(container.querySelector('table')).not.toBeNull();
      expect(container.querySelector('h2')?.textContent).toBe('Theo dõi 72h sau launch');
      expect(banner(container)).toBeNull();
      expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    });

    it('cảnh báo không phụ thuộc khoảng thời gian chọn: đổi sang 30 ngày vẫn còn', async () => {
      const d = dto({ webhookRejects: { thresholdPerHour: 10, sources: [rejected('pancake', 52, 1234, true), quiet('gomdon')] } });
      const { container } = await mountWith(d);
      click(windowButton(container, '30 ngày'));
      await flush();
      expect(banner(container)!.textContent).toContain('Webhook Pancake đang bị từ chối');
    });

    it('không lộ bí mật: chỉ có số đếm, tên biến cấu hình và tên header, không giá trị token nào', async () => {
      const d = dto({ webhookRejects: { thresholdPerHour: 10, sources: [rejected('pancake', 52, 1234, true), rejected('gomdon', 30, 90, true)] } });
      const { container } = await mountWith(d);
      expect(banner(container)!.textContent).not.toMatch(/Bearer|sk_|secret=|token=/i);
    });
  });

  it('phễu mua: bảng riêng trên phễu Đổi rác, 5 bước theo nhãn tiếng Việt, đổi theo nút khoảng thời gian, Làm mới tải lại cả phễu mua', async () => {
    const { container, api } = await mountWith(dto());
    const sections = Array.from(container.querySelectorAll('section[aria-label]')).map((s) => s.getAttribute('aria-label'));
    expect(sections.indexOf('Phễu mua')).toBeLessThan(sections.indexOf('Phễu Đổi rác'));
    const rowsOf = () => Array.from(buy(container).querySelectorAll('tbody tr')).map((tr) => [tr.querySelector('th')?.textContent, ...cells(tr)]);
    expect(rowsOf()).toEqual([
      ['Xem trang sản phẩm', '5', '4', '9', '100%'],
      ['Bấm Thêm vào giỏ hoặc Mua ngay', '4', '3', '7', '77,8%'],
      ['Vào thanh toán', '3', '2', '5', '55,6%'],
      ['Bấm Đặt hàng', '2', '1', '3', '33,3%'],
      ['Đặt đơn thành công', '1', '0', '1', '11,1%'],
    ]);
    expect(buy(container).textContent).toContain('Tổng số phiên: 20 (web 12 · Mini App 8)');
    click(windowButton(container, '30 ngày'));
    await flush();
    expect(rowsOf()[0]).toEqual(['Xem trang sản phẩm', '500', '400', '900', '100%']);
    const funnelCalls = () => api.calls.filter((c) => c.url.includes('/admin/analytics/purchase-funnel')).length;
    expect(funnelCalls()).toBe(1);
    click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Làm mới')!);
    await flush();
    expect(funnelCalls()).toBe(2);
  });

  it('phễu mua lỗi tải: chỉ khối đó báo lỗi, các khối khác vẫn hiện', async () => {
    const api = mockFetch({ '/admin/analytics/launch-watch': { body: dto() }, '/admin/analytics/purchase-funnel': { status: 500, body: { message: 'x' } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<LaunchWatchTab />);
    await flush();
    await flush();
    expect(buy(container).textContent).toContain('Không tải được phễu mua.');
    expect(recycle(container).querySelector('table')).not.toBeNull();
  });
});
