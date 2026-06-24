import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { GameCommunityService } from './game-community.service';
import { GameCollectionService } from './game-collection.service';
import { CoinsService } from '../wallet/coins.service';
import { DEFAULT_TREE_TYPE } from './game.constants';

type TreeHealth = 'HEALTHY' | 'WILTED' | 'DEAD';
type UnlockCurrency = 'SEEDS' | 'XU';

interface PlotView {
  id: string | null; // null = lô nhà (slot 0, từ GameProfile)
  slot: number;
  isHome: boolean;
  treeType: string;
  speciesId: string | null;
  progress: number;
  target: number;
  treeStage: number;
  treesPlanted: number;
  treeHealth: TreeHealth;
}

interface EcoImpact {
  progress: number;
  target: number;
  treeType: string;
  treesPlanted: number;
}

/**
 * Vườn Xanh 2.0 — Lô đất / mở rộng vườn (§6.7 "lô đất").
 * Hệ thống ADDITIVE: lô nhà (slot 0) vẫn là cây trong GameProfile (không đụng tới),
 * user mở thêm lô phụ bằng 💧 hoặc TubuXu — mỗi lô là 1 cây độc lập tưới & thu hoạch.
 * Thu hoạch lô phụ tái dùng sưu tập loài (Phase 3) + góp hồ cộng đồng (Phase 2).
 */
@Injectable()
export class GameGardenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    @Optional() private readonly community?: GameCommunityService,
    @Optional() private readonly collection?: GameCollectionService,
    @Optional() private readonly coins?: CoinsService,
  ) {}

  // ── Đọc vườn (lô nhà + lô phụ) ─────────────────────
  async getGarden(userId: string) {
    const [profile, plots, maxPlots, seedBase, xuBase, wiltDays, deathDays] = await Promise.all([
      this.prisma.gameProfile.findUnique({ where: { userId } }),
      this.prisma.gardenPlot.findMany({ where: { userId }, orderBy: { slot: 'asc' } }),
      this.config.get<number>('game.max_plots', 5),
      this.config.get<number>('game.plot_unlock_seed_base', 100),
      this.config.get<number>('game.plot_unlock_xu_base', 200),
      this.config.get<number>('game.wilt_days', 3),
      this.config.get<number>('game.death_days', 7),
    ]);

    const homeEco = this.eco(profile?.ecoImpact);
    const home: PlotView = {
      id: null,
      slot: 0,
      isHome: true,
      treeType: homeEco.treeType,
      speciesId: null,
      progress: homeEco.progress,
      target: homeEco.target,
      treeStage: profile?.treeStage ?? 1,
      treesPlanted: homeEco.treesPlanted,
      treeHealth: this.health(profile?.lastWateredAt ?? null, homeEco.progress, wiltDays, deathDays),
    };

    const extras: PlotView[] = plots.map((p) => ({
      id: p.id,
      slot: p.slot,
      isHome: false,
      treeType: p.treeType,
      speciesId: p.speciesId,
      progress: p.progress,
      target: p.target,
      treeStage: p.treeStage,
      treesPlanted: p.treesPlanted,
      treeHealth: this.health(p.lastWateredAt, p.progress, wiltDays, deathDays),
    }));

    const nextSlot = plots.length + 1;
    const nextUnlock =
      nextSlot > maxPlots - 1
        ? null
        : { slot: nextSlot, seedCost: seedBase * nextSlot, xuCost: xuBase * nextSlot };

    return { plots: [home, ...extras], maxPlots, nextUnlock };
  }

  // ── Mở lô phụ kế tiếp ──────────────────────────────
  async unlockPlot(userId: string, currency: UnlockCurrency) {
    const [count, maxPlots, seedBase, xuBase, plotTarget] = await Promise.all([
      this.prisma.gardenPlot.count({ where: { userId } }),
      this.config.get<number>('game.max_plots', 5),
      this.config.get<number>('game.plot_unlock_seed_base', 100),
      this.config.get<number>('game.plot_unlock_xu_base', 200),
      this.config.get<number>('game.plot_target', 600),
    ]);

    const slot = count + 1;
    if (slot > maxPlots - 1) {
      throw new BadRequestException(`Đã mở tối đa ${maxPlots - 1} lô đất.`);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      if (currency === 'XU') {
        if (!this.coins) throw new BadRequestException('Mở lô bằng TubuXu chưa khả dụng.');
        const cost = xuBase * slot;
        await this.coins.spendCoins(userId, cost, `GARDEN_UNLOCK_PLOT:${slot}`, 'GAME', undefined, tx);
      } else {
        const cost = seedBase * slot;
        // Trừ nước ATOMIC (guard gte) — chống mở lô khi không đủ / hai lệnh song song.
        const dec = await tx.gameProfile.updateMany({
          where: { userId, totalSeeds: { gte: cost } },
          data: { totalSeeds: { decrement: cost } },
        });
        if (dec.count === 0) throw new BadRequestException(`Cần ${cost}💧 để mở lô đất này.`);
      }
      return tx.gardenPlot.create({
        data: { userId, slot, treeType: DEFAULT_TREE_TYPE, target: plotTarget },
      });
    });

    return this.toView(created);
  }

  // ── Tưới 1 lô phụ ──────────────────────────────────
  async waterPlot(userId: string, plotId: string, drops: number) {
    if (!Number.isInteger(drops) || drops <= 0) throw new BadRequestException('Số giọt nước không hợp lệ.');
    const plot = await this.prisma.gardenPlot.findFirst({ where: { id: plotId, userId } });
    if (!plot) throw new NotFoundException('Không tìm thấy lô đất.');

    // Trừ nước ATOMIC từ bình chung (GameProfile.totalSeeds).
    const dec = await this.prisma.gameProfile.updateMany({
      where: { userId, totalSeeds: { gte: drops } },
      data: { totalSeeds: { decrement: drops } },
    });
    if (dec.count === 0) throw new BadRequestException('Không đủ giọt nước.');

    const deathDays = await this.config.get<number>('game.death_days', 7);
    const harvestAmount = await this.config.get<number>('game.harvest_coupon_amount', 30000);

    let progress = plot.progress;
    // §6.7.3: lô CHẾT (≥ death_days không tưới, có tiến trình) → reset, trồng lại.
    let revivedFromDead = false;
    if (
      plot.lastWateredAt &&
      progress > 0 &&
      (Date.now() - new Date(plot.lastWateredAt).getTime()) / 864e5 >= deathDays
    ) {
      progress = 0;
      revivedFromDead = true;
    }
    progress += drops;

    let treesPlanted = plot.treesPlanted;
    let harvestCount = 0;
    let couponCode: string | undefined;
    let certificateCode: string | undefined;
    while (progress >= plot.target) {
      progress -= plot.target;
      treesPlanted += 1;
      harvestCount += 1;
      couponCode = await this.grantCoupon(userId, harvestAmount);
      certificateCode = await this.plantTree(userId, plot.treeType);
    }
    const harvested = harvestCount > 0;

    // Phase 3: thu hoạch → sưu tập 1 loài. Lỗi sưu tập không chặn thu hoạch.
    let species: { name: string; emoji: string; rarity: string; ecoFact: string | null } | undefined;
    if (harvested && this.collection) {
      const got = await this.collection.collectOnHarvest(userId).catch(() => null);
      if (got) species = { name: got.name, emoji: got.emoji, rarity: got.rarity, ecoFact: got.ecoFact };
    }

    const stage = Math.min(4, Math.max(1, Math.ceil((progress / plot.target) * 4)));
    await this.prisma.gardenPlot.update({
      where: { id: plot.id },
      data: { progress, treeStage: stage, treesPlanted, lastWateredAt: new Date() },
    });

    // Phase 2: thu hoạch → 💧 đã nuôi cây góp vào hồ cộng đồng. Lỗi góp hồ không chặn thu hoạch.
    if (harvested && this.community) {
      await this.community.contribute(userId, harvestCount * plot.target).catch(() => undefined);
    }

    const reward: {
      coupon?: string;
      certificate?: string;
      species?: { name: string; emoji: string; rarity: string; ecoFact: string | null };
    } = {
      ...(couponCode ? { coupon: couponCode } : {}),
      ...(certificateCode ? { certificate: certificateCode } : {}),
      ...(species ? { species } : {}),
    };
    return { progress, target: plot.target, harvested, treesPlanted, revivedFromDead, reward };
  }

  // ── Helpers ────────────────────────────────────────
  private toView(p: {
    id: string;
    slot: number;
    treeType: string;
    speciesId: string | null;
    progress: number;
    target: number;
    treeStage: number;
    treesPlanted: number;
    lastWateredAt: Date | null;
  }): PlotView {
    return {
      id: p.id,
      slot: p.slot,
      isHome: false,
      treeType: p.treeType,
      speciesId: p.speciesId,
      progress: p.progress,
      target: p.target,
      treeStage: p.treeStage,
      treesPlanted: p.treesPlanted,
      treeHealth: 'HEALTHY',
    };
  }

  private health(lastWateredAt: Date | null, progress: number, wiltDays: number, deathDays: number): TreeHealth {
    if (!lastWateredAt || progress <= 0) return 'HEALTHY';
    const days = (Date.now() - new Date(lastWateredAt).getTime()) / 864e5;
    if (days >= deathDays) return 'DEAD';
    if (days >= wiltDays) return 'WILTED';
    return 'HEALTHY';
  }

  private async grantCoupon(userId: string, amount: number): Promise<string> {
    const code = `GARDEN${amount}-${userId.slice(-5)}-${Math.floor(Math.random() * 9000 + 1000)}`.toUpperCase();
    const end = new Date();
    end.setDate(end.getDate() + 30);
    await this.prisma.coupon.create({
      data: {
        code,
        type: 'AMOUNT',
        value: amount,
        startAt: new Date(),
        endAt: end,
        perUserLimit: 1,
        scope: 'USER_GROUP',
        scopeMeta: { userId } as object,
      },
    });
    return code;
  }

  private async plantTree(userId: string, treeType: string): Promise<string> {
    const certificateCode = `TUBU-${randomUUID().slice(0, 8).toUpperCase()}`;
    await this.prisma.plantedTree.create({ data: { userId, treeType, certificateCode } });
    return certificateCode;
  }

  private eco(json: unknown): EcoImpact {
    const e = (json ?? {}) as Partial<EcoImpact>;
    return {
      progress: e.progress ?? 0,
      target: e.target ?? 600,
      treeType: e.treeType ?? DEFAULT_TREE_TYPE,
      treesPlanted: e.treesPlanted ?? 0,
    };
  }
}
