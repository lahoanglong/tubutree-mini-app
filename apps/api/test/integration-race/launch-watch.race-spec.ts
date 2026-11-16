import { randomBytes } from 'node:crypto';
import { RECYCLE_FUNNEL_STEPS, type LaunchWatchDTO } from '@tubutree/shared-types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { LaunchWatchService } from '../../src/modules/analytics/launch-watch.service';
import { WebhookRejectCounterService } from '../../src/modules/analytics/webhook-reject-counter.service';
import { createOrder, createUser, deleteItData } from './helpers';
import { cleanupWaste, createGiftRedemption, createWarehouse, createWasteGift } from './fixtures/waste-fixtures';
import './setup-env';

/**
 * Bảng "Theo dõi 72h sau launch" trên Postgres THẬT: đây là bằng chứng duy nhất rằng SQL ở LaunchWatchService chạy được và đếm đúng
 * (spec đơn vị chỉ mock `$queryRaw`).
 *
 * Mỗi khối dùng một mốc `now` cách nhau một năm ở tương lai xa: cửa sổ chỉ chặn dưới (`>= since`), nên dữ liệu của spec khác (và của khối
 * khác trong file này) nằm ở quá khứ so với mốc, không lọt vào số đếm, và DB race dùng chung không làm lệch con số tuyệt đối.
 */
const H = 3_600_000;
const D = 24 * H;
// Thứ tự thời gian của các mốc phải trùng thứ tự các khối chạy trong file: dữ liệu khối trước nằm ở quá khứ của khối sau.
const NOW_FUNNEL = new Date('2036-06-15T12:00:00.000Z');
const NOW_UNVERIFIED = new Date('2037-06-15T12:00:00.000Z');
const NOW_GIFT = new Date('2038-06-15T12:00:00.000Z');
const NOW_GIFT_FLOOR = new Date('2038-12-15T12:00:00.000Z');
const NOW_SHIP = new Date('2039-06-15T12:00:00.000Z');
const NOW_SHIP_GROUP = new Date('2039-12-15T12:00:00.000Z');
const NOW_SECOND = new Date('2040-06-15T12:00:00.000Z');
const NOW_SECOND_GROUP = new Date('2040-12-15T12:00:00.000Z');
const NOW_EMPTY = new Date('2041-06-15T12:00:00.000Z');

const ago = (now: Date, ms: number) => new Date(now.getTime() - ms);
const EVENT_PREFIX = 'w180-lw-';

describe('LaunchWatchService — SQL trên Postgres thật', () => {
  let prisma: PrismaService;
  const runTag = randomBytes(4).toString('hex');
  const userIds: string[] = [];
  const reg = { pointIds: [] as string[], itemIds: [] as string[], giftIds: [] as string[], storefrontIds: [] as string[] };
  let seq = 0;

  const snapshot = (now: Date, rulesSince?: Date): Promise<LaunchWatchDTO> => new LaunchWatchService(prisma, new WebhookRejectCounterService(prisma), { get: async (_key: string, fallback: unknown) => fallback } as never).getSnapshot(now, rulesSince);
  const since = (now: Date, ms: number) => ago(now, ms).toISOString();

  async function user(verified = true) {
    const u = await createUser(prisma, verified ? { phoneVerifiedAt: new Date('2026-01-01T00:00:00Z') } : {});
    userIds.push(u.id);
    return u;
  }

  async function event(o: {
    name?: string;
    platform: string;
    step?: string;
    userId?: string;
    anonymousId?: string;
    sessionId?: string;
    receivedAt: Date;
    occurredAt?: Date;
  }) {
    await prisma.analyticsEvent.create({
      data: {
        eventId: `${EVENT_PREFIX}${runTag}-${seq++}`,
        eventName: o.name ?? 'recycle_funnel_step',
        occurredAt: o.occurredAt ?? o.receivedAt,
        receivedAt: o.receivedAt,
        userId: o.userId,
        anonymousId: o.anonymousId,
        sessionId: o.sessionId,
        platform: o.platform,
        props: o.step ? { step: o.step } : {},
      },
    });
  }

  async function wasteRequest(userId: string, createdAt: Date, over: { pointsAwarded?: number; status?: 'OPEN' | 'COMPLETED'; orderId?: string } = {}) {
    const point = await createWarehouse(prisma);
    return prisma.wasteRequest.create({
      data: {
        code: `TR-W180${randomBytes(4).toString('hex').toUpperCase()}`,
        userId,
        method: 'DROP_OFF',
        status: over.status ?? 'OPEN',
        pointId: point.id,
        orderId: over.orderId,
        estimatedPoints: 0,
        capDayKey: '2036-06-15',
        capMonthKey: '2036-06',
        expiresAt: null,
        pointsAwarded: over.pointsAwarded,
        idempotencyKey: `w180-${randomBytes(8).toString('hex')}`,
        consentAt: createdAt,
        consentVersion: '2026-10-17.1',
        createdAt,
      },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM "analytics_events" WHERE "eventId" LIKE ${`${EVENT_PREFIX}%`}`;
    await cleanupWaste(prisma, reg);
    await deleteItData(prisma, { userIds });
    await prisma?.$disconnect();
  });

  describe('phễu Đổi rác và kho đã nhận rác thật', () => {
    let snap: LaunchWatchDTO;

    beforeAll(async () => {
      const N = NOW_FUNNEL;
      const u1 = await user();
      // enter: A (u1) ghi ở web hai lần + ở Mini App, B ẩn danh web, C chỉ có sessionId trên Mini App.
      await event({ platform: 'web', step: 'enter', userId: u1.id, receivedAt: ago(N, 1 * H) });
      await event({ platform: 'web', step: 'enter', userId: u1.id, receivedAt: ago(N, 2 * H) });
      await event({ platform: 'web', step: 'enter', anonymousId: 'anon-B', receivedAt: ago(N, 3 * H) });
      await event({ platform: 'miniapp', step: 'enter', userId: u1.id, receivedAt: ago(N, 4 * H) });
      await event({ platform: 'miniapp', step: 'enter', sessionId: 'sess-C', receivedAt: ago(N, 5 * H) });
      // Không được tính: nền tảng admin, sự kiện khác tên, bước lạ.
      await event({ platform: 'admin', step: 'enter', userId: 'it-admin', receivedAt: ago(N, 1 * H) });
      await event({ name: 'screen_viewed', platform: 'web', step: 'enter', userId: 'it-viewer', receivedAt: ago(N, 1 * H) });
      await event({ platform: 'web', step: 'bogus_step', userId: 'it-bogus', receivedAt: ago(N, 1 * H) });
      // Biên cửa sổ 72 giờ: đúng mốc since thì tính (>=), trước 1ms thì rơi sang cửa sổ 7 ngày.
      await event({ platform: 'web', step: 'phone_saved', userId: 'it-edge-in', receivedAt: ago(N, 72 * H) });
      await event({ platform: 'web', step: 'phone_saved', userId: 'it-edge-out', receivedAt: new Date(ago(N, 72 * H).getTime() - 1) });
      // Cửa sổ lọc theo receivedAt (lúc máy chủ nhận), không theo occurredAt của máy khách.
      await event({ platform: 'web', step: 'geo_granted', userId: 'it-skew', receivedAt: ago(N, 1 * H), occurredAt: ago(N, 400 * D) });
      await event({ platform: 'miniapp', step: 'submitted', userId: 'it-d7', receivedAt: ago(N, 100 * H), occurredAt: ago(N, 1 * H) });
      await event({ platform: 'web', step: 'fee_path_wallet', userId: 'it-d30', receivedAt: ago(N, 10 * D) });
      // recycle_confirmed là sự kiện máy chủ (platform 'system'), đếm sự kiện và khách khác nhau.
      await event({ name: 'recycle_confirmed', platform: 'system', userId: 'it-c1', receivedAt: ago(N, 3 * H) });
      await event({ name: 'recycle_confirmed', platform: 'system', userId: 'it-c1', receivedAt: ago(N, 5 * H) });
      await event({ name: 'recycle_confirmed', platform: 'system', userId: 'it-c2', receivedAt: ago(N, 71 * H) });
      await event({ name: 'recycle_confirmed', platform: 'system', userId: 'it-c3', receivedAt: ago(N, 80 * H) });
      await event({ name: 'recycle_confirmed', platform: 'system', userId: 'it-c4', receivedAt: ago(N, 10 * D) });
      snap = await snapshot(N);
    });

    const row = (w: 'h72' | 'd7' | 'd30', step: string) => snap.windows[w].funnel.rows.find((r) => r.step === step)!;

    it('luôn đủ mọi bước theo đúng thứ tự, bước chưa có sự kiện là 0, bước lạ bị bỏ', () => {
      for (const w of ['h72', 'd7', 'd30'] as const) {
        expect(snap.windows[w].funnel.rows.map((r) => r.step)).toEqual([...RECYCLE_FUNNEL_STEPS]);
      }
      expect(row('h72', 'fee_path_bank')).toEqual({ step: 'fee_path_bank', web: 0, miniapp: 0, total: 0 });
      expect(row('d30', 'second_order_click')).toEqual({ step: 'second_order_click', web: 0, miniapp: 0, total: 0 });
    });

    it('enter: tách web/Mini App, total là khách khác nhau (A dùng cả hai nền tảng chỉ tính một lần)', () => {
      expect(row('h72', 'enter')).toEqual({ step: 'enter', web: 2, miniapp: 2, total: 3 });
      expect(row('d30', 'enter')).toEqual({ step: 'enter', web: 2, miniapp: 2, total: 3 });
    });

    it('biên 72 giờ tính theo receivedAt, đúng mốc thì có, trước 1ms thì chỉ có ở 7 ngày', () => {
      expect(row('h72', 'phone_saved')).toEqual({ step: 'phone_saved', web: 1, miniapp: 0, total: 1 });
      expect(row('d7', 'phone_saved')).toEqual({ step: 'phone_saved', web: 2, miniapp: 0, total: 2 });
      expect(row('h72', 'geo_granted').web).toBe(1);
      expect(row('h72', 'submitted').total).toBe(0);
      expect(row('d7', 'submitted')).toEqual({ step: 'submitted', web: 0, miniapp: 1, total: 1 });
      expect(row('d7', 'fee_path_wallet').total).toBe(0);
      expect(row('d30', 'fee_path_wallet')).toEqual({ step: 'fee_path_wallet', web: 1, miniapp: 0, total: 1 });
    });

    it('kho đã nhận rác thật: số sự kiện và số khách khác nhau theo từng cửa sổ', () => {
      expect([snap.windows.h72.funnel.confirmedRequests, snap.windows.h72.funnel.confirmedUsers]).toEqual([3, 2]);
      expect([snap.windows.d7.funnel.confirmedRequests, snap.windows.d7.funnel.confirmedUsers]).toEqual([4, 3]);
      expect([snap.windows.d30.funnel.confirmedRequests, snap.windows.d30.funnel.confirmedUsers]).toEqual([5, 4]);
    });

    it('generatedAt là mốc now truyền vào', () => {
      expect(snap.generatedAt).toBe(NOW_FUNNEL.toISOString());
    });
  });

  describe('SĐT chưa xác thực', () => {
    it('tổng yêu cầu của mọi khách; phần chưa xác thực tách riêng (yêu cầu, khách, điểm đã cộng chỉ để tham khảo); biên theo createdAt', async () => {
      const N = NOW_UNVERIFIED;
      const u1 = await user(false);
      const u2 = await user(false);
      const verified = await user(true);
      await wasteRequest(u1.id, ago(N, 1 * H));
      await wasteRequest(u1.id, ago(N, 48 * H), { pointsAwarded: 20 });
      await wasteRequest(u1.id, ago(N, 20 * D), { pointsAwarded: 30 });
      await wasteRequest(u2.id, ago(N, 5 * H));
      await wasteRequest(u2.id, new Date(ago(N, 72 * H).getTime() - 1));
      // Khách đã xác thực: vào totalRequests nhưng không vào phần chưa xác thực (cả điểm 50 và 70 không được cộng vào pointsAwarded).
      await wasteRequest(verified.id, ago(N, 1 * H), { pointsAwarded: 50 });
      await wasteRequest(verified.id, ago(N, 30 * H), { pointsAwarded: 70 });

      const snap = await snapshot(N);
      expect(snap.windows.h72.fraud.unverifiedPhone).toEqual({ totalRequests: 5, requests: 3, users: 2, pointsAwarded: 20 });
      expect(snap.windows.d7.fraud.unverifiedPhone).toEqual({ totalRequests: 6, requests: 4, users: 2, pointsAwarded: 20 });
      expect(snap.windows.d30.fraud.unverifiedPhone).toEqual({ totalRequests: 7, requests: 5, users: 2, pointsAwarded: 50 });
    });
  });

  describe('Quà 0đ gắn đơn', () => {
    it('đếm quà gắn, tài khoản, tối đa mỗi tài khoản, đơn quá 1 quà, đơn dưới 99.000đ ròng; đơn huỷ và quà chưa gắn bị loại', async () => {
      const N = NOW_GIFT;
      const g1 = await user();
      const g2 = await user();
      const gift = await createWasteGift(prisma);
      reg.giftIds.push(gift.id);

      async function orderWithGifts(userId: string, createdAt: Date, o: { subtotal: number; discount?: number; status?: 'CONFIRMED' | 'CANCELLED'; gifts: number }) {
        const discount = o.discount ?? 0;
        const order = await createOrder(prisma, {
          userId,
          status: o.status ?? 'CONFIRMED',
          subtotal: o.subtotal,
          discount,
          total: o.subtotal - discount,
          createdAt,
        });
        for (let i = 0; i < o.gifts; i++) {
          const r = await createGiftRedemption(prisma, { userId, giftId: gift.id });
          await prisma.wasteGiftRedemption.update({ where: { id: r.id }, data: { attachedOrderId: order.id } });
        }
        return order;
      }

      await orderWithGifts(g1.id, ago(N, 1 * H), { subtotal: 150_000, gifts: 1 });
      await orderWithGifts(g1.id, ago(N, 2 * H), { subtotal: 150_000, gifts: 1 });
      await orderWithGifts(g2.id, ago(N, 3 * H), { subtotal: 200_000, gifts: 2 }); // đơn mang 2 quà
      await orderWithGifts(g2.id, ago(N, 4 * H), { subtotal: 120_000, discount: 30_000, gifts: 1 }); // ròng 90.000 < 99.000
      await orderWithGifts(g2.id, ago(N, 5 * H), { subtotal: 150_000, status: 'CANCELLED', gifts: 1 }); // đơn huỷ: loại
      await orderWithGifts(g1.id, ago(N, 80 * H), { subtotal: 99_000, gifts: 1 }); // đúng 99.000: không dưới sàn, chỉ có ở 7 ngày
      await orderWithGifts(g1.id, ago(N, 10 * D), { subtotal: 50_000, gifts: 1 }); // dưới sàn, chỉ có ở 30 ngày
      await createGiftRedemption(prisma, { userId: g1.id, giftId: gift.id }); // quà chưa gắn đơn nào: loại

      const snap = await snapshot(N);
      expect(snap.windows.h72.fraud.zeroGift).toEqual({ attached: 5, accounts: 2, maxPerAccount: 3, ordersOverOne: 1, ordersBelowMin: 1, countedSince: since(N, 72 * H) });
      expect(snap.windows.d7.fraud.zeroGift).toEqual({ attached: 6, accounts: 2, maxPerAccount: 3, ordersOverOne: 1, ordersBelowMin: 1, countedSince: since(N, 7 * D) });
      expect(snap.windows.d30.fraud.zeroGift).toEqual({ attached: 7, accounts: 2, maxPerAccount: 4, ordersOverOne: 1, ordersBelowMin: 2, countedSince: since(N, 30 * D) });
    });
  });

  describe('Quà 0đ chỉ đếm từ mốc luật W179', () => {
    it('đơn tạo trước mốc đi theo luật cũ nên không tính; mốc muộn hơn đầu cửa sổ thì countedSince là mốc', async () => {
      const N = NOW_GIFT_FLOOR;
      const g = await user();
      const gift = await createWasteGift(prisma);
      reg.giftIds.push(gift.id);
      const attach = async (createdAt: Date, subtotal: number, gifts: number) => {
        const order = await createOrder(prisma, { userId: g.id, subtotal, total: subtotal, createdAt });
        for (let i = 0; i < gifts; i++) {
          const r = await createGiftRedemption(prisma, { userId: g.id, giftId: gift.id });
          await prisma.wasteGiftRedemption.update({ where: { id: r.id }, data: { attachedOrderId: order.id } });
        }
      };
      await attach(ago(N, 1 * H), 150_000, 1); // sau mốc, hợp lệ
      await attach(ago(N, 2 * H), 50_000, 1); // sau mốc, dưới sàn: vi phạm
      await attach(ago(N, 5 * H), 50_000, 3); // trước mốc: luật cũ cho phép, không tính
      await attach(ago(N, 10 * D), 20_000, 2); // trước mốc rất xa: không tính

      const rulesSince = ago(N, 3 * H);
      const snap = await snapshot(N, rulesSince);
      for (const w of ['h72', 'd7', 'd30'] as const) {
        expect(snap.windows[w].fraud.zeroGift).toEqual({ attached: 2, accounts: 1, maxPerAccount: 2, ordersOverOne: 0, ordersBelowMin: 1, countedSince: rulesSince.toISOString() });
      }

      const noFloor = await snapshot(N, new Date(0));
      expect(noFloor.windows.h72.fraud.zeroGift).toMatchObject({ attached: 5, ordersOverOne: 1, ordersBelowMin: 2 });
      expect(noFloor.windows.h72.fraud.zeroGift.countedSince).toBe(since(N, 72 * H));
    });
  });

  describe('Đơn miễn ship kèm rác', () => {
    it('tỉ lệ trên đơn không huỷ và không phải đơn lên hộ khách; đếm đơn có yêu cầu thu rác đã hoàn tất', async () => {
      const N = NOW_SHIP;
      const f1 = await user();
      const f2 = await user();
      const f3 = await user();
      const mk = (userId: string, createdAt: Date, o: { pickup?: boolean; status?: 'CONFIRMED' | 'DELIVERED' | 'CANCELLED'; forCustomer?: boolean } = {}) =>
        createOrder(prisma, {
          userId,
          status: o.status ?? 'CONFIRMED',
          createdAt,
          hasRecyclingPickup: o.pickup ?? false,
          placedForCustomer: o.forCustomer ?? false,
        });

      const o1 = await mk(f1.id, ago(N, 1 * H), { pickup: true });
      const o2 = await mk(f1.id, ago(N, 2 * H), { pickup: true, status: 'DELIVERED' });
      const o3 = await mk(f2.id, ago(N, 3 * H), { pickup: true });
      await mk(f3.id, ago(N, 4 * H));
      await mk(f3.id, ago(N, 5 * H));
      await mk(f2.id, ago(N, 6 * H), { pickup: true, status: 'CANCELLED' }); // huỷ: loại khỏi cả tử và mẫu
      await mk(f3.id, ago(N, 7 * H), { pickup: true, forCustomer: true }); // đơn lên hộ khách: loại
      await mk(f2.id, ago(N, 80 * H)); // chỉ có ở 7 ngày
      const o9 = await mk(f1.id, ago(N, 10 * D), { pickup: true }); // chỉ có ở 30 ngày
      await wasteRequest(f1.id, ago(N, 1 * H), { status: 'COMPLETED', orderId: o1.id });
      await wasteRequest(f1.id, ago(N, 2 * H), { status: 'OPEN', orderId: o2.id }); // chưa hoàn tất: không tính
      await wasteRequest(f2.id, ago(N, 3 * H), { status: 'COMPLETED', orderId: o3.id });
      await wasteRequest(f1.id, ago(N, 10 * D), { status: 'COMPLETED', orderId: o9.id });

      const snap = await snapshot(N);
      expect(snap.windows.h72.fraud.freeShipRecycle).toEqual({ orders: 3, users: 2, totalOrders: 5, shareOfOrdersPct: 60, withConfirmedWaste: 2 });
      expect(snap.windows.d7.fraud.freeShipRecycle).toEqual({ orders: 3, users: 2, totalOrders: 6, shareOfOrdersPct: 50, withConfirmedWaste: 2 });
      expect(snap.windows.d30.fraud.freeShipRecycle).toEqual({ orders: 4, users: 2, totalOrders: 7, shareOfOrdersPct: 57.1, withConfirmedWaste: 3 });
    });
  });

  describe('Đơn miễn ship kèm rác: đếm theo lần thanh toán', () => {
    it('giỏ hỗn hợp tách nhiều đơn là một lần đặt; đơn đại lý không tính', async () => {
      const N = NOW_SHIP_GROUP;
      const u1 = await user();
      const u2 = await user();
      const group = `grp-${runTag}`;
      const tubu = await createOrder(prisma, { userId: u1.id, createdAt: ago(N, 1 * H), checkoutGroup: group, hasRecyclingPickup: true });
      await createOrder(prisma, { userId: u1.id, createdAt: ago(N, 1 * H), checkoutGroup: group }); // kiện nhãn hàng của cùng lần thanh toán
      await createOrder(prisma, { userId: u2.id, createdAt: ago(N, 2 * H) }); // một lần đặt khác, không thu rác
      await createOrder(prisma, { userId: u2.id, createdAt: ago(N, 3 * H), type: 'DEALER' }); // đại lý: loại
      await wasteRequest(u1.id, ago(N, 1 * H), { status: 'COMPLETED', orderId: tubu.id });

      const snap = await snapshot(N);
      expect(snap.windows.h72.fraud.freeShipRecycle).toEqual({ orders: 1, users: 1, totalOrders: 2, shareOfOrdersPct: 50, withConfirmedWaste: 1 });
    });
  });

  describe('Khách đặt đơn thứ hai trong 14 ngày', () => {
    it('nhóm đã đủ 14 ngày và nhóm đang chạy, đúng biên, bỏ đơn huỷ và đơn lên hộ khách', async () => {
      const N = NOW_SECOND;
      const mk = (userId: string, createdAt: Date, o: { status?: 'CONFIRMED' | 'CANCELLED'; forCustomer?: boolean } = {}) =>
        createOrder(prisma, { userId, status: o.status ?? 'CONFIRMED', createdAt, placedForCustomer: o.forCustomer ?? false });
      const first30 = ago(N, 30 * D);

      const m1 = await user(); // đơn hai sau 10 ngày: tính
      await mk(m1.id, first30);
      await mk(m1.id, new Date(first30.getTime() + 10 * D));
      const m2 = await user(); // đúng 14 ngày: tính (bao gồm biên)
      await mk(m2.id, first30);
      await mk(m2.id, new Date(first30.getTime() + 14 * D));
      const m3 = await user(); // 14 ngày + 1 giây: không tính
      await mk(m3.id, first30);
      await mk(m3.id, new Date(first30.getTime() + 14 * D + 1000));
      const m4 = await user(); // không có đơn hai
      await mk(m4.id, first30);
      const m5 = await user(); // đơn đầu đúng N-44 ngày: biên dưới loại trừ
      await mk(m5.id, ago(N, 44 * D));
      await mk(m5.id, ago(N, 40 * D));
      const m6 = await user(); // đơn đầu đúng N-14 ngày: thuộc nhóm đã đủ, có đơn hai
      await mk(m6.id, ago(N, 14 * D));
      await mk(m6.id, ago(N, 13 * D));
      const m7 = await user(); // đơn hai bị huỷ: không tính
      await mk(m7.id, ago(N, 20 * D));
      await mk(m7.id, ago(N, 19 * D), { status: 'CANCELLED' });
      const m8 = await user(); // chỉ có đơn lên hộ khách: không phải khách
      await mk(m8.id, first30, { forCustomer: true });
      const m9 = await user(); // đơn hai là đơn lên hộ khách: không tính
      await mk(m9.id, first30);
      await mk(m9.id, new Date(first30.getTime() + 1 * D), { forCustomer: true });
      const m10 = await user(); // hai đơn cùng giây (hoà thứ hạng, xếp theo id): vẫn tính
      await mk(m10.id, first30);
      await mk(m10.id, first30);
      const m11 = await user(); // đơn đầu quá 44 ngày: ngoài nhóm
      await mk(m11.id, ago(N, 60 * D));
      await mk(m11.id, ago(N, 20 * D));
      const m12 = await user(); // đơn đầu đã huỷ, đơn không huỷ sớm nhất mới là đơn đầu
      await mk(m12.id, ago(N, 60 * D), { status: 'CANCELLED' });
      await mk(m12.id, ago(N, 29 * D));

      const p1 = await user(); // đang chạy, đã có đơn hai
      await mk(p1.id, ago(N, 5 * D));
      await mk(p1.id, ago(N, 2 * D));
      const p2 = await user(); // đang chạy, chưa có đơn hai
      await mk(p2.id, ago(N, 5 * D));
      const p3 = await user(); // sát biên: N-14 ngày + 1 giây vẫn là đang chạy
      await mk(p3.id, new Date(ago(N, 14 * D).getTime() + 1000));
      await mk(p3.id, ago(N, 1 * D));

      const snap = await snapshot(N);
      // Đã đủ 14 ngày: m1 m2 m3 m4 m6 m7 m9 m10 m12 = 9 khách; có đơn hai trong 14 ngày: m1 m2 m6 m10 = 4.
      expect(snap.secondOrder).toEqual({
        windowDays: 14,
        matured: { customers: 9, withSecond: 4 },
        pending: { customers: 3, withSecond: 2 },
      });
    });
  });

  describe('Khách đặt đơn thứ hai: đếm theo lần thanh toán', () => {
    it('giỏ tách nhiều đơn không tự thành đơn thứ hai; đơn đại lý, trả hàng, chờ thanh toán không tính', async () => {
      const N = NOW_SECOND_GROUP;
      const first = ago(N, 30 * D);
      const later = new Date(first.getTime() + 5 * D);
      const mk = (userId: string, createdAt: Date, o: Record<string, unknown> = {}) => createOrder(prisma, { userId, createdAt, ...o });

      const a = await user(); // một lần thanh toán tách 2 đơn: chưa có đơn thứ hai
      await mk(a.id, first, { checkoutGroup: `a-${runTag}` });
      await mk(a.id, first, { checkoutGroup: `a-${runTag}` });
      const b = await user(); // lần thanh toán thứ hai thật: có đơn thứ hai
      await mk(b.id, first, { checkoutGroup: `b1-${runTag}` });
      await mk(b.id, first, { checkoutGroup: `b1-${runTag}` });
      await mk(b.id, later, { checkoutGroup: `b2-${runTag}` });
      const c = await user(); // đơn sau là đại lý: không tính
      await mk(c.id, first);
      await mk(c.id, later, { type: 'DEALER' });
      const d = await user(); // đơn sau bị trả: không tính
      await mk(d.id, first);
      await mk(d.id, later, { status: 'RETURNED' });
      const e = await user(); // đơn sau còn chờ thanh toán: không tính
      await mk(e.id, first);
      await mk(e.id, later, { status: 'PENDING_PAYMENT' });
      const f = await user(); // đơn đầu chờ thanh toán: chưa là đơn đầu, đơn kế tiếp mới là đơn đầu
      await mk(f.id, ago(N, 40 * D), { status: 'PENDING_PAYMENT' });
      await mk(f.id, first);

      const snap = await snapshot(N);
      expect(snap.secondOrder.matured).toEqual({ customers: 6, withSecond: 1 });
    });
  });

  describe('chưa có dữ liệu', () => {
    it('mọi số là 0, tỉ lệ đơn miễn ship là null, phễu vẫn đủ bước', async () => {
      const snap = await snapshot(NOW_EMPTY);
      for (const w of ['h72', 'd7', 'd30'] as const) {
        const win = snap.windows[w];
        expect(win.funnel.rows).toHaveLength(RECYCLE_FUNNEL_STEPS.length);
        expect(win.funnel.rows.every((r) => r.web === 0 && r.miniapp === 0 && r.total === 0)).toBe(true);
        expect(win.funnel.confirmedRequests).toBe(0);
        expect(win.fraud.unverifiedPhone).toEqual({ totalRequests: 0, requests: 0, users: 0, pointsAwarded: 0 });
        expect(win.fraud.zeroGift).toMatchObject({ attached: 0, accounts: 0, maxPerAccount: 0, ordersOverOne: 0, ordersBelowMin: 0 });
        expect(win.fraud.freeShipRecycle).toEqual({ orders: 0, users: 0, totalOrders: 0, shareOfOrdersPct: null, withConfirmedWaste: 0 });
      }
      expect(snap.secondOrder).toEqual({ windowDays: 14, matured: { customers: 0, withSecond: 0 }, pending: { customers: 0, withSecond: 0 } });
    });
  });
});
