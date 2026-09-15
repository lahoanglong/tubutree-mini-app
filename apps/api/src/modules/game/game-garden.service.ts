import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { GameCommunityService } from './game-community.service';
import { GameCollectionService } from './game-collection.service';
import { CoinsService } from '../wallet/coins.service';
import { CommunityFeedService } from '../feed/community-feed.service';
import { DEFAULT_TREE_TYPE } from './game.constants';

type TreeHealth = 'HEALTHY' | 'WILTED' | 'DEAD';
type UnlockCurrency = 'SEEDS' | 'XU';
type Db = PrismaService | Prisma.TransactionClient;

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
    @Optional() private readonly feed?: CommunityFeedService,
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

    const deathDays = await this.config.get<number>('game.death_days', 7);
    const harvestAmount = await this.config.get<number>('game.harvest_coupon_amount', 30000);
    // Trần cứng số coupon thu hoạch/ngày — mirror waterTree() ở game.service.ts (P0-1): xu mua
    // nước rẻ hơn nhiều giá trị coupon thu hoạch, không có trần thì vòng mua-nước→tưới→thu-hoạch
    // in coupon vô hạn ở LÔ PHỤ cũng như lô nhà.
    const dailyCap = await this.config.get<number>('game.harvest_coupon_daily_cap', 3);
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    let progress = 0;
    let target = 600;
    let treesPlanted = 0;
    let harvestCount = 0;
    let couponCode: string | undefined;
    let certificateCode: string | undefined;
    let revivedFromDead = false;

    try {
      // ATOMIC + Serializable: đọc lô, đếm trần coupon, trừ nước, cấp thưởng, cập nhật lô đều
      // nằm TRONG CÙNG 1 transaction Serializable (giống waterTree()) — không còn đọc
      // progress/treesPlanted/lastWateredAt NGOÀI tx rồi ghi lại giá trị tuyệt đối: 2 request
      // waterPlot song song (cùng lô, hoặc cùng lúc với waterTree tranh trần) không thể cùng
      // đọc trạng thái cũ rồi cùng ghi đè → double-harvest / lọt trần (Postgres abort 1 bên
      // bằng P2034 nếu đụng nhau thật, bắt bên dưới thay vì nuốt lỗi).
      const result = await this.prisma.$transaction(
        async (db) => {
          const plot = await db.gardenPlot.findFirst({ where: { id: plotId, userId } });
          if (!plot) throw new NotFoundException('Không tìm thấy lô đất.');
          // Guard target hợp lệ: nếu config lỗi để target<=0 thì vòng `while (progress >= target)`
          // dưới đây sẽ lặp vô hạn (treo API + OOM, giữ lock Serializable). Fail-fast thay vì treo.
          if (!Number.isInteger(plot.target) || plot.target <= 0) {
            throw new BadRequestException('Lô đất chưa cấu hình mục tiêu hợp lệ.');
          }

          const dec = await db.gameProfile.updateMany({
            where: { userId, totalSeeds: { gte: drops } },
            data: { totalSeeds: { decrement: drops } },
          });
          if (dec.count === 0) throw new BadRequestException('Không đủ giọt nước.');

          // Đếm TRONG cùng transaction Serializable — DÙNG CHUNG trần với waterTree (lô nhà):
          // cả coupon 'GAME'-prefix lẫn 'GARDEN'-prefix đều tính vào 1 trần/user/ngày, tránh
          // lách trần bằng cách tưới lô nhà + lô phụ song song trong cùng ngày.
          let couponsToday = await db.coupon.count({
            where: {
              OR: [{ code: { startsWith: 'GAME' } }, { code: { startsWith: 'GARDEN' } }],
              scopeMeta: { path: ['userId'], equals: userId },
              startAt: { gte: dayStart },
            },
          });

          let p = plot.progress;
          // §6.7.3: lô CHẾT (≥ death_days không tưới, có tiến trình) → reset, trồng lại.
          let revived = false;
          if (
            plot.lastWateredAt &&
            p > 0 &&
            (Date.now() - new Date(plot.lastWateredAt).getTime()) / 864e5 >= deathDays
          ) {
            p = 0;
            revived = true;
          }
          p += drops;

          let planted = plot.treesPlanted;
          let harvests = 0;
          let coupon: string | undefined;
          let certificate: string | undefined;
          while (p >= plot.target) {
            p -= plot.target;
            planted += 1;
            harvests += 1;
            // Cây thật + chứng nhận KHÔNG bị cap — chỉ coupon (giá trị tiền) mới giới hạn/ngày.
            certificate = await this.plantTree(userId, plot.treeType, db);
            if (couponsToday < dailyCap) {
              coupon = await this.grantCoupon(userId, harvestAmount, db);
              couponsToday += 1;
            }
          }

          const stage = Math.min(4, Math.max(1, Math.ceil((p / plot.target) * 4)));
          await db.gardenPlot.update({
            where: { id: plot.id },
            data: { progress: p, treeStage: stage, treesPlanted: planted, lastWateredAt: new Date() },
          });

          return {
            progress: p,
            target: plot.target,
            treesPlanted: planted,
            harvestCount: harvests,
            couponCode: coupon,
            certificateCode: certificate,
            revivedFromDead: revived,
          };
        },
        { isolationLevel: 'Serializable' },
      );
      progress = result.progress;
      target = result.target;
      treesPlanted = result.treesPlanted;
      harvestCount = result.harvestCount;
      couponCode = result.couponCode;
      certificateCode = result.certificateCode;
      revivedFromDead = result.revivedFromDead;
    } catch (err) {
      // P2034 = Postgres serialization failure (2 request song song đụng trần coupon/tồn kho
      // nước) — không nuốt lỗi: báo rõ để client thử lại, giao dịch đã tự rollback nguyên vẹn.
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2034') {
        throw new BadRequestException('Hệ thống đang bận, vui lòng thử tưới lại.');
      }
      throw err;
    }

    const harvested = harvestCount > 0;

    // Phase 3: thu hoạch → sưu tập 1 loài. Lỗi sưu tập không chặn thu hoạch (ngoài tx, best-effort).
    let species: { name: string; emoji: string; rarity: string; ecoFact: string | null } | undefined;
    if (harvested && this.collection) {
      const got = await this.collection.collectOnHarvest(userId).catch(() => null);
      if (got) species = { name: got.name, emoji: got.emoji, rarity: got.rarity, ecoFact: got.ecoFact };
    }

    // Phase 2: thu hoạch → 💧 đã nuôi cây góp vào hồ cộng đồng. Lỗi góp hồ không chặn thu hoạch.
    if (harvested && this.community) {
      await this.community.contribute(userId, harvestCount * target).catch(() => undefined);
    }

    // §6.14.12: auto-post thành tích lên bảng tin. Lỗi post không chặn thu hoạch.
    if (harvested && this.feed) {
      const body = species
        ? `Vừa thu hoạch cây ở lô đất và sưu tập loài ${species.emoji} ${species.name}! 🌳`
        : `Vừa thu hoạch 1 cây ở lô đất trong Vườn Xanh 🌳`;
      await this.feed
        .createAchievementPost(userId, species ? 'SPECIES' : 'HARVEST', body, { treesPlanted })
        .catch(() => undefined);
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
    return { progress, target, harvested, treesPlanted, revivedFromDead, reward };
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

  /**
   * minOrder = chính giá trị coupon (mirror groupbuy.service.ts grantCoupon + game.service.ts
   * grantCoupon, P0-2): không có ràng buộc này, coupon AMOUNT dùng được trên BẤT KỲ đơn nào
   * (CouponsService.validateAndCompute chỉ trừ min(value, subtotal), không xét sản phẩm).
   */
  private async grantCoupon(userId: string, amount: number, db: Db = this.prisma): Promise<string> {
    const code = `GARDEN${amount}-${userId.slice(-5)}-${Math.floor(Math.random() * 9000 + 1000)}`.toUpperCase();
    const end = new Date();
    end.setDate(end.getDate() + 30);
    await db.coupon.create({
      data: {
        code,
        type: 'AMOUNT',
        value: amount,
        minOrder: amount,
        startAt: new Date(),
        endAt: end,
        perUserLimit: 1,
        scope: 'USER_GROUP',
        scopeMeta: { userId } as object,
      },
    });
    return code;
  }

  private async plantTree(userId: string, treeType: string, db: Db = this.prisma): Promise<string> {
    const certificateCode = `TUBU-${randomUUID().slice(0, 8).toUpperCase()}`;
    await db.plantedTree.create({ data: { userId, treeType, certificateCode } });
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
