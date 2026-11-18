import { randomBytes } from 'node:crypto';
import type { AdminGrowthOverviewDTO } from '@tubutree/shared-types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PurchaseFunnelService } from '../../src/modules/analytics/purchase-funnel.service';
import { AdminGrowthService } from '../../src/modules/admin-growth/admin-growth.service';
import { MATCHER_GAME } from '../../src/modules/game/mini/matcher/matcher.rules';
import { createOrder, createUser, deleteItData } from './helpers';
import './setup-env';

/**
 * Trung tâm tăng trưởng trên Postgres THẬT: spec đơn vị chỉ mock `$queryRaw`, đây là bằng chứng SQL mua lại, game → đơn và số theo ngày
 * chạy được và đếm đúng. Mốc `now` ở năm 2050, sau mọi mốc tương lai của spec khác; kỳ chặn dưới theo ngày VN nên dữ liệu spec khác (ở quá
 * khứ của mốc) không lọt vào số đếm. Mỗi người mua là tài khoản mới, nên thứ hạng đơn của họ chỉ gồm đơn dựng ở đây.
 */
const NOW = new Date('2050-06-15T05:00:00.000Z'); // 12:00 ngày 15/06 giờ VN
const at = (iso: string) => new Date(iso);

describe('AdminGrowthService — SQL trên Postgres thật', () => {
  let prisma: PrismaService;
  const userIds: string[] = [];
  const tag = randomBytes(4).toString('hex');
  let week: AdminGrowthOverviewDTO;
  let month: AdminGrowthOverviewDTO;

  async function user() {
    const u = await createUser(prisma);
    userIds.push(u.id);
    return u.id;
  }

  async function play(userId: string, game: string, dayKey: string, issuedAt: string, submitted: boolean) {
    const t = at(issuedAt);
    await prisma.gamePlayRound.create({
      data: { userId, game, dayKey, contentIds: [], issuedAt: t, expiresAt: new Date(t.getTime() + 600_000), submittedAt: submitted ? t : null },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const [a, b, c, d, e, f, g, h, i] = [await user(), await user(), await user(), await user(), await user(), await user(), await user(), await user(), await user()];
    // A: một đơn trước kỳ 7 ngày, một đơn trong kỳ → mua lại, không phải khách mới của kỳ 7 ngày.
    await createOrder(prisma, { userId: a, createdAt: at('2050-06-01T03:00:00Z') });
    await createOrder(prisma, { userId: a, createdAt: at('2050-06-10T03:00:00Z') });
    // B: một lần đặt tách hai đơn theo nhà bán (cùng checkoutGroup) rồi một đơn nữa lúc 01:00 ngày 13/06 giờ VN.
    const grp = `it-growth-${tag}`;
    await createOrder(prisma, { userId: b, checkoutGroup: grp, createdAt: at('2050-06-10T04:00:00Z') });
    await createOrder(prisma, { userId: b, checkoutGroup: grp, createdAt: at('2050-06-10T04:00:01Z') });
    await createOrder(prisma, { userId: b, createdAt: at('2050-06-12T18:00:00Z') });
    // C: một đơn hợp lệ; đơn huỷ, chờ thanh toán, trả hàng và đơn đặt hộ khách không được tính.
    await createOrder(prisma, { userId: c, createdAt: at('2050-06-11T03:00:00Z') });
    await createOrder(prisma, { userId: c, status: 'CANCELLED', createdAt: at('2050-06-11T04:00:00Z') });
    await createOrder(prisma, { userId: c, status: 'PENDING_PAYMENT', createdAt: at('2050-06-11T05:00:00Z') });
    await createOrder(prisma, { userId: c, status: 'RETURNED', createdAt: at('2050-06-11T06:00:00Z') });
    await createOrder(prisma, { userId: c, placedForCustomer: true, endCustomerKey: '0912345678', createdAt: at('2050-06-11T07:00:00Z') });
    // D chỉ có đơn huỷ; E chỉ có đơn sau mốc now.
    await createOrder(prisma, { userId: d, status: 'CANCELLED', createdAt: at('2050-06-14T03:00:00Z') });
    await createOrder(prisma, { userId: e, createdAt: at('2050-06-15T06:00:00Z') });
    // Biên ngày VN: H đặt 23:59 ngày 08/06 (ngoài kỳ 7 ngày), I đặt 00:00 ngày 09/06 (ngày đầu của kỳ).
    await createOrder(prisma, { userId: h, createdAt: at('2050-06-08T16:59:00Z') });
    await createOrder(prisma, { userId: i, createdAt: at('2050-06-08T17:00:00Z') });

    // A nộp hai ván Đoán Xuất Xứ ngày 09/06 rồi mới đặt đơn 10/06 → người chơi có đơn.
    await play(a, 'origin', '2050-06-09', '2050-06-09T03:00:00Z', true);
    await play(a, 'origin', '2050-06-09', '2050-06-09T04:00:00Z', true);
    // B: Chọn Chuẩn Xanh không có submittedAt vẫn là lượt chơi (09/06, trước đơn 10/06); Giỏ Đúng Việc 13/06 sau mọi đơn của B.
    await play(b, MATCHER_GAME, '2050-06-09', '2050-06-09T01:00:00Z', false);
    await play(b, 'basket', '2050-06-13', '2050-06-13T03:00:00Z', true);
    // C chơi 14/06, sau đơn 11/06 → người chơi chưa có đơn sau khi chơi.
    await play(c, 'origin', '2050-06-14', '2050-06-14T03:00:00Z', true);
    // F mở ván nhưng không nộp; G chơi trước kỳ 7 ngày.
    await play(f, 'origin', '2050-06-10', '2050-06-10T03:00:00Z', false);
    await play(g, 'sort', '2050-06-08', '2050-06-08T03:00:00Z', true);

    const svc = new AdminGrowthService(prisma, new PurchaseFunnelService(prisma));
    week = await svc.overview(7, NOW);
    month = await svc.overview(30, NOW);
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM "game_play_rounds" WHERE "userId" = ANY(${userIds}::text[])`;
    await deleteItData(prisma, { userIds });
    await prisma?.$disconnect();
  });

  it('kỳ 7 ngày bắt đầu 00:00 ngày VN thứ 7 tính lùi, gồm hôm nay', () => {
    expect(week.sinceDay).toBe('2050-06-09');
    expect(week.daily.map((p) => p.day)).toEqual(['2050-06-09', '2050-06-10', '2050-06-11', '2050-06-12', '2050-06-13', '2050-06-14', '2050-06-15']);
    expect(week.funnel.rows.length).toBeGreaterThan(0);
    expect(month.funnel.rows.map((r) => r.step)).toEqual(week.funnel.rows.map((r) => r.step));
  });

  it('mua lại 7 ngày: gộp đơn tách theo nhà bán, bỏ đơn huỷ/chờ thanh toán/trả/đặt hộ, chặn đúng biên ngày VN', () => {
    // Người mua trong kỳ: A, B, C, I. Mua lại (đơn thứ 2 trở đi trong kỳ): A, B. Khách mới của kỳ: B, C, I; trong đó B đã có đơn thứ hai.
    expect(week.repeat).toEqual({ buyers: 4, returningBuyers: 2, newBuyers: 3, newBuyersWithSecond: 1 });
  });

  it('mua lại 30 ngày: đơn đầu của A và đơn 23:59 của H vào kỳ', () => {
    expect(month.sinceDay).toBe('2050-05-17');
    expect(month.repeat).toEqual({ buyers: 5, returningBuyers: 2, newBuyers: 5, newBuyersWithSecond: 2 });
  });

  it('game → đơn: Chọn Chuẩn Xanh tính cả lượt không nộp, chỉ đếm đơn sau lần chơi đầu', () => {
    expect(week.games.players).toBe(3);
    expect(week.games.buyers).toBe(2);
    expect(week.games.byGame).toEqual([
      { game: 'origin', players: 2, buyers: 1 },
      { game: 'basket', players: 1, buyers: 0 },
      { game: MATCHER_GAME, players: 1, buyers: 1 },
    ]);
    expect(month.games.players).toBe(4);
    expect(month.games.buyers).toBe(2);
  });

  it('số theo ngày: đơn theo ngày VN của lần đặt, người chơi khác nhau theo dayKey', () => {
    const by = Object.fromEntries(week.daily.map((p) => [p.day, [p.orders, p.players]]));
    expect(by).toEqual({
      '2050-06-09': [1, 2],
      '2050-06-10': [2, 0],
      '2050-06-11': [1, 0],
      '2050-06-12': [0, 0],
      '2050-06-13': [1, 1],
      '2050-06-14': [0, 1],
      '2050-06-15': [0, 0],
    });
    expect(month.daily).toHaveLength(30);
    expect(month.daily.find((p) => p.day === '2050-06-01')).toEqual({ day: '2050-06-01', orders: 1, players: 0 });
    expect(month.daily.find((p) => p.day === '2050-06-08')).toEqual({ day: '2050-06-08', orders: 1, players: 1 });
  });
});
