import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PurchaseFunnelService } from '../../src/modules/analytics/purchase-funnel.service';
import './setup-env';

/**
 * Phễu mua (bảng admin "Theo dõi 72h") trên Postgres THẬT: spec đơn vị chỉ mock `$queryRaw`, đây là bằng chứng SQL chạy được và đếm
 * đúng từng bước. Mốc `now` ở tương lai xa (sau mọi mốc của launch-watch.race-spec) và cửa sổ chặn cả hai đầu nên dữ liệu spec khác
 * không lọt vào số đếm. `analytics_events.userId` không có khoá ngoại nên dùng mã tài khoản giả.
 */
const H = 3_600_000;
const D = 24 * H;
const NOW = new Date('2043-06-15T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const EVENT_PREFIX = 'wfa-pf-';

describe('PurchaseFunnelService — SQL trên Postgres thật', () => {
  let prisma: PrismaService;
  const runTag = randomBytes(4).toString('hex');
  let seq = 0;

  async function ev(o: { name: string; platform: string; sid: string | null; at: Date; userId?: string; props?: Record<string, unknown> }) {
    await prisma.analyticsEvent.create({
      data: {
        eventId: `${EVENT_PREFIX}${runTag}-${seq++}`,
        eventName: o.name,
        occurredAt: o.at,
        receivedAt: o.at,
        userId: o.userId ?? null,
        sessionId: o.sid,
        platform: o.platform,
        props: (o.props ?? {}) as object,
      },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const uWeb = `u-web-${runTag}`;
    const uMini = `u-mini-${runTag}`;
    const uOld = `u-old-${runTag}`;

    // Phiên web A (2 giờ trước): xem SP, thêm giỏ, vào thanh toán, bấm đặt; đăng nhập giữa chừng nên chỉ sự kiện sau mới có userId; đơn ghi 5 phút sau sự kiện cuối.
    const A = randomUUID();
    await ev({ name: 'screen_viewed', platform: 'web', sid: A, at: ago(2 * H), props: { route: '/' } });
    await ev({ name: 'product_viewed', platform: 'web', sid: A, at: ago(2 * H - 60_000), props: { productSlug: 'a' } });
    await ev({ name: 'product_viewed', platform: 'web', sid: A, at: ago(2 * H - 70_000), props: { productSlug: 'b' } });
    await ev({ name: 'pdp_action', platform: 'web', sid: A, at: ago(2 * H - 120_000), props: { action: 'add_to_cart', productSlug: 'a' } });
    await ev({ name: 'checkout_started', platform: 'web', sid: A, at: ago(2 * H - 180_000), userId: uWeb, props: { entry: 'cart', itemCount: 1 } });
    await ev({ name: 'checkout_step', platform: 'web', sid: A, at: ago(2 * H - 240_000), userId: uWeb, props: { step: 'place_order_click' } });
    await ev({ name: 'order_placed', platform: 'web', sid: null, at: ago(2 * H - 540_000), userId: uWeb, props: {} });
    // Đơn tách hai: hai dòng order_placed vẫn chỉ một phiên.
    await ev({ name: 'order_placed', platform: 'web', sid: null, at: ago(2 * H - 541_000), userId: uWeb, props: {} });

    // Phiên web B (10 giờ trước): xem SP, chỉ mở chọn biến thể (không tính add_or_buy), rời đi.
    const B = randomUUID();
    await ev({ name: 'product_viewed', platform: 'web', sid: B, at: ago(10 * H), props: { productSlug: 'a' } });
    await ev({ name: 'pdp_action', platform: 'web', sid: B, at: ago(10 * H - 1000), props: { action: 'open_variant_sheet', productSlug: 'a' } });

    // Phiên web C (1 giờ trước): Mua ngay ở Giờ vàng (bỏ qua PDP), bấm đặt nhưng không có đơn (đơn thất bại).
    const C = randomUUID();
    await ev({ name: 'pdp_action', platform: 'web', sid: C, at: ago(1 * H), userId: uWeb, props: { action: 'buy_now', productSlug: 'c' } });
    await ev({ name: 'checkout_started', platform: 'web', sid: C, at: ago(1 * H - 1000), userId: uWeb, props: { entry: 'flash', itemCount: 1 } });
    await ev({ name: 'checkout_step', platform: 'web', sid: C, at: ago(1 * H - 2000), userId: uWeb, props: { step: 'place_order_click' } });

    // Phiên Mini M (5 giờ trước): đi đủ bước, đơn platform miniapp.
    const M = randomUUID();
    await ev({ name: 'product_viewed', platform: 'miniapp', sid: M, at: ago(5 * H), userId: uMini });
    await ev({ name: 'pdp_action', platform: 'miniapp', sid: M, at: ago(5 * H - 1000), userId: uMini, props: { action: 'buy_now', productSlug: 'a' } });
    await ev({ name: 'checkout_started', platform: 'miniapp', sid: M, at: ago(5 * H - 2000), userId: uMini });
    await ev({ name: 'checkout_step', platform: 'miniapp', sid: M, at: ago(5 * H - 3000), userId: uMini, props: { step: 'place_order_click' } });
    await ev({ name: 'order_placed', platform: 'miniapp', sid: null, at: ago(5 * H - 4000), userId: uMini });

    // Sự kiện không có sessionId (Mini bản cũ) không tạo phiên.
    await ev({ name: 'product_viewed', platform: 'miniapp', sid: null, at: ago(3 * H), userId: uMini });

    // Phiên web O (5 ngày trước): ngoài 72 giờ, trong 7 ngày; đơn của tài khoản khác nền tảng không được ghép.
    const O = randomUUID();
    await ev({ name: 'product_viewed', platform: 'web', sid: O, at: ago(5 * D), userId: uOld });
    await ev({ name: 'order_placed', platform: 'miniapp', sid: null, at: ago(5 * D - 1000), userId: uOld });

    // Đơn quá hạn ghép (2 giờ sau sự kiện cuối) không tính cho phiên P.
    const P = randomUUID();
    await ev({ name: 'checkout_step', platform: 'web', sid: P, at: ago(20 * D), userId: uOld, props: { step: 'place_order_click' } });
    await ev({ name: 'order_placed', platform: 'web', sid: null, at: ago(20 * D - 2 * H), userId: uOld });

    // Sự kiện sau mốc now không được đếm.
    await ev({ name: 'product_viewed', platform: 'web', sid: randomUUID(), at: new Date(NOW.getTime() + H) });
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM "analytics_events" WHERE "eventId" LIKE ${`${EVENT_PREFIX}%`}`;
    await prisma.$disconnect();
  });

  const counts = (rows: Array<{ step: string; web: number; miniapp: number; total: number }>) =>
    Object.fromEntries(rows.map((r) => [r.step, [r.web, r.miniapp, r.total]]));

  it('72 giờ: đếm đúng số phiên từng bước, tách web/Mini', async () => {
    const dto = await new PurchaseFunnelService(prisma).getSnapshot(NOW);
    const w = dto.windows.h72;
    expect(w.sessions).toEqual({ web: 3, miniapp: 1, total: 4 });
    expect(counts(w.rows)).toEqual({
      product_viewed: [2, 1, 3],
      add_or_buy: [2, 1, 3],
      checkout_started: [2, 1, 3],
      place_order_click: [2, 1, 3],
      order_placed: [1, 1, 2],
    });
  });

  it('7 ngày và 30 ngày: thêm phiên cũ, đơn khác nền tảng hoặc quá 30 phút sau phiên không được ghép', async () => {
    const dto = await new PurchaseFunnelService(prisma).getSnapshot(NOW);
    expect(dto.windows.d7.sessions).toEqual({ web: 4, miniapp: 1, total: 5 });
    expect(counts(dto.windows.d7.rows).product_viewed).toEqual([3, 1, 4]);
    expect(counts(dto.windows.d7.rows).order_placed).toEqual([1, 1, 2]);
    expect(dto.windows.d30.sessions).toEqual({ web: 5, miniapp: 1, total: 6 });
    expect(counts(dto.windows.d30.rows).place_order_click).toEqual([3, 1, 4]);
    expect(counts(dto.windows.d30.rows).order_placed).toEqual([1, 1, 2]);
  });
});
