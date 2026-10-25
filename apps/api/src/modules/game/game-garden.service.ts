import { BadRequestException, GoneException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { GameCommunityService } from './game-community.service';
import { GameCollectionService } from './game-collection.service';
import { CommunityFeedService } from '../feed/community-feed.service';
import {
  DEFAULT_TREE_TYPE,
  GARDEN_COUPON_PREFIX,
  HARVEST_COUPON_CODE_PREFIXES,
  HARVEST_COUPON_DAILY_CAP_DEFAULT,
  HARVEST_COUPON_MONTHLY_CAP_DEFAULT,
  configInt,
  harvestCouponMinOrder,
  ladderTarget,
  treeTargetLadder,
} from './game.constants';
import { isRealUser } from '../../common/real-user';
import { startOfVnDay, startOfVnMonth } from '../../common/vn-time';

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
  sproutRewarded?: boolean;
}

/**
 * Vườn Xanh 2.0 — Lô đất / mở rộng vườn (§6.7 "lô đất").
 * Hệ thống ADDITIVE: lô nhà (slot 0) vẫn là cây trong GameProfile (không đụng tới),
 * user mở thêm lô phụ bằng 💧 — mỗi lô là 1 cây độc lập tưới & thu hoạch.
 * Thu hoạch lô phụ tái dùng sưu tập loài (Phase 3) + góp hồ cộng đồng (Phase 2).
 */
@Injectable()
export class GameGardenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    @Optional() private readonly community?: GameCommunityService,
    @Optional() private readonly collection?: GameCollectionService,
    @Optional() private readonly feed?: CommunityFeedService,
  ) {}

  // ── Đọc vườn (lô nhà + lô phụ) ─────────────────────
  async getGarden(userId: string) {
    const [profile, plots, maxPlots, seedBase, wiltDays, ladder] = await Promise.all([
      this.prisma.gameProfile.findUnique({ where: { userId } }),
      this.prisma.gardenPlot.findMany({ where: { userId }, orderBy: { slot: 'asc' } }),
      this.config.get<number>('game.max_plots', 5),
      this.config.get<number>('game.plot_unlock_seed_base', 100),
      this.config.get<number>('game.wilt_days', 3),
      treeTargetLadder(this.config),
    ]);

    const homeEco = this.eco(profile?.ecoImpact, ladder);
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
      treeHealth: this.health(profile?.lastWateredAt ?? null, homeEco.progress, wiltDays),
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
      treeHealth: this.health(p.lastWateredAt, p.progress, wiltDays),
    }));

    const nextSlot = plots.length + 1;
    const nextUnlock =
      nextSlot > maxPlots - 1
        ? null
        : { slot: nextSlot, seedCost: seedBase * nextSlot };

    return { plots: [home, ...extras], maxPlots, nextUnlock };
  }

  // ── Mở lô phụ kế tiếp ──────────────────────────────
  async unlockPlot(userId: string, currency: UnlockCurrency, requestedSlot?: number) {
    // PD-3 (spec 6.3, OQ-4): xu đã gộp vào Điểm Xanh; 200 xu/lô quy ra 0,2 điểm không biểu diễn được và
    // giọt nước đã là tiền game. Giữ giá trị 'XU' ở DTO để client cũ nhận 410 đọc được, không phải 400.
    if (currency === 'XU') {
      throw new GoneException('Mở lô đất bằng xu đã ngừng. Hãy dùng giọt nước để mở lô mới.');
    }
    const [count, maxPlots, seedBase, plotTarget] = await Promise.all([
      this.prisma.gardenPlot.count({ where: { userId } }),
      this.config.get<number>('game.max_plots', 5),
      this.config.get<number>('game.plot_unlock_seed_base', 100),
      this.config.get<number>('game.plot_target', 600),
    ]);

    // Có slot từ client: đếm ngoài tx không đủ để biết lệnh này là bấm đúp hay mở ô kế tiếp, nên so với ô khách định mở.
    if (requestedSlot !== undefined) {
      const already = await this.prisma.gardenPlot.findUnique({ where: { userId_slot: { userId, slot: requestedSlot } } });
      if (already) return this.toView(already);
      if (requestedSlot !== count + 1) {
        throw new BadRequestException('Danh sách lô đất đã thay đổi, hãy tải lại trang.');
      }
    }

    const slot = requestedSlot ?? count + 1;
    if (slot > maxPlots - 1) {
      throw new BadRequestException(`Đã mở tối đa ${maxPlots - 1} lô đất.`);
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const cost = seedBase * slot;
        // Trừ nước ATOMIC (guard gte) — chống mở lô khi không đủ / hai lệnh song song.
        const dec = await tx.gameProfile.updateMany({
          where: { userId, totalSeeds: { gte: cost } },
          data: { totalSeeds: { decrement: cost } },
        });
        if (dec.count === 0) throw new BadRequestException(`Cần ${cost}💧 để mở lô đất này.`);
        return tx.gardenPlot.create({
          data: { userId, slot, treeType: DEFAULT_TREE_TYPE, target: plotTarget },
        });
      });
      return this.toView(created);
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      // Bấm đúp / mạng chậm: lệnh song song đã mở đúng ô này. Giao dịch của lần thua đã rollback nên 💧 chỉ bị trừ một
      // lần; trả ô đã mở (idempotent) thay vì báo lỗi ràng buộc duy nhất cho một thao tác đã thành công.
      const existing = await this.prisma.gardenPlot.findUnique({ where: { userId_slot: { userId, slot } } });
      if (!existing) throw err;
      return this.toView(existing);
    }
  }

  // ── Tưới 1 lô phụ ──────────────────────────────────
  async waterPlot(userId: string, plotId: string, drops: number) {
    if (!Number.isInteger(drops) || drops <= 0) throw new BadRequestException('Số giọt nước không hợp lệ.');

    const harvestAmount = await this.config.get<number>('game.harvest_coupon_amount', 30000);
    const harvestMinOrder = await harvestCouponMinOrder(this.config, harvestAmount);
    // Trần cứng số coupon thu hoạch/ngày — mirror waterTree() ở game.service.ts (P0-1): nước rẻ hơn
    // nhiều giá trị coupon thu hoạch, không có trần thì vòng kiếm-nước→tưới→thu-hoạch in coupon vô hạn
    // ở LÔ PHỤ cũng như lô nhà.
    const dailyCap = await configInt(this.config, 'game.harvest_coupon_daily_cap', HARVEST_COUPON_DAILY_CAP_DEFAULT);
    const monthlyCap = await configInt(this.config, 'game.harvest_coupon_monthly_cap', HARVEST_COUPON_MONTHLY_CAP_DEFAULT);
    const dayStart = startOfVnDay();
    const monthStart = startOfVnMonth();

    let progress = 0;
    let target = 600;
    let treesPlanted = 0;
    let harvestCount = 0;
    let couponCodes: string[] = [];
    let certificateCode: string | undefined;
    let couponCapped: 'DAY' | 'MONTH' | undefined;
    let rewardBlocked: 'GUEST' | undefined;

    // Chỉ khách thật nhận mã thu hoạch (guest_ tạo vô hạn bằng deviceId). Đọc ngoài tx như các cấu hình khác.
    const owner = await this.prisma.user.findUnique({ where: { id: userId }, select: { zaloId: true, phone: true } });
    const realUser = isRealUser(owner);

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
          // cả mã thu hoạch lô nhà (HARVEST) lẫn lô phụ (GARDEN) đều tính vào 1 trần/user/ngày, tránh
          // lách trần bằng cách tưới lô nhà + lô phụ song song trong cùng ngày.
          const harvestCouponWhere = {
            OR: HARVEST_COUPON_CODE_PREFIXES.map((prefix) => ({ code: { startsWith: prefix } })),
            scopeMeta: { path: ['userId'], equals: userId },
          };
          let couponsToday = await db.coupon.count({ where: { ...harvestCouponWhere, startAt: { gte: dayStart } } });
          let couponsMonth = await db.coupon.count({ where: { ...harvestCouponWhere, startAt: { gte: monthStart } } });

          // Lô bỏ lâu chỉ héo, không mất tiến độ.
          let p = plot.progress;
          p += drops;

          let planted = plot.treesPlanted;
          let harvests = 0;
          const coupons: string[] = [];
          let blocked: 'GUEST' | undefined;
          let certificate: string | undefined;
          let capped: 'DAY' | 'MONTH' | undefined;
          while (p >= plot.target) {
            p -= plot.target;
            planted += 1;
            harvests += 1;
            // Khoản góp quỹ trồng cây + mã ghi nhận KHÔNG bị cap — chỉ coupon (giá trị tiền) mới giới hạn/ngày.
            certificate = await this.plantTree(userId, plot.treeType, db);
            if (!realUser) {
              blocked = 'GUEST';
            } else if (couponsMonth >= monthlyCap) {
              capped = 'MONTH';
            } else if (couponsToday >= dailyCap) {
              capped = 'DAY';
            } else {
              coupons.push(await this.grantCoupon(userId, harvestAmount, harvestMinOrder, db));
              couponsToday += 1;
              couponsMonth += 1;
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
            couponCodes: coupons,
            blocked,
            certificateCode: certificate,
            capped,
          };
        },
        { isolationLevel: 'Serializable' },
      );
      progress = result.progress;
      target = result.target;
      treesPlanted = result.treesPlanted;
      harvestCount = result.harvestCount;
      couponCodes = result.couponCodes;
      rewardBlocked = result.blocked;
      certificateCode = result.certificateCode;
      couponCapped = result.capped;
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

    const reward: {
      coupon?: string;
      coupons?: string[];
      certificate?: string;
      species?: { name: string; emoji: string; rarity: string; ecoFact: string | null };
    } = {
      ...(couponCodes.length > 0 ? { coupon: couponCodes[0], coupons: couponCodes } : {}),
      ...(certificateCode ? { certificate: certificateCode } : {}),
      ...(species ? { species } : {}),
    };
    return {
      progress,
      target,
      harvested,
      treesPlanted,
      revivedFromDead: false, ...(couponCapped ? { couponCapped } : {}),
      ...(rewardBlocked ? { rewardBlocked } : {}),
      reward,
    };
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

  private health(lastWateredAt: Date | null, progress: number, wiltDays: number): TreeHealth {
    if (!lastWateredAt || progress <= 0) return 'HEALTHY';
    const days = (Date.now() - new Date(lastWateredAt).getTime()) / 864e5;
    if (days >= wiltDays) return 'WILTED';
    return 'HEALTHY';
  }

  /**
   * minOrder không bao giờ thấp hơn giá trị coupon (mirror groupbuy.service.ts grantCoupon, P0-2):
   * không có ràng buộc này, coupon AMOUNT dùng được trên BẤT KỲ đơn nào
   * (CouponsService.validateAndCompute chỉ trừ min(value, subtotal), không xét sản phẩm).
   */
  private async grantCoupon(userId: string, amount: number, minOrder: number, db: Db = this.prisma): Promise<string> {
    const code = `${GARDEN_COUPON_PREFIX}${amount}-${userId.slice(-5)}-${Math.floor(Math.random() * 9000 + 1000)}`.toUpperCase();
    const end = new Date();
    end.setDate(end.getDate() + 30);
    await db.coupon.create({
      data: {
        code,
        type: 'AMOUNT',
        value: amount,
        minOrder: Math.max(amount, minOrder),
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

  private eco(json: unknown, ladder: readonly number[]): EcoImpact {
    const e = (json ?? {}) as Partial<EcoImpact>;
    const treesPlanted = e.treesPlanted ?? 0;
    const progress = e.progress ?? 0;
    let target = e.target ?? ladderTarget(ladder, treesPlanted);
    if (treesPlanted === 0 && e.sproutRewarded !== true) target = Math.min(target, ladderTarget(ladder, 0));
    return { progress, target, treeType: e.treeType ?? DEFAULT_TREE_TYPE, treesPlanted };
  }
}
