import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GameGardenService } from './game-garden.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

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
    coupon: { create: jest.fn().mockResolvedValue({}) },
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

describe('GameGardenService.getGarden', () => {
  it('user mới chưa mở lô phụ → chỉ có lô nhà (slot 0) + nextUnlock slot 1', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(homeProfile());
    const svc = new GameGardenService(
      prisma,
      makeConfig({ 'game.max_plots': 5, 'game.plot_unlock_seed_base': 100, 'game.plot_unlock_xu_base': 200 }),
    );
    const r = await svc.getGarden('u1');
    expect(r.plots).toHaveLength(1);
    expect(r.plots[0]!.isHome).toBe(true);
    expect(r.plots[0]!.slot).toBe(0);
    expect(r.plots[0]!.progress).toBe(100);
    expect(r.maxPlots).toBe(5);
    expect(r.nextUnlock).toEqual({ slot: 1, seedCost: 100, xuCost: 200 });
  });

  it('có 1 lô phụ → 2 lô; nextUnlock slot 2 đắt hơn (giá × slot)', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(homeProfile());
    (prisma.gardenPlot.findMany as jest.Mock).mockResolvedValue([plotRow({ id: 'p1', slot: 1, progress: 50 })]);
    const svc = new GameGardenService(
      prisma,
      makeConfig({ 'game.max_plots': 5, 'game.plot_unlock_seed_base': 100, 'game.plot_unlock_xu_base': 200 }),
    );
    const r = await svc.getGarden('u1');
    expect(r.plots).toHaveLength(2);
    expect(r.plots[1]!.id).toBe('p1');
    expect(r.plots[1]!.isHome).toBe(false);
    expect(r.nextUnlock).toEqual({ slot: 2, seedCost: 200, xuCost: 400 });
  });

  it('đã đạt số lô tối đa → nextUnlock null', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(homeProfile());
    (prisma.gardenPlot.findMany as jest.Mock).mockResolvedValue([plotRow({ id: 'p1', slot: 1 })]);
    const svc = new GameGardenService(prisma, makeConfig({ 'game.max_plots': 2 }));
    const r = await svc.getGarden('u1');
    expect(r.nextUnlock).toBeNull();
  });

  it('lô có tiến trình + lâu không tưới → treeHealth WILTED/DEAD (§6.7.3)', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(homeProfile());
    (prisma.gardenPlot.findMany as jest.Mock).mockResolvedValue([
      plotRow({ id: 'p-wilt', slot: 1, progress: 100, lastWateredAt: new Date(Date.now() - 4 * DAYMS) }),
      plotRow({ id: 'p-dead', slot: 2, progress: 100, lastWateredAt: new Date(Date.now() - 8 * DAYMS) }),
    ]);
    const svc = new GameGardenService(prisma, makeConfig());
    const r = await svc.getGarden('u1');
    expect(r.plots.find((p) => p.id === 'p-wilt')!.treeHealth).toBe('WILTED');
    expect(r.plots.find((p) => p.id === 'p-dead')!.treeHealth).toBe('DEAD');
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

  it('XU → spendCoins giá xu + tạo lô (không trừ nước)', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.count as jest.Mock).mockResolvedValue(1); // đã có 1 lô → slot 2
    const coins = { spendCoins: jest.fn().mockResolvedValue(undefined) };
    const svc = new GameGardenService(
      prisma,
      makeConfig({ 'game.plot_unlock_xu_base': 200, 'game.max_plots': 5 }),
      undefined,
      undefined,
      coins as never,
    );
    const r = await svc.unlockPlot('u1', 'XU');
    expect(r.slot).toBe(2);
    expect(coins.spendCoins).toHaveBeenCalledWith('u1', 400, expect.stringContaining('GARDEN'), 'GAME', undefined, expect.anything());
    expect(prisma.gameProfile.updateMany).not.toHaveBeenCalled();
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

  it('tưới lô CHẾT (≥ death_days) → reset tiến trình rồi +drops, revivedFromDead', async () => {
    const prisma = makePrisma();
    (prisma.gardenPlot.findFirst as jest.Mock).mockResolvedValue(
      plotRow({ progress: 500, target: 600, lastWateredAt: new Date(Date.now() - 8 * DAYMS) }),
    );
    const svc = new GameGardenService(prisma, makeConfig());
    const r = await svc.waterPlot('u1', 'p1', 20);
    expect(r.revivedFromDead).toBe(true);
    expect(r.progress).toBe(20);
    expect(r.harvested).toBe(false);
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
});
