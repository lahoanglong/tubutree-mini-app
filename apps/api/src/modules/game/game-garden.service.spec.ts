import { BadRequestException, GoneException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GameGardenService } from './game-garden.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { startOfVnDay, startOfVnMonth } from '../../common/vn-time';

/** Config mock: override theo key, fallback nếu không có. */
function makeConfig(overrides: Record<string, unknown> = {}): SystemConfigService {
  return {
    get: async <T>(k: string, fb?: T): Promise<T> => (k in overrides ? (overrides[k] as T) : (fb as T)),
  } as unknown as SystemConfigService;
}

/** Prisma stub — chỉ bảng GameGardenService dùng. $transaction chạy callback thật. */
function makePrisma(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    gameProfile: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    gardenPlot: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-plot', ...data })),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ zaloId: 'z1', phone: null }) },
    coupon: { create: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) },
    plantedTree: { create: jest.fn().mockResolvedValue({}) },
  };
  base.$transaction = jest
    .fn()
    .mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(base) : Promise.all(arg as unknown[]),
    );
  return { ...base, ...over } as unknown as PrismaService;
}

function homeProfile(extra: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    totalSeeds: 500,
    treeStage: 2,
    lastWateredAt: null,
    ecoImpact: { progress: 100, target: 600, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 1 },
    ...extra,
  };
}

function plotRow(extra: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    userId: 'u1',
    slot: 1,
    treeType: 'Cây Tràm',
    speciesId: null,
    progress: 50,
    target: 600,
    treeStage: 1,
    treesPlanted: 0,
    lastWateredAt: null,
    ...extra,
  };
}

const DAYMS = 24 * 3600 * 1000;

/** Chỉ giả Date (không đụng setTimeout/microtask) để async của service chạy bình thường. */
const NO_FAKE = [
  'nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
  'queueMicrotask', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
  'cancelIdleCallback', 'hrtime',
] as const;
function freezeNow(iso: string) {
  jest.useFakeTimers({ now: new Date(iso), doNotFake: [...NO_FAKE] });
}
afterEach(() => jest.useRealTimers());

describe('GameGardenService.getGarden', () => {
  it('user mới chưa mở lô phụ → chỉ có lô nhà (slot 0) + nextUnlock slot 1', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(homeProfile());
    const svc = new GameGardenService(
      prisma,
      makeConfig({ 'game.max_plots': 5, 'game.plot_unlock_seed_base': 100 }),
    );
    const r = await svc.getGarden('u1');
    expect(r.plots).toHaveLength(1);
    expect(r.plots[0]!.isHome).toBe(true);
    expect(r.plots[0]!.slot).toBe(0);
    expect(r.plots[0]!.progress).toBe(100);
    expect(r.maxPlots).toBe(5);
    // PD-3 (spec 6.3): bỏ mở lô bằng xu, nextUnlock không còn xuCost.
    expect(r.nextUnlock).toEqual({ slot: 1, seedCost: 100 });
  });

  it('có 1 lô phụ → 2 lô; nextUnlock slot 2 đắt hơn (giá × slot)', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(homeProfile());
    (prisma.gardenPlot.findMany as jest.Mock).mockResolvedValue([plotRow({ id: 'p1', slot: 1, progress: 50 })]);
    const svc = new GameGardenService(
      prisma,
      makeConfig({ 'game.max_plots': 5, 'game.plot_unlock_seed_base': 100 }),
    );
    const r = await svc.getGarden('u1');
    expect(r.plots).toHaveLength(2);
    expect(r.plots[1]!.id).toBe('p1');
    expect(r.plots[1]!.isHome).toBe(false);
    expect(r.nextUnlock).toEqual({ slot: 2, seedCost: 200 });
  });

  it('đã đạt số lô tối đa → nextUnlock null', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(homeProfile());
    (prisma.gardenPlot.findMany as jest.Mock).mockResolvedValue([plotRow({ id: 'p1', slot: 1 })]);
    const svc = new GameGardenService(prisma, makeConfig({ 'game.max_plots': 2 }));
    const r = await svc.getGarden('u1');
    expect(r.nextUnlock).toBeNull();
  });

  it('lô có tiến trình + lâu không tưới → treeHealth WILTED, không bao giờ DEAD (cây không mất tiến độ)', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(homeProfile());
    (prisma.gardenPlot.findMany as jest.Mock).mockResolvedValue([
      plotRow({ id: 'p-wilt', slot: 1, progress: 100, lastWateredAt: new Date(Date.now() - 4 * DAYMS) }),
      plotRow({ id: 'p-dead', slot: 2, progress: 100, lastWateredAt: new Date(Date.now() - 8 * DAYMS) }),
    ]);
    const svc = new GameGardenService(prisma, makeConfig());
    const r = await svc.getGarden('u1');
    expect(r.plots.find((p) => p.id === 'p-wilt')!.treeHealth).toBe('WILTED');
    expect(r.plots.find((p) => p.id === 'p-dead')!.treeHealth).toBe('WILTED');
  });
});

describe('GameGardenService.unlockPlot', () => {
  it('SEEDS không đủ nước (atomic count=0) → throw, không tạo lô', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.count as jest.Mock).mockResolvedValue(0);
    (prisma.gameProfile.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const svc = new GameGardenService(prisma, makeConfig({ 'game.plot_unlock_seed_base': 100 }));
    await expect(svc.unlockPlot('u1', 'SEEDS')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.gardenPlot.create).not.toHaveBeenCalled();
  });

  it('SEEDS đủ → trừ nước ATOMIC (guard gte) + tạo lô slot kế', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.count as jest.Mock).mockResolvedValue(0); // chưa có lô phụ → slot 1
    const svc = new GameGardenService(prisma, makeConfig({ 'game.plot_unlock_seed_base': 100, 'game.max_plots': 5 }));
    const r = await svc.unlockPlot('u1', 'SEEDS');
    expect(r.slot).toBe(1);
    const upd = (prisma.gameProfile.updateMany as jest.Mock).mock.calls[0][0];
    expect(upd.where).toEqual({ userId: 'u1', totalSeeds: { gte: 100 } });
    expect(upd.data).toEqual({ totalSeeds: { decrement: 100 } });
    expect((prisma.gardenPlot.create as jest.Mock).mock.calls[0][0].data.slot).toBe(1);
  });

  it('PD-3 (T18): XU → 410 Gone, không trừ gì, không tạo lô, không mở transaction', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.count as jest.Mock).mockResolvedValue(1);
    const svc = new GameGardenService(prisma, makeConfig({ 'game.max_plots': 5 }));
    const err = await svc.unlockPlot('u1', 'XU').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoneException);
    expect((err as Error).message).toMatch(/giọt nước/);
    expect((err as Error).message).not.toMatch(/TubuXu/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.gameProfile.updateMany).not.toHaveBeenCalled();
    expect(prisma.gardenPlot.create).not.toHaveBeenCalled();
  });

  // R2-ENGAGE-15: bấm đúp, request thua ăn unique(userId, slot) nhưng ô đã được mở.
  it('lệnh mở song song thua unique (P2002) → trả ô vừa được mở, không ném lỗi ràng buộc', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
    );
    (prisma.gardenPlot as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue(plotRow({ slot: 1 }));
    const svc = new GameGardenService(prisma, makeConfig({ 'game.plot_unlock_seed_base': 100, 'game.max_plots': 5 }));
    const r = await svc.unlockPlot('u1', 'SEEDS');
    expect(r.slot).toBe(1);
    expect((prisma.gardenPlot as unknown as { findUnique: jest.Mock }).findUnique).toHaveBeenCalledWith({
      where: { userId_slot: { userId: 'u1', slot: 1 } },
    });
  });

  it('P2002 nhưng không thấy ô nào (lỗi khác hẳn) → ném lại lỗi gốc, không nuốt', async () => {
    const prisma = makePrisma();
    const dup = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
    (prisma.gardenPlot.create as jest.Mock).mockRejectedValue(dup);
    (prisma.gardenPlot as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue(null);
    const svc = new GameGardenService(prisma, makeConfig({ 'game.max_plots': 5 }));
    await expect(svc.unlockPlot('u1', 'SEEDS')).rejects.toBe(dup);
  });

  it('có slot, ô đó đã tồn tại → trả ô cũ (idempotent), không trừ 💧, không mở transaction', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.count as jest.Mock).mockResolvedValue(1);
    (prisma.gardenPlot as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue(plotRow({ slot: 1 }));
    const svc = new GameGardenService(prisma, makeConfig({ 'game.max_plots': 5 }));
    const r = await svc.unlockPlot('u1', 'SEEDS', 1);
    expect(r.slot).toBe(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.gameProfile.updateMany).not.toHaveBeenCalled();
    expect(prisma.gardenPlot.create).not.toHaveBeenCalled();
  });

  it('có slot khác count+1 và ô chưa có → 400 bảo tải lại, không trừ 💧', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.count as jest.Mock).mockResolvedValue(1);
    (prisma.gardenPlot as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue(null);
    const svc = new GameGardenService(prisma, makeConfig({ 'game.max_plots': 5 }));
    await expect(svc.unlockPlot('u1', 'SEEDS', 3)).rejects.toThrow('hãy tải lại trang');
    expect(prisma.gameProfile.updateMany).not.toHaveBeenCalled();
    expect(prisma.gardenPlot.create).not.toHaveBeenCalled();
  });

  it('có slot = count+1 → mở đúng slot đó với giá seedBase × slot', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.count as jest.Mock).mockResolvedValue(1);
    (prisma.gardenPlot as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue(null);
    const svc = new GameGardenService(prisma, makeConfig({ 'game.plot_unlock_seed_base': 100, 'game.max_plots': 5 }));
    const r = await svc.unlockPlot('u1', 'SEEDS', 2);
    expect(r.slot).toBe(2);
    expect((prisma.gameProfile.updateMany as jest.Mock).mock.calls[0][0].data).toEqual({ totalSeeds: { decrement: 200 } });
  });

  it('XU vẫn 410 trước cả khi có slot', async () => {
    const prisma = makePrisma();
    const svc = new GameGardenService(prisma, makeConfig());
    await expect(svc.unlockPlot('u1', 'XU', 1)).rejects.toBeInstanceOf(GoneException);
  });

  it('đã đạt max lô → throw, không trừ gì', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.count as jest.Mock).mockResolvedValue(1); // 1 lô phụ, max 2 (1 nhà + 1 phụ)
    const svc = new GameGardenService(prisma, makeConfig({ 'game.max_plots': 2 }));
    await expect(svc.unlockPlot('u1', 'SEEDS')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.gameProfile.updateMany).not.toHaveBeenCalled();
    expect(prisma.gardenPlot.create).not.toHaveBeenCalled();
  });
});

describe('GameGardenService.waterPlot', () => {
  it('lô không thuộc user → NotFound', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(null);
    const svc = new GameGardenService(prisma, makeConfig());
    await expect(svc.waterPlot('u1', 'pX', 10)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('số giọt <= 0 → throw', async () => {
    const prisma = makePrisma();
    const svc = new GameGardenService(prisma, makeConfig());
    await expect(svc.waterPlot('u1', 'p1', 0)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('không đủ nước (atomic count=0) → throw', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(plotRow());
    (prisma.gameProfile.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const svc = new GameGardenService(prisma, makeConfig());
    await expect(svc.waterPlot('u1', 'p1', 20)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.gardenPlot.update).not.toHaveBeenCalled();
  });

  it('tưới chưa đủ → tăng progress, chưa thu hoạch', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(plotRow({ progress: 100, target: 600 }));
    const svc = new GameGardenService(prisma, makeConfig());
    const r = await svc.waterPlot('u1', 'p1', 20);
    expect(r.harvested).toBe(false);
    expect(r.progress).toBe(120);
    expect(prisma.coupon.create).not.toHaveBeenCalled();
    const upd = (prisma.gardenPlot.update as jest.Mock).mock.calls[0][0];
    expect(upd.data.progress).toBe(120);
  });

  it('thu hoạch → CARRY-OVER dư, +1 cây, coupon + chứng nhận', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(plotRow({ progress: 590, target: 600, treesPlanted: 2 }));
    const svc = new GameGardenService(prisma, makeConfig());
    const r = await svc.waterPlot('u1', 'p1', 20); // 610 → harvest, dư 10
    expect(r.harvested).toBe(true);
    expect(r.progress).toBe(10);
    expect(r.treesPlanted).toBe(3);
    expect(r.reward.coupon).toBeTruthy();
    expect(r.reward.certificate).toMatch(/^TUBU-/);
    expect(prisma.coupon.create).toHaveBeenCalledTimes(1);
    expect(prisma.plantedTree.create).toHaveBeenCalledTimes(1);
  });

  it('lô có target <= 0 (config lỗi) → throw, KHÔNG treo vòng lặp vô hạn', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(plotRow({ progress: 0, target: 0 }));
    const svc = new GameGardenService(prisma, makeConfig());
    await expect(svc.waterPlot('u1', 'p1', 20)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.gardenPlot.update).not.toHaveBeenCalled();
  }, 3000);

  it('tưới lô quá death_days → GIỮ tiến độ (chỉ héo), +drops, revivedFromDead luôn false', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(
      plotRow({ progress: 500, target: 600, lastWateredAt: new Date(Date.now() - 8 * DAYMS) }),
    );
    const svc = new GameGardenService(prisma, makeConfig());
    const r = await svc.waterPlot('u1', 'p1', 20);
    expect(r.revivedFromDead).toBe(false);
    expect(r.progress).toBe(520);
    expect(r.harvested).toBe(false);
  });

  describe('trần mã thu hoạch ngày/tháng (dùng chung với lô nhà)', () => {
    beforeEach(() => freezeNow('2026-10-15T05:00:00Z'));
    const harvestPlot = () => plotRow({ progress: 590, target: 600, treesPlanted: 2 });

    it('đếm mã HARVEST và GARDEN (không đếm GAME của vòng quay/nhiệm vụ) từ đầu tháng giờ VN; đủ 4 mã trong tháng → không cấp, couponCapped = MONTH', async () => {
      const prisma = makePrisma();
      (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(harvestPlot());
      const monthStart = startOfVnMonth().getTime();
      (prisma.coupon.count as jest.Mock).mockImplementation(async ({ where }: { where: { startAt: { gte: Date } } }) =>
        where.startAt.gte.getTime() === monthStart ? 4 : 0,
      );
      const svc = new GameGardenService(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 3 }));
      const r = await svc.waterPlot('u1', 'p1', 20);
      expect(r.harvested).toBe(true);
      expect(r.couponCapped).toBe('MONTH');
      expect(r.reward.coupon).toBeUndefined();
      expect(prisma.coupon.create).not.toHaveBeenCalled();
      expect(prisma.plantedTree.create).toHaveBeenCalledTimes(1);
      const where = (prisma.coupon.count as jest.Mock).mock.calls.map((c) => c[0].where).find((w) => w.startAt.gte.getTime() === monthStart);
      expect(where.OR).toEqual([{ code: { startsWith: 'HARVEST' } }, { code: { startsWith: 'GARDEN' } }]);
    });

    it('đủ trần ngày → couponCapped = DAY (ngày được xét trước tháng)', async () => {
      const prisma = makePrisma();
      (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(harvestPlot());
      (prisma.coupon.count as jest.Mock).mockResolvedValue(9);
      const r = await new GameGardenService(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 1 })).waterPlot('u1', 'p1', 20);
      expect(r.couponCapped).toBe('DAY');
      expect(prisma.coupon.create).not.toHaveBeenCalled();
    });

    it('còn dưới cả hai trần → cấp mã, không có couponCapped', async () => {
      const prisma = makePrisma();
      (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(harvestPlot());
      const r = await new GameGardenService(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 1 })).waterPlot('u1', 'p1', 20);
      expect(r.reward.coupon).toBeTruthy();
      expect(r).not.toHaveProperty('couponCapped');
    });
  });

  it('thu hoạch gói trừ-nước + cấp-thưởng + cập-nhật-lô trong 1 $transaction (atomic)', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(plotRow({ progress: 590, target: 600 }));
    const svc = new GameGardenService(prisma, makeConfig());
    await svc.waterPlot('u1', 'p1', 20);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // các thao tác ghi (trừ nước, coupon, cây thật, cập nhật lô) phải nằm TRONG transaction
    expect(prisma.gameProfile.updateMany).toHaveBeenCalled();
    expect(prisma.coupon.create).toHaveBeenCalledTimes(1);
    expect(prisma.plantedTree.create).toHaveBeenCalledTimes(1);
    expect(prisma.gardenPlot.update).toHaveBeenCalledTimes(1);
  });

  it('cập-nhật-lô lỗi → throw (không nuốt) → cả transaction rollback (trừ nước không thoát)', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(plotRow({ progress: 590, target: 600 }));
    (prisma.gardenPlot.update as jest.Mock).mockRejectedValue(new Error('db down'));
    const svc = new GameGardenService(prisma, makeConfig());
    await expect(svc.waterPlot('u1', 'p1', 20)).rejects.toThrow('db down');
  });

  it('thu hoạch → sưu tập loài (collection) + góp hồ cộng đồng (community)', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(plotRow({ progress: 590, target: 600 }));
    const collection = { collectOnHarvest: jest.fn().mockResolvedValue({ name: 'Lim', emoji: '🌳', rarity: 'RARE', ecoFact: 'ef' }) };
    const community = { contribute: jest.fn().mockResolvedValue(undefined) };
    const svc = new GameGardenService(prisma, makeConfig(), community as never, collection as never);
    const r = await svc.waterPlot('u1', 'p1', 20);
    expect(collection.collectOnHarvest).toHaveBeenCalledWith('u1');
    expect(community.contribute).toHaveBeenCalledWith('u1', 600); // 1 cây × target
    expect(r.reward.species).toMatchObject({ name: 'Lim' });
  });

  it('thu hoạch lô phụ KHÔNG tự đăng bài Community Feed', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(plotRow({ progress: 590, target: 600 }));
    const feed = { createAchievementPost: jest.fn().mockRejectedValue(new Error('down')) };
    const svc = new GameGardenService(prisma, makeConfig(), undefined, undefined, feed as never);
    const r = await svc.waterPlot('u1', 'p1', 20);
    expect(feed.createAchievementPost).not.toHaveBeenCalled();
    expect(r.harvested).toBe(true);
  });

  // P0-1 (mirror waterTree ở game.service.ts): lô phụ KHÔNG được cấp coupon vô hạn — trần
  // dùng CHUNG với lô nhà (đếm cả coupon 'GAME'-prefix lẫn 'GARDEN'-prefix trong cùng ngày).
  it('đã đạt trần coupon/ngày (kể cả trần đến từ lô nhà HARVEST-prefix) → vẫn thu hoạch nhưng KHÔNG cấp thêm coupon', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(plotRow({ progress: 0, target: 30, treesPlanted: 0 }));
    (prisma.coupon.count as jest.Mock).mockResolvedValue(3); // đã đủ trần mặc định (3/ngày), kể cả do lô nhà cấp
    const svc = new GameGardenService(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 3 }));
    const r = await svc.waterPlot('u1', 'p1', 70); // 70/30 = 2 lần harvest
    expect(r.harvested).toBe(true);
    expect(r.treesPlanted).toBe(2);
    expect(prisma.plantedTree.create).toHaveBeenCalledTimes(2); // cây thật KHÔNG bị cap
    expect(prisma.coupon.create).not.toHaveBeenCalled();
    expect(r.reward.coupon).toBeUndefined();
    // Đếm trần phải gộp cả 2 tiền tố coupon (lô nhà + lô phụ) — nếu không sẽ lọt lưới an toàn.
    const countArgs = (prisma.coupon.count as jest.Mock).mock.calls[0][0];
    expect(countArgs.where.OR).toEqual([{ code: { startsWith: 'HARVEST' } }, { code: { startsWith: 'GARDEN' } }]);
  });

  it('còn dưới trần → cấp coupon tới khi CHẠM trần trong CÙNG 1 lần tưới, phần sau đó thì thôi', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(plotRow({ progress: 0, target: 30, treesPlanted: 0 }));
    (prisma.coupon.count as jest.Mock).mockResolvedValue(2); // còn đúng 1 suất trước khi chạm trần 3
    const svc = new GameGardenService(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 3 }));
    const r = await svc.waterPlot('u1', 'p1', 70); // 2 lần harvest trong lần gọi này
    expect(r.treesPlanted).toBe(2);
    expect(prisma.plantedTree.create).toHaveBeenCalledTimes(2);
    expect(prisma.coupon.create).toHaveBeenCalledTimes(1); // chỉ 1 coupon (suất còn lại) — lần 2 chạm trần
  });

  it('race Serializable (P2034 — 2 request song song đụng trần/tồn kho) → BadRequest rõ ràng, không nuốt lỗi', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(plotRow({ progress: 590, target: 600 }));
    (prisma.$transaction as jest.Mock).mockRejectedValue(
      Object.assign(new Error('could not serialize access'), { code: 'P2034' }),
    );
    const svc = new GameGardenService(prisma, makeConfig());
    await expect(svc.waterPlot('u1', 'p1', 20)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('coupon thu hoạch lô phụ: minOrder mặc định 199.000đ (C-009, cùng khoá config với lô nhà)', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(plotRow({ progress: 590, target: 600 }));
    const svc = new GameGardenService(prisma, makeConfig({ 'game.harvest_coupon_amount': 30000 }));
    await svc.waterPlot('u1', 'p1', 20);
    const couponData = (prisma.coupon.create as jest.Mock).mock.calls[0][0].data;
    expect(couponData.value).toBe(30000);
    expect(couponData.minOrder).toBe(199000);
  });

  it('coupon thu hoạch lô phụ: config minOrder thấp hơn giá trị coupon → vẫn giữ minOrder = giá trị', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(plotRow({ progress: 590, target: 600 }));
    const svc = new GameGardenService(
      prisma,
      makeConfig({ 'game.harvest_coupon_amount': 30000, 'game.harvest_coupon_min_order': 10000 }),
    );
    await svc.waterPlot('u1', 'p1', 20);
    expect((prisma.coupon.create as jest.Mock).mock.calls[0][0].data.minOrder).toBe(30000);
  });
});

describe('GameGardenService — ngày 1 giờ VN và khách vãng lai', () => {
  it('ngày 1 giờ VN: trần ngày và trần tháng đếm từ cùng mốc nhưng ngày vẫn được xét trước', async () => {
    freezeNow('2026-10-31T20:00:00Z'); // 03:00 ngày 1/11 giờ VN
    const prisma = makePrisma();
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(plotRow({ progress: 590, target: 600, treesPlanted: 2 }));
    (prisma.coupon.count as jest.Mock).mockResolvedValue(3);
    const r = await new GameGardenService(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 3 })).waterPlot('u1', 'p1', 20);
    expect(startOfVnMonth().getTime()).toBe(startOfVnDay().getTime());
    expect(r.couponCapped).toBe('DAY');
  });

  it('khách vãng lai (guest_, chưa SĐT) thu hoạch: có chứng nhận nhưng KHÔNG có mã, rewardBlocked = GUEST', async () => {
    const prisma = makePrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ zaloId: 'guest_abc', phone: null });
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(plotRow({ progress: 590, target: 600 }));
    const r = await new GameGardenService(prisma, makeConfig()).waterPlot('u1', 'p1', 20);
    expect(r.harvested).toBe(true);
    expect(r.rewardBlocked).toBe('GUEST');
    expect(r.reward.coupon).toBeUndefined();
    expect(prisma.coupon.create).not.toHaveBeenCalled();
    expect(prisma.plantedTree.create).toHaveBeenCalledTimes(1);
  });

  it('guest đã xác thực SĐT được coi là khách thật: nhận mã', async () => {
    const prisma = makePrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ zaloId: 'guest_abc', phone: '0900000000' });
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(plotRow({ progress: 590, target: 600 }));
    const r = await new GameGardenService(prisma, makeConfig()).waterPlot('u1', 'p1', 20);
    expect(r.rewardBlocked).toBeUndefined();
    expect(r.reward.coupon).toMatch(/^GARDEN/);
  });

  it('một lần tưới ra nhiều mã: coupons[] đủ các mã, coupon là mã đầu tiên', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(plotRow({ progress: 0, target: 30, treesPlanted: 0 }));
    const r = await new GameGardenService(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 9 })).waterPlot('u1', 'p1', 70);
    expect(r.reward.coupons).toHaveLength(2);
    expect(r.reward.coupon).toBe(r.reward.coupons![0]);
  });

  it('lô nhà hồ sơ cũ target 600, chưa tưới: getGarden hiện target bậc đầu của thang', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      homeProfile({ ecoImpact: { progress: 0, target: 600, treeType: 'x', treesPlanted: 0 } }),
    );
    const r = await new GameGardenService(prisma, makeConfig({ 'game.tree_target_ladder': [60, 300, 600] })).getGarden('u1');
    expect(r.plots[0]!.target).toBe(60);
  });
});
