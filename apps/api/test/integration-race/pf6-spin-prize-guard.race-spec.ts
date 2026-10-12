import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { GameService } from '../../src/modules/game/game.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { createUser, setConfig, warmPool } from './helpers';

const KEY = 'game.spin_prizes';
const COST = 10;
const NONE = { id: 'none', name: 'Chúc may mắn', weight: 1, rewardType: 'NONE', value: 0 };
const WIN5 = { id: 'win5', name: '5 Điểm Xanh', weight: 1, rewardType: 'POINTS', value: 5 };
const NEGATIVE = { id: 'neg', name: 'Trừ 50 điểm', weight: 100, rewardType: 'POINTS', value: -50 };

/**
 * PF-6a mục 2: giải POINTS value âm trong `game.spin_prizes` từng đi vào nhánh trừ điểm của GameService.creditPoints, trừ điểm
 * của khách ngoài lockedOrderPoints. Nay luật ghi cấu hình từ chối bảng giải như vậy, và spin() bỏ giải hỏng của bảng đã lưu từ
 * trước luật (ghi thẳng vào DB ở đây để dựng đúng trường hợp đó).
 */
describe('PF-6a giải vòng quay có thưởng âm không bao giờ trừ điểm khách (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let config: SystemConfigService;
  let game: GameService;
  const touched: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, LoyaltyService, GameService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    config = moduleRef.get(SystemConfigService);
    game = moduleRef.get(GameService);
    await setConfig(prisma, 'game.spin_buy_cost_points', COST);
    await setConfig(prisma, 'game.spin_buy_daily_limit', 100);
    await setConfig(prisma, 'returns.window_days', 7);
    await setConfig(prisma, 'loyalty.point_expire_months', 12);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await setConfig(prisma, KEY, [NONE]);
    (config as unknown as { cache: Map<string, unknown> }).cache.clear();
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function holder(pts: number) {
    const user = await createUser(prisma, { pointsBalance: pts });
    touched.push(user.id);
    await prisma.pointsTransaction.create({
      data: { userId: user.id, delta: pts, lot: 'STANDARD', reason: 'IT_SEED_STANDARD', refType: 'IT' },
    });
    return user;
  }

  const balance = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pointsBalance;
  const spinRows = (userId: string) =>
    prisma.pointsTransaction.findMany({ where: { userId, reason: { startsWith: 'GAME_SPIN' } }, orderBy: { delta: 'asc' } });

  it('ghi bảng giải có giải POINTS âm qua SystemConfigService.set bị từ chối và giá trị cũ trong DB không đổi', async () => {
    await setConfig(prisma, KEY, [NONE, WIN5]);
    (config as unknown as { cache: Map<string, unknown> }).cache.clear();

    const historyBefore = await prisma.systemConfigHistory.count({ where: { key: KEY } });

    await expect(config.set(KEY, [NONE, NEGATIVE], 'it-admin')).rejects.toBeInstanceOf(BadRequestException);

    const row = await prisma.systemConfig.findUniqueOrThrow({ where: { key: KEY } });
    expect(row.value).toEqual([NONE, WIN5]);
    expect(await prisma.systemConfigHistory.count({ where: { key: KEY } })).toBe(historyBefore);
  });

  it('ghi bảng giải hợp lệ qua set vẫn được', async () => {
    await config.set(KEY, [NONE, WIN5], 'it-admin');
    expect((await prisma.systemConfig.findUniqueOrThrow({ where: { key: KEY } })).value).toEqual([NONE, WIN5]);
  });

  it('bảng đã lưu có giải POINTS âm là giải đầu, trọng số lớn nhất: quay chỉ trừ phí, không trừ thêm, không dòng GAME_SPIN_WIN', async () => {
    await setConfig(prisma, KEY, [NEGATIVE, NONE]);
    (config as unknown as { cache: Map<string, unknown> }).cache.clear();
    jest.spyOn(Math, 'random').mockReturnValue(0); // chọn giải đầu nếu nó còn trong danh sách
    const user = await holder(60);

    const results = await Promise.all([game.spin(user.id), game.spin(user.id), game.spin(user.id)]);

    expect(results.map((r) => r.prize.id)).toEqual(['none', 'none', 'none']);
    expect(await balance(user.id)).toBe(60 - 3 * COST);
    expect((await spinRows(user.id)).map((r) => r.delta)).toEqual([-COST, -COST, -COST]);
  });

  it('bảng đã lưu chỉ có giải hỏng → "Vòng quay chưa cấu hình", số dư nguyên', async () => {
    await setConfig(prisma, KEY, [NEGATIVE]);
    (config as unknown as { cache: Map<string, unknown> }).cache.clear();
    const user = await holder(60);

    await expect(game.spin(user.id)).rejects.toThrow('Vòng quay chưa cấu hình.');

    expect(await balance(user.id)).toBe(60);
    expect(await spinRows(user.id)).toEqual([]);
  });

  /**
   * Bảng giải đã lưu có value không vừa cột Int của DB (COUPON, SEEDS, NONE) hoặc không nguyên: giải vượt Int khiến mọi lượt
   * quay trúng nó lỗi 500 (tx rollback); giải lẻ thì DB cắt phần lẻ nên khách thấy 2.5 giọt nhưng nhận 2.
   */
  it.each([
    ['COUPON vượt cột Int', { id: 'big', name: 'Voucher', weight: 100, rewardType: 'COUPON', value: 3e9 }],
    ['SEEDS vượt cột Int', { id: 'big', name: 'Giọt nước', weight: 100, rewardType: 'SEEDS', value: 3e9 }],
    ['SEEDS value lẻ', { id: 'frac', name: 'Giọt nước', weight: 100, rewardType: 'SEEDS', value: 2.5 }],
  ])('bảng đã lưu có giải %s là giải đầu, trọng số lớn nhất: bị bỏ, quay ra giải hợp lệ, không lỗi, không coupon rác', async (_label, bad) => {
    await setConfig(prisma, KEY, [bad, NONE]);
    (config as unknown as { cache: Map<string, unknown> }).cache.clear();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const user = await holder(60);
    await prisma.gameProfile.create({ data: { userId: user.id, totalSeeds: 10 } });

    const res = await game.spin(user.id);

    expect(res.prize.id).toBe('none');
    expect(await balance(user.id)).toBe(60 - COST);
    expect((await prisma.gameProfile.findUniqueOrThrow({ where: { userId: user.id } })).totalSeeds).toBe(10);
    expect(await prisma.coupon.count({ where: { scopeMeta: { path: ['userId'], equals: user.id } } })).toBe(0);
  });

  it('bảng đã lưu chỉ có giải COUPON vượt cột Int → "Vòng quay chưa cấu hình", số dư nguyên (không lỗi 500 làm hỏng lượt quay)', async () => {
    await setConfig(prisma, KEY, [{ id: 'big', name: 'Voucher', weight: 1, rewardType: 'COUPON', value: 3e9 }]);
    (config as unknown as { cache: Map<string, unknown> }).cache.clear();
    const user = await holder(60);

    await expect(game.spin(user.id)).rejects.toThrow('Vòng quay chưa cấu hình.');

    expect(await balance(user.id)).toBe(60);
  });

  it('ghi bảng giải có giải lẻ hoặc vượt cột Int qua SystemConfigService.set bị từ chối', async () => {
    await setConfig(prisma, KEY, [NONE, WIN5]);
    (config as unknown as { cache: Map<string, unknown> }).cache.clear();

    await expect(
      config.set(KEY, [NONE, { id: 'frac', name: 'x', weight: 1, rewardType: 'COUPON', value: 20000.5 }], 'it-admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      config.set(KEY, [NONE, { id: 'big', name: 'x', weight: 1, rewardType: 'COUPON', value: 3e9 }], 'it-admin'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect((await prisma.systemConfig.findUniqueOrThrow({ where: { key: KEY } })).value).toEqual([NONE, WIN5]);
  });

  it('giải POINTS dương vẫn cộng điểm có hạn như cũ (không bị chặn nhầm)', async () => {
    await setConfig(prisma, KEY, [WIN5]);
    (config as unknown as { cache: Map<string, unknown> }).cache.clear();
    const user = await holder(60);

    await game.spin(user.id);

    expect(await balance(user.id)).toBe(60 - COST + 5);
    const win = await prisma.pointsTransaction.findFirstOrThrow({ where: { userId: user.id, reason: 'GAME_SPIN_WIN:win5' } });
    expect(win.delta).toBe(5);
    expect(win.expiresAt).not.toBeNull();
  });
});
