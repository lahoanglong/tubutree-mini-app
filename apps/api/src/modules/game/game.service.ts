import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { GameCommunityService } from './game-community.service';
import { GameCollectionService } from './game-collection.service';
import { CoinsService } from '../wallet/coins.service';
import { CommunityFeedService } from '../feed/community-feed.service';
import { DEFAULT_TREE_TYPE } from './game.constants';

interface SpinPrize {
  id: string;
  name: string;
  weight: number;
  rewardType: 'POINTS' | 'COUPON' | 'SEEDS' | 'NONE';
  value: number;
}

interface EcoImpact {
  progress: number;
  target: number;
  treeType: string;
  treesPlanted: number;
}

/** Vườn Xanh Tubu (Build Spec §6.7). Tham số đọc từ SystemConfig. */
@Injectable()
export class GameService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    // Optional: hồ cộng đồng Phase 2. Tests dựng GameService 2 tham số → bỏ qua góp hồ.
    @Optional() private readonly community?: GameCommunityService,
    // Optional: sổ tay loài Phase 3. Thu hoạch → sưu tập 1 loài.
    @Optional() private readonly collection?: GameCollectionService,
    // Optional: ví TubuXu — mua nước/cây bằng xu. Tests dựng GameService không cần coins thì bỏ qua.
    @Optional() private readonly coins?: CoinsService,
    // Optional: bảng tin cộng đồng §6.14.12 — auto-post thành tích khi thu hoạch.
    @Optional() private readonly feed?: CommunityFeedService,
  ) {}

  // ── Profile ────────────────────────────────────────
  async ensureProfile(userId: string) {
    const target = await this.config.get<number>('game.tree_default_target', 600);
    const existing = await this.prisma.gameProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.gameProfile.create({
      data: {
        userId,
        ecoImpact: { progress: 0, target, treeType: DEFAULT_TREE_TYPE, treesPlanted: 0 } as object,
      },
    });
  }

  async getProfile(userId: string) {
    const profile = await this.ensureProfile(userId);
    const wiltDays = await this.config.get<number>('game.wilt_days', 3);
    const deathDays = await this.config.get<number>('game.death_days', 7);
    const streakRepairCost = await this.config.get<number>('game.streak_repair_cost', 150);
    const windowH = await this.config.get<number>('game.streak_repair_window_hours', 48);
    const cooldownD = await this.config.get<number>('game.streak_repair_cooldown_days', 30);
    // Giá các món tiêu xu — FE trước đây chép cứng (80💧 đóng băng chuỗi, 1 xu/giọt, 50.000 xu
    // một cây): admin đổi config thì nhãn trên nút vẫn hiện giá cũ, bấm xong mới biết trừ khác.
    const [streakFreezeCost, xuPerSeed, treeXuPrice, tankCapacity] = await Promise.all([
      this.config.get<number>('game.streak_freeze_cost', 80),
      this.config.get<number>('game.xu_per_seed', 1),
      this.config.get<number>('game.tree_xu_price', 50000),
      this.config.get<number>('game.tank_capacity', 500),
    ]);
    const streakRepairable =
      !!profile.brokenStreakAt &&
      profile.brokenStreakDays > 0 &&
      Date.now() - new Date(profile.brokenStreakAt).getTime() <= windowH * 3600 * 1000 &&
      (!profile.lastStreakRepairAt || Date.now() - new Date(profile.lastStreakRepairAt).getTime() >= cooldownD * 86400 * 1000);
    return {
      ...profile,
      treeHealth: this.treeHealth(profile, wiltDays, deathDays),
      brokenStreakDays: profile.brokenStreakDays,
      streakRepairCost,
      streakRepairable,
      streakFreezeCost,
      xuPerSeed,
      treeXuPrice,
      tankCapacity,
    };
  }

  /** §6.7.3: trạng thái cây theo số ngày không tưới (chỉ tính khi đã có tiến trình). */
  private treeHealth(
    profile: { lastWateredAt: Date | null; ecoImpact: unknown },
    wiltDays: number,
    deathDays: number,
  ): 'HEALTHY' | 'WILTED' | 'DEAD' {
    if (!profile.lastWateredAt || this.eco(profile.ecoImpact).progress <= 0) return 'HEALTHY';
    const days = (Date.now() - new Date(profile.lastWateredAt).getTime()) / 864e5;
    if (days >= deathDays) return 'DEAD';
    if (days >= wiltDays) return 'WILTED';
    return 'HEALTHY';
  }

  // ── Spin wheel ─────────────────────────────────────
  async spin(userId: string) {
    const cost = await this.config.get<number>('game.spin_buy_cost_points', 10);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.pointsBalance < cost) {
      throw new BadRequestException(`Cần ${cost} điểm Xanh để quay.`);
    }
    const prizes = await this.config.get<SpinPrize[]>('game.spin_prizes', []);
    if (prizes.length === 0) throw new BadRequestException('Vòng quay chưa cấu hình.');

    const prize = this.pickWeighted(prizes);

    return this.prisma.$transaction(async (tx) => {
      // Trừ điểm ATOMIC (gte) trong transaction — chống quay đồng thời làm âm điểm (TOCTOU).
      const dec = await tx.user.updateMany({
        where: { id: userId, pointsBalance: { gte: cost } },
        data: { pointsBalance: { decrement: cost } },
      });
      if (dec.count === 0) throw new BadRequestException(`Cần ${cost} điểm Xanh để quay.`);
      await tx.pointsTransaction.create({
        data: { userId, delta: -cost, reason: 'GAME_SPIN_COST', refType: 'GAME' },
      });

      let rewardRefId: string | null = null;
      if (prize.rewardType === 'POINTS') {
        await this.creditPoints(userId, prize.value, `GAME_SPIN_WIN:${prize.id}`, tx);
      } else if (prize.rewardType === 'SEEDS') {
        // Mặc định khớp với các call site khác (buySeeds/checkIn/collectDew/quiz/gift) và giá
        // trị SystemConfig thật (500) — tránh clamp sai xuống 200 khi config bị thiếu.
        const tankCap = await this.config.get<number>('game.tank_capacity', 500);
        // Cộng totalSeeds ATOMIC bằng increment + guard cap (updateMany) trong CÙNG tx — chống
        // lost-update khi trúng SEEDS đồng thời với spin/checkin/quiz/gift khác đang đổi
        // totalSeeds (pattern cũ đọc-rồi-ghi-tuyệt-đối sẽ đè mất phần cộng của thao tác kia).
        await tx.gameProfile.update({
          where: { userId },
          data: { totalSeeds: { increment: prize.value } },
        });
        await tx.gameProfile.updateMany({
          where: { userId, totalSeeds: { gt: tankCap } },
          data: { totalSeeds: tankCap },
        });
      } else if (prize.rewardType === 'COUPON') {
        rewardRefId = await this.grantCoupon(userId, prize.value, tx);
      }

      await tx.gameSpin.create({
        data: {
          userId,
          prizeId: prize.id,
          prizeName: prize.name,
          prizeValue: prize.value,
          rewardType: prize.rewardType,
          rewardRefId,
        },
      });

      return { prize: { id: prize.id, name: prize.name, rewardType: prize.rewardType, value: prize.value } };
    });
  }

  // ── Tree water + harvest ───────────────────────────
  async waterTree(userId: string, drops: number) {
    if (drops <= 0) throw new BadRequestException('Số giọt nước không hợp lệ.');

    const harvestAmount = await this.config.get<number>('game.harvest_coupon_amount', 30000);
    const deathDays = await this.config.get<number>('game.death_days', 7);
    // Trần cứng số coupon thu hoạch/ngày — ĐỘC LẬP với giá xu/giọt nước trong config.
    // Xu mua nước (mặc định 1 xu/giọt ≈ 0,83đ quy đổi) rẻ hơn nhiều lần giá trị coupon
    // (mặc định 30.000đ): không có trần thì vòng mua-nước→tưới→thu-hoạch in coupon vô hạn
    // (P0-1, docs/2026-09-08-review-progress.md). Đặt trần bằng CODE thay vì chỉ dựa vào
    // admin cấu hình đúng giá — admin sửa nhầm config không được vô tình tắt lưới an toàn.
    const dailyCap = await this.config.get<number>('game.harvest_coupon_daily_cap', 3);
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    let harvestCount = 0;
    let couponCode: string | undefined;
    let certificateCode: string | undefined;
    let revivedFromDead = false;
    let eco: EcoImpact = { progress: 0, target: 600, treeType: DEFAULT_TREE_TYPE, treesPlanted: 0 };

    try {
      await this.prisma.$transaction(
        async (tx) => {
          const profile = await tx.gameProfile.findUnique({ where: { userId } });
          if (!profile || profile.totalSeeds < drops) {
            throw new BadRequestException('Không đủ giọt nước.');
          }

          // Đếm TRONG cùng transaction Serializable (không phải this.prisma ngoài tx) — 2 request
          // waterTree song song của CÙNG user đọc couponsToday trước khi bên kia commit sẽ khiến
          // Postgres abort 1 bên (P2034, bắt bên dưới) thay vì cả hai cùng lọt qua trần.
          // Coupon không có createdAt — grantCoupon() luôn set startAt=new Date() lúc cấp
          // (game.service.ts grantCoupon), nên startAt chính là mốc "được cấp lúc nào" cho
          // đúng loại coupon GAME*/GARDEN* này.
          // DÙNG CHUNG trần với waterPlot (lô phụ, game-garden.service.ts): đếm cả coupon
          // 'GAME'-prefix (lô nhà) lẫn 'GARDEN'-prefix (lô phụ) trong CÙNG 1 trần/user/ngày —
          // nếu không, user có thể lách trần bằng cách tưới lô nhà + lô phụ song song.
          let couponsToday = await tx.coupon.count({
            where: {
              OR: [{ code: { startsWith: 'GAME' } }, { code: { startsWith: 'GARDEN' } }],
              scopeMeta: { path: ['userId'], equals: userId },
              startAt: { gte: dayStart },
            },
          });

          eco = this.eco(profile.ecoImpact);

          // §6.7.3: cây CHẾT (≥ death_days không tưới) → mất tiến trình, trồng lại từ đầu.
          if (
            profile.lastWateredAt &&
            eco.progress > 0 &&
            (Date.now() - new Date(profile.lastWateredAt).getTime()) / 864e5 >= deathDays
          ) {
            eco.progress = 0;
            revivedFromDead = true;
          }
          eco.progress += drops;

          // Chặn target<=0 (config game.tree_default_target sai, hoặc dữ liệu cũ hỏng) TRƯỚC
          // vòng lặp thu hoạch — nếu không, while (progress>=target) không bao giờ thoát, giữ
          // lock trong transaction Serializable tới khi pool timeout (P2-4, mirror guard đã có
          // ở game-garden.service.ts).
          if (!Number.isInteger(eco.target) || eco.target <= 0) {
            throw new BadRequestException('Cây chưa cấu hình mục tiêu hợp lệ.');
          }

          // Thu hoạch khi đủ target; phần dư được CARRY-OVER sang cây mới (không mất nước).
          while (eco.progress >= eco.target) {
            eco.progress -= eco.target;
            eco.treesPlanted += 1;
            harvestCount += 1;
            // Cây thật + chứng nhận KHÔNG bị cap — chỉ coupon (giá trị tiền) mới giới hạn/ngày.
            certificateCode = await this.plantTree(userId, eco.treeType, tx);
            if (couponsToday < dailyCap) {
              couponCode = await this.grantCoupon(userId, harvestAmount, tx);
              couponsToday += 1;
            }
          }

          const stage = Math.min(4, Math.max(1, Math.ceil((eco.progress / eco.target) * 4)));

          const dec = await tx.gameProfile.updateMany({
            where: { userId, totalSeeds: { gte: drops } },
            data: {
              totalSeeds: { decrement: drops },
              treeStage: stage,
              ecoImpact: eco as object,
              lastWateredAt: new Date(),
            },
          });
          if (dec.count === 0) {
            throw new BadRequestException('Không đủ giọt nước.');
          }
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      // P2034 = Postgres serialization failure (2 request song song đụng trần coupon/tồn kho
      // nước) — KHÔNG nuốt lỗi như rewardWithDailyCap (đó là bonus best-effort, còn ở đây nước/
      // xu là tài nguyên thật): báo lỗi rõ để client thử lại, giao dịch đã tự rollback nguyên vẹn.
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2034') {
        throw new BadRequestException('Hệ thống đang bận, vui lòng thử tưới lại.');
      }
      throw err;
    }

    const harvested = harvestCount > 0;

    // Phase 3: thu hoạch → sưu tập 1 loài (weighted theo rarity). Lấy loài cuối để hiện.
    let species: { name: string; emoji: string; rarity: string; ecoFact: string | null } | undefined;
    if (harvested && this.collection) {
      const got = await this.collection.collectOnHarvest(userId).catch(() => null);
      if (got) species = { name: got.name, emoji: got.emoji, rarity: got.rarity, ecoFact: got.ecoFact };
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

    // Phase 2: thu hoạch → 💧 đã nuôi cây góp vào hồ cộng đồng (Ant Forest gom batch).
    // Lỗi góp hồ không được chặn thu hoạch của user.
    if (harvested && this.community) {
      await this.community.contribute(userId, harvestCount * eco.target).catch(() => undefined);
    }

    // §6.14.12: auto-post thành tích lên bảng tin. Lỗi post không chặn thu hoạch.
    if (harvested && this.feed) {
      const body = species
        ? `Vừa thu hoạch cây và sưu tập loài ${species.emoji} ${species.name}! 🌳`
        : `Vừa thu hoạch 1 cây trong Vườn Xanh 🌳`;
      await this.feed
        .createAchievementPost(userId, species ? 'SPECIES' : 'HARVEST', body, { treesPlanted: eco.treesPlanted })
        .catch(() => undefined);
    }
    return {
      progress: eco.progress,
      target: eco.target,
      harvested,
      treesPlanted: eco.treesPlanted,
      revivedFromDead,
      reward,
    };
  }

  /** Tạo bản ghi cây thật đã cam kết + mã chứng nhận. Trả mã. */
  private async plantTree(userId: string, treeType: string, tx?: Prisma.TransactionClient): Promise<string> {
    const certificateCode = `TUBU-${randomUUID().slice(0, 8).toUpperCase()}`;
    const db = tx ?? this.prisma;
    await db.plantedTree.create({ data: { userId, treeType, certificateCode } });
    return certificateCode;
  }

  // ── Mua bằng TubuXu (sink tiêu xu) ─────────────────
  /** Mua nước (giọt) bằng TubuXu. Trừ xu + cộng totalSeeds ATOMIC, không vượt sức chứa bình. */
  async buySeeds(userId: string, seeds: number) {
    if (!this.coins) throw new BadRequestException('Tính năng mua nước chưa khả dụng.');
    if (!Number.isInteger(seeds) || seeds <= 0) throw new BadRequestException('Số giọt nước không hợp lệ.');
    const xuPerSeed = await this.config.get<number>('game.xu_per_seed', 1);
    const cap = await this.config.get<number>('game.tank_capacity', 500);
    const cost = seeds * xuPerSeed;

    const profile = await this.ensureProfile(userId);
    const newTotal = profile.totalSeeds + seeds;
    // Check sớm (UX, fail-fast trước khi trừ xu); guard THẬT là updateMany atomic bên dưới.
    if (newTotal > cap) {
      throw new BadRequestException(`Bình chứa tối đa ${cap}💧 — không thể mua thêm ${seeds}💧.`);
    }
    await this.prisma.$transaction(async (tx) => {
      await this.coins!.spendCoins(userId, cost, 'GAME_BUY_SEEDS', 'GAME', undefined, tx);
      // Cộng totalSeeds ATOMIC bằng increment + guard cap trong CÙNG tx — chống lost-update khi
      // 2 lệnh mua song song (set giá trị tuyệt đối đọc-ngoài-tx sẽ ghi đè nhau → mất xu/quá cap).
      // count=0 = đã đầy bình do lệnh khác → throw rollback (hoàn lại xu vừa spendCoins).
      const inc = await tx.gameProfile.updateMany({
        where: { userId, totalSeeds: { lte: cap - seeds } },
        data: { totalSeeds: { increment: seeds } },
      });
      if (inc.count === 0) {
        throw new BadRequestException(`Bình chứa tối đa ${cap}💧 — không thể mua thêm ${seeds}💧.`);
      }
    });
    return { seeds, cost, totalSeeds: newTotal };
  }

  /** Mua 1 cây THẬT (PlantedTree, cam kết trồng qua PanNature) bằng TubuXu. */
  async buyTree(userId: string) {
    if (!this.coins) throw new BadRequestException('Tính năng mua cây chưa khả dụng.');
    const price = await this.config.get<number>('game.tree_xu_price', 50000);
    const certificateCode = `TUBU-${randomUUID().slice(0, 8).toUpperCase()}`;
    await this.prisma.$transaction(async (tx) => {
      await this.coins!.spendCoins(userId, price, `GAME_BUY_TREE:${certificateCode}`, 'GAME', undefined, tx);
      await tx.plantedTree.create({ data: { userId, treeType: DEFAULT_TREE_TYPE, certificateCode } });
    });
    return { certificateCode, treeType: DEFAULT_TREE_TYPE, cost: price };
  }

  /** "Khu rừng của tôi" — danh sách cây thật đã cam kết + chứng nhận (§6.7.7). */
  async getForest(userId: string) {
    const trees = await this.prisma.plantedTree.findMany({
      where: { userId },
      orderBy: { pledgedAt: 'desc' },
      take: 200,
    });
    return {
      count: trees.length,
      plantedCount: trees.filter((t) => t.status === 'PLANTED').length,
      trees: trees.map((t) => ({
        certificateCode: t.certificateCode,
        treeType: t.treeType,
        status: t.status,
        region: t.region,
        pledgedAt: t.pledgedAt,
        plantedAt: t.plantedAt,
      })),
    };
  }

  // ── Missions & leaderboard ─────────────────────────
  async getMissions(userId: string) {
    const [missions, profile, ordersCount, reviewsCount, referralsCount] = await Promise.all([
      this.prisma.mission.findMany(),
      this.prisma.gameProfile.findUnique({ where: { userId } }),
      this.prisma.order.count({
        where: { userId, status: { in: ['DELIVERED', 'CONFIRMED', 'SHIPPING', 'PACKED'] } },
      }),
      this.prisma.review.count({
        where: { userId },
      }),
      this.prisma.user.count({
        where: { referredById: userId },
      }),
    ]);

    const streakDays = profile?.streakDays ?? 0;

    return missions.map((m) => {
      let currentProgress = 0;
      const targetGoal = m.goal > 0 ? m.goal : 1;

      switch (m.code) {
        case 'CHECKIN_7':
          currentProgress = Math.min(targetGoal, streakDays);
          break;
        case 'FIRST_ORDER':
          currentProgress = Math.min(targetGoal, ordersCount);
          break;
        case 'REVIEW_3':
          currentProgress = Math.min(targetGoal, reviewsCount);
          break;
        case 'INVITE_3':
          currentProgress = Math.min(targetGoal, referralsCount);
          break;
        default:
          currentProgress = 0;
          break;
      }

      return {
        code: m.code,
        title: m.title,
        description: m.description,
        rewardPoints: m.rewardPoints,
        progress: currentProgress,
        goal: targetGoal,
        completed: currentProgress >= targetGoal,
      };
    });
  }

  async getLeaderboard() {
    const top = await this.prisma.gameProfile.findMany({
      orderBy: [{ longestStreak: 'desc' }, { totalSeeds: 'desc' }],
      take: 10,
      include: { user: { select: { fullName: true } } },
    });
    return top.map((p, i) => ({
      rank: i + 1,
      nickname: this.maskName(p.user.fullName),
      streak: p.longestStreak,
      treesPlanted: this.eco(p.ecoImpact).treesPlanted,
    }));
  }

  // ── Helpers ────────────────────────────────────────
  private async creditPoints(userId: string, delta: number, reason: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    if (delta < 0) {
      const abs = Math.abs(delta);
      const dec = await db.user.updateMany({
        where: { id: userId, pointsBalance: { gte: abs } },
        data: { pointsBalance: { decrement: abs } },
      });
      if (dec.count === 0) throw new BadRequestException('Số điểm Xanh không đủ.');
      await db.pointsTransaction.create({ data: { userId, delta, reason, refType: 'GAME' } });
    } else {
      await db.pointsTransaction.create({ data: { userId, delta, reason, refType: 'GAME' } });
      await db.user.update({ where: { id: userId }, data: { pointsBalance: { increment: delta } } });
    }
  }

  /**
   * Tạo coupon cá nhân AMOUNT cho user (thưởng game). Trả về code.
   * minOrder = chính giá trị coupon (mirror groupbuy.service.ts grantCoupon, P0-2): không có
   * ràng buộc này, coupon AMOUNT không có product/minOrder restriction dùng được trên BẤT KỲ
   * đơn nào (CouponsService.validateAndCompute chỉ trừ min(value, subtotal), không xét sản
   * phẩm) — thu hoạch xong là có "tiền free" tiêu ở đơn bất kỳ, không cần đơn thật tương xứng.
   */
  private async grantCoupon(userId: string, amount: number, tx?: Prisma.TransactionClient): Promise<string> {
    const code = `GAME${amount}-${userId.slice(-5)}-${Math.floor(Math.random() * 9000 + 1000)}`.toUpperCase();
    const end = new Date();
    end.setDate(end.getDate() + 30);
    const db = tx ?? this.prisma;
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

  private pickWeighted(prizes: SpinPrize[]): SpinPrize {
    const total = prizes.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    for (const p of prizes) {
      r -= p.weight;
      if (r <= 0) return p;
    }
    return prizes[prizes.length - 1]!;
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

  private maskName(name: string | null): string {
    if (!name) return 'Bạn Tubu';
    const parts = name.trim().split(' ');
    const last = parts[parts.length - 1] ?? 'Tubu';
    return `${last}***`;
  }

  private dayKey(d: Date): string {
    const utc7 = new Date(d.getTime() + 7 * 3600 * 1000);
    return utc7.toISOString().slice(0, 10);
  }
  private startOfDay(d: Date): Date {
    const utc7 = new Date(d.getTime() + 7 * 3600 * 1000);
    utc7.setUTCHours(0, 0, 0, 0);
    return new Date(utc7.getTime() - 7 * 3600 * 1000);
  }
}
