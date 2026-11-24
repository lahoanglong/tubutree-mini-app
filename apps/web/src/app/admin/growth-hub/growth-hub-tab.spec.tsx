// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PURCHASE_FUNNEL_STEPS, type AdminGrowthOverviewDTO } from '@tubutree/shared-types';
import { answerConfirm, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { ConfigRow } from '@/lib/admin-client';
import type { AdminCampaignRow } from '@/lib/admin-campaigns-client';
import { GrowthHubTab } from './growth-hub-tab';
import { capLine, remarketingTable } from './growth-remarketing';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const cfg = (o: Record<string, unknown>): ConfigRow[] => Object.entries(o).map(([key, value]) => ({ key, value, description: null, category: key.split('.')[0]! }));

const FUNNEL_TOTALS: Record<string, number> = { product_viewed: 200, add_or_buy: 50, checkout_started: 20, place_order_click: 12, order_placed: 10 };
const overview = (days: 7 | 30): AdminGrowthOverviewDTO => ({
  generatedAt: '2026-11-18T08:00:00.000Z',
  days,
  sinceDay: days === 7 ? '2026-11-12' : '2026-10-20',
  funnel: {
    rows: PURCHASE_FUNNEL_STEPS.map((step) => ({ step, web: FUNNEL_TOTALS[step]!, miniapp: 0, total: FUNNEL_TOTALS[step]! })),
    sessions: { web: 300, miniapp: 0, total: 300 },
  },
  repeat: { newBuyers: 8, newBuyersWithSecond: 4, buyers: 10, returningBuyers: 2 },
  games: { players: 20, buyers: 5, byGame: [{ game: 'match', players: 12, buyers: 3 }, { game: 'kitchen_swap', players: 4, buyers: 1 }] },
  daily: Array.from({ length: days }, (_, i) => ({
    day: new Date(Date.parse(days === 7 ? '2026-11-12' : '2026-10-20') + i * 86_400_000).toISOString().slice(0, 10),
    orders: i,
    players: 2,
  })),
  referralFirstOrder: { rewarded: 12, blocked: { SELF: 0, PHONE: 1, ZALO: 0, ADDRESS: 1, IP: 3 } },
  referralShares: { share: 1234, copy: 56 },
  remarketing: {
    windowHours: 72,
    rows: [
      { notice: 'abandoned_cart', sent: 200, znsSent: 50, znsCapped: 12, orders: 10, revenue: 2_500_000 },
      { notice: 'winback', sent: 40, znsSent: 0, znsCapped: 0, orders: 1, revenue: 180_000 },
      { notice: 'wishlist_price_drop', sent: 0, znsSent: 0, znsCapped: 0, orders: 0, revenue: 0 },
      { notice: 'refill_21d', sent: 30, znsSent: 30, znsCapped: 0, orders: 3, revenue: 540_000 },
      { notice: 'payment_reminder', sent: 8, znsSent: 0, znsCapped: 0, orders: 5, revenue: 1_200_000 },
    ],
    proactiveCap: { perDay: 1, perWeek: 4 },
  },
});

const campaign = (o: Partial<AdminCampaignRow>): AdminCampaignRow => ({
  id: 'c1',
  slug: 'c1',
  title: 'Tuần lễ xanh',
  subtitle: null,
  placement: 'HOME_TOP',
  image: null,
  linkType: 'CAMPAIGN_PAGE',
  linkValue: null,
  audience: 'ALL',
  startAt: '2026-11-10T00:00:00.000Z',
  endAt: '2026-11-30T00:00:00.000Z',
  sortOrder: 0,
  isActive: true,
  productCount: 2,
  couponCount: 0,
  status: 'live',
  health: { blockers: 0, warnings: 0 },
  ...o,
});

function setup(configRows: ConfigRow[], campaigns: AdminCampaignRow[] = [], week: AdminGrowthOverviewDTO = overview(7)) {
  const puts: { key: string; value: unknown }[] = [];
  const patches: unknown[] = [];
  const api = mockFetch({
    '/admin/config': (init) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return { body: { ok: true } };
      }
      return { body: configRows };
    },
    '/admin/growth/overview?days=30': { body: overview(30) },
    '/admin/growth/overview': { body: week },
    '/admin/campaigns': (init) => {
      if (init?.method === 'PATCH') {
        patches.push(JSON.parse(String(init.body)));
        return { body: {} };
      }
      return { body: campaigns };
    },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const onOpenConfig = vi.fn();
  const onOpenCampaigns = vi.fn();
  const r = render(<GrowthHubTab onOpenConfig={onOpenConfig} onOpenCampaigns={onOpenCampaigns} />);
  mounted.push(r);
  return { ...r, puts, patches, calls: api.calls, onOpenConfig, onOpenCampaigns };
}

const sw = (root: ParentNode, label: string) => root.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`)!;
const row = (root: ParentNode, key: string) => root.querySelector<HTMLElement>(`[data-growth-key="${key}"]`)!;
const input = (root: ParentNode, label: string) => root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const saveBtn = (root: ParentNode, key: string) => row(root, key).querySelector<HTMLButtonElement>('button[type="submit"]')!;

describe('GrowthHubTab', () => {
  it('phễu 7 ngày: thẻ số theo bước, % so với bước trước, mua lần 2, người chơi đặt đơn và bảng theo game', async () => {
    const { container, calls } = setup([]);
    await flush(8);
    const text = container.textContent!;
    expect(calls.some((c) => c.url.includes('/admin/growth/overview?days=7'))).toBe(true);
    expect(text).toContain('Xem sản phẩm');
    expect(text).toContain('Thêm giỏ');
    expect(text).toContain('Bắt đầu thanh toán');
    expect(text).toContain('Đặt đơn thành công');
    expect(text).toContain('25% so với bước trước');
    expect(text).toContain('50% so với bước trước');
    // Mua lần 2: 4/8 khách mua lần đầu; người chơi đặt đơn: 5/20.
    expect(text).toContain('Quay lại mua lần 2');
    expect(text).toContain('4/8 khách mua lần đầu');
    expect(text).toContain('5/20 người chơi');
    expect(text).toContain('Từ xem sản phẩm tới đặt đơn: 5%');
    expect(text).toContain('Ghép Cặp');
    expect(text).toContain('Căn Bếp Xanh');
    expect(text).toContain('Kỳ 7 ngày còn ngắn');
    expect(container.querySelectorAll('svg[role="img"]')).toHaveLength(2);
  });

  it('thưởng mời bạn đơn đầu: số cặp đã thưởng, số đơn chặn theo IP và lý do khác, tỷ lệ chặn theo IP để theo dõi chặn nhầm', async () => {
    const { container } = setup([]);
    await flush(8);
    const box = container.querySelector<HTMLElement>('[data-referral-guard]')!;
    expect(box).not.toBeNull();
    const text = box.textContent!;
    expect(text).toContain('Thưởng mời bạn đơn đầu');
    expect(box.querySelector('[data-guard="rewarded"]')!.textContent).toBe('12');
    expect(box.querySelector('[data-guard="ip"]')!.textContent).toBe('3');
    expect(box.querySelector('[data-guard="other"]')!.textContent).toBe('2');
    expect(text).toContain('SĐT 1 · Địa chỉ 1');
    // 3 chặn theo IP / (12 đã thưởng + 3 chặn theo IP) = 20%.
    expect(text).toContain('Chặn theo IP chiếm 20%');
    // Lượt bấm gửi link mời (sự kiện green_card_shared) cùng khối với thưởng đơn đầu.
    expect(box.querySelector('[data-guard="shares"]')!.textContent).toBe('1.290');
    expect(box.querySelector('[data-referral-shares]')!.textContent).toContain('chia sẻ 1.234 · sao chép 56');
  });

  it('Tin nào ra đơn: mỗi loại tin một dòng, tỷ lệ ra đơn, ZNS bị trần, doanh thu mỗi tin ZNS, dòng tổng và trần đang áp', async () => {
    const { container } = setup([]);
    await flush(8);
    const box = container.querySelector<HTMLElement>('[data-remarketing]')!;
    expect(box.textContent).toContain('Tin nào ra đơn');
    const cells = (key: string) => [...box.querySelectorAll(`[data-remarketing-row="${key}"] > *`)].map((c) => c.textContent);
    // 10 đơn / 200 tin = 5%; 2.500.000đ / 50 tin ZNS = 50.000đ.
    expect(cells('abandoned_cart')).toEqual(['Nhắc giỏ bỏ quên', '200', '5012 bị trần', '10', '5%', '2.500.000đ', '50.000đ']);
    // Không có tin ZNS thì không chia được; chưa gửi tin nào thì tỷ lệ là gạch.
    expect(cells('winback')).toEqual(['Mã mời quay lại', '40', '0', '1', '2,5%', '180.000đ', '—']);
    expect(cells('wishlist_price_drop')).toEqual(['Giá món Yêu thích giảm', '0', '0', '0', '—', '0đ', '—']);
    expect(cells('payment_reminder')).toEqual(['Nhắc chuyển khoản', '8', '0', '5', '62,5%', '1.200.000đ', '—']);
    // Tổng: 278 tin, 80 ZNS (12 bị trần), 19 đơn, 4.420.000đ → 4.420.000 / 80 = 55.250đ.
    expect(cells('total')).toEqual(['Tổng', '278', '8012 bị trần', '19', '6,8%', '4.420.000đ', '55.250đ']);
    expect(box.querySelector('[data-remarketing-cap]')!.textContent).toContain('tối đa 1 tin/ngày và 4 tin/7 ngày mỗi khách');
    expect(box.querySelector('[data-remarketing-error]')).toBeNull();
  });

  it('Tin nào ra đơn: API báo null thì ghi chưa đọc được, phễu vẫn hiện; API cũ không trả khối thì không có bảng', async () => {
    const failed = setup([], [], { ...overview(7), remarketing: null });
    await flush(8);
    expect(failed.container.querySelector('[data-remarketing-error]')!.textContent).toContain('Chưa đọc được số liệu tin nhắc');
    expect(failed.container.querySelector('[data-remarketing-row]')).toBeNull();
    expect(failed.container.textContent).toContain('Quay lại mua lần 2');
    failed.unmount();
    mounted = [];
    vi.unstubAllGlobals();

    const { remarketing: _omit, ...old } = overview(7);
    const legacy = setup([], [], old);
    await flush(8);
    expect(legacy.container.textContent).toContain('Quay lại mua lần 2');
    expect(legacy.container.querySelector('[data-remarketing]')).toBeNull();
  });

  it('remarketingTable: loại API chưa trả là dòng 0 theo đúng thứ tự; trần tắt có câu riêng', () => {
    const t = remarketingTable({ windowHours: 72, rows: [{ notice: 'refill_21d', sent: 4, znsSent: 2, znsCapped: 1, orders: 1, revenue: 99_999 }], proactiveCap: null });
    expect(t.rows.map((r) => r.key)).toEqual(['abandoned_cart', 'winback', 'wishlist_price_drop', 'refill_21d', 'payment_reminder']);
    expect(t.rows[3]).toMatchObject({ ratePct: 25, revenuePerZns: 50_000 });
    expect(t.total).toMatchObject({ sent: 4, znsSent: 2, znsCapped: 1, orders: 1, revenue: 99_999 });
    expect(capLine(null)).toContain('đang tắt');
  });

  it('chọn 30 ngày thì gọi lại với days=30 và vẽ 30 cột mỗi biểu đồ', async () => {
    const { container, calls } = setup([]);
    await flush(8);
    const btn30 = [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((b) => b.textContent === '30 ngày')!;
    click(btn30);
    await flush(8);
    expect(btn30.getAttribute('aria-pressed')).toBe('true');
    expect(calls.some((c) => c.url.includes('/admin/growth/overview?days=30'))).toBe(true);
    expect(container.querySelector('svg[role="img"]')!.querySelectorAll('title')).toHaveLength(30);
    expect(container.textContent).not.toContain('Kỳ 7 ngày còn ngắn');
  });

  it('bật một game hỏi xác nhận rồi PUT đúng khoá; game bật mà công tắc chung tắt thì báo "Chờ công tắc chung"', async () => {
    const { container, puts } = setup(cfg({ 'game.mini.enabled': false, 'game.mini.origin.enabled': true }));
    await flush(8);
    expect(row(container, 'game.mini.origin.enabled').textContent).toContain('Chờ công tắc chung');
    expect(row(container, 'game.mini.match.enabled').textContent).not.toContain('Chờ công tắc chung');
    click(sw(container, 'Ghép Cặp'));
    await flush();
    expect(confirmDialog()!.textContent).toContain('Bật "Ghép Cặp"?');
    answerConfirm(true);
    await flush(8);
    expect(puts).toEqual([{ key: 'game.mini.match.enabled', value: true }]);
    expect(row(container, 'game.mini.match.enabled').textContent).toContain('Đã bật.');
  });

  it('huỷ xác nhận thì không ghi; tắt công tắc chung có lời cảnh báo riêng', async () => {
    const { container, puts } = setup(cfg({ 'game.mini.enabled': true }));
    await flush(8);
    click(sw(container, 'Lượt chơi có thưởng (công tắc chung)'));
    await flush();
    expect(confirmDialog()!.textContent).toContain('Mọi game mini đóng với khách ngay');
    answerConfirm(false);
    await flush();
    expect(puts).toEqual([]);
  });

  it('khoá chưa có trên hệ thống (Căn Bếp Xanh, quà 0đ, thưởng đánh giá ảnh) bị khoá, không gửi ghi', async () => {
    const { container, puts } = setup(cfg({ 'game.mini.enabled': true }));
    await flush(8);
    expect(sw(container, 'Căn Bếp Xanh').disabled).toBe(true);
    expect(row(container, 'game.mini.kitchen_swap.enabled').textContent).toContain('Chưa có trên hệ thống');
    expect(input(container, 'Mốc mở quà tặng dùng thử 0đ').disabled).toBe(true);
    expect(input(container, 'Thưởng đánh giá có ảnh thật (Góc Sống Xanh)').disabled).toBe(true);
    click(sw(container, 'Căn Bếp Xanh'));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(puts).toEqual([]);
  });

  it('khoá đã có dòng thì mở: quà 0đ đang 299.000đ không báo lệch chuẩn', async () => {
    const { container } = setup(cfg({ 'commerce.gift_trial_min_order': 299_000, 'reviews.photo_reward_points': 50 }));
    await flush(8);
    expect(input(container, 'Mốc mở quà tặng dùng thử 0đ').disabled).toBe(false);
    expect(input(container, 'Mốc mở quà tặng dùng thử 0đ').value).toBe('299000');
    expect(row(container, 'commerce.gift_trial_min_order').textContent).not.toContain('Khác mức chuẩn');
    expect(row(container, 'reviews.photo_reward_points').textContent).toContain('Khác mức chuẩn 100 Điểm Xanh');
  });

  it('mốc miễn phí giao lệch chuẩn: báo, điền mức chuẩn, xác nhận cũ → mới rồi PUT số nguyên', async () => {
    const { container, puts } = setup(cfg({ 'shipping.free_threshold': 150_000 }));
    await flush(8);
    const r = row(container, 'shipping.free_threshold');
    expect(r.textContent).toContain('Khác mức chuẩn 199.000đ');
    expect(r.textContent).toContain('Đang chạy: 150.000đ.');
    expect(saveBtn(container, 'shipping.free_threshold').disabled).toBe(true);
    click([...r.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Điền mức chuẩn'))!);
    await flush();
    expect(input(container, 'Mốc miễn phí giao hàng').value).toBe('199000');
    click(saveBtn(container, 'shipping.free_threshold'));
    await flush();
    expect(confirmDialog()!.textContent).toContain('150.000đ → 199.000đ');
    answerConfirm(true);
    await flush(8);
    expect(puts).toEqual([{ key: 'shipping.free_threshold', value: 199_000 }]);
  });

  it('trần dùng Điểm Xanh: hiện 20, chặn trên 20%, lưu 15% thành 0,15', async () => {
    const { container, puts } = setup(cfg({ 'loyalty.max_redeem_pct': 0.2 }));
    await flush(8);
    const field = input(container, 'Trần giảm voucher + Điểm Xanh mỗi đơn');
    expect(field.value).toBe('20');
    typeInto(field, '25');
    await flush();
    expect(saveBtn(container, 'loyalty.max_redeem_pct').disabled).toBe(true);
    expect(row(container, 'loyalty.max_redeem_pct').textContent).toContain('Nhập phần trăm 0–20');
    typeInto(field, '15');
    await flush();
    click(saveBtn(container, 'loyalty.max_redeem_pct'));
    await flush();
    expect(confirmDialog()!.textContent).toContain('20% → 15%');
    answerConfirm(true);
    await flush(8);
    expect(puts).toEqual([{ key: 'loyalty.max_redeem_pct', value: 0.15 }]);
  });

  it('lỗi máy chủ khi lưu thì báo đúng dòng, không báo đã lưu', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        mockFetch({
          '/admin/config': (init) =>
            init?.method === 'PUT'
              ? { status: 400, body: { message: '"game.mini.points_daily_cap": phải là số nguyên 0–500 Điểm Xanh/ngày.' } }
              : { body: cfg({ 'game.mini.points_daily_cap': 100 }) },
          '/admin/growth/overview': { body: overview(7) },
          '/admin/campaigns': { body: [] },
        }).fn,
      ),
    );
    const r = render(<GrowthHubTab />);
    mounted.push(r);
    const { container } = r;
    await flush(8);
    typeInto(input(container, 'Điểm Xanh tối đa mỗi khách mỗi ngày'), '120');
    await flush();
    click(saveBtn(container, 'game.mini.points_daily_cap'));
    await flush();
    answerConfirm(true);
    await flush(8);
    const rowEl = row(container, 'game.mini.points_daily_cap');
    expect(rowEl.querySelector('[role="alert"]')?.textContent).toContain('0–500');
    expect(rowEl.textContent).not.toContain('Đã lưu.');
  });

  it('điểm danh ngày luôn bật, hiện tổng tuần và mở tab Cấu hình', async () => {
    const { container, onOpenConfig } = setup(cfg({ 'loyalty.checkin_points': [10, 10, 10, 20, 20, 20, 50] }));
    await flush(8);
    const r = row(container, 'loyalty.checkin_points');
    expect(r.textContent).toContain('Luôn bật');
    expect(r.textContent).toContain('tổng 140 Điểm Xanh mỗi tuần');
    click([...r.querySelectorAll('button')].find((b) => b.textContent?.includes('Sửa bảng điểm'))!);
    expect(onOpenConfig).toHaveBeenCalledTimes(1);
  });

  it('banner: chỉ hiện đang chạy, sắp chạy và đang tắt; tắt banner hỏi rồi PATCH isActive false; còn lỗi chặn thì không bật được', async () => {
    const { container, patches, onOpenCampaigns } = setup([], [
      campaign({ id: 'off1', title: 'Banner tắt', isActive: false, status: 'off', health: { blockers: 2, warnings: 0 } }),
      campaign({ id: 'end1', title: 'Banner cũ', status: 'ended' }),
      campaign({ id: 'live1', title: 'Tuần lễ xanh' }),
    ]);
    await flush(8);
    const section = container.querySelector<HTMLElement>('[aria-labelledby="growth-banners-title"]')!;
    const items = [...section.querySelectorAll('li')];
    expect(items.map((li) => (li.textContent?.includes('Tuần lễ xanh') ? 'live' : li.textContent?.includes('Banner tắt') ? 'off' : '?'))).toEqual(['live', 'off']);
    expect(section.textContent).not.toContain('Banner cũ');
    const onBtn = [...items[1]!.querySelectorAll('button')].find((b) => b.textContent === 'Bật')!;
    expect(onBtn.disabled).toBe(true);
    click([...items[0]!.querySelectorAll('button')].find((b) => b.textContent === 'Tắt')!);
    await flush();
    expect(confirmDialog()!.textContent).toContain('Tắt banner "Tuần lễ xanh"?');
    answerConfirm(true);
    await flush(8);
    expect(patches).toEqual([{ isActive: false }]);
    click([...section.querySelectorAll('button')].find((b) => b.textContent === 'Quản lý banner và chiến dịch')!);
    expect(onOpenCampaigns).toHaveBeenCalledTimes(1);
  });
});
