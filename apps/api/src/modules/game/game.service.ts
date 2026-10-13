import { BadRequestException, GoneException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { spinPrizeProblem } from '../system-config/spin-prizes';
import { GameCommunityService } from './game-community.service';
import { GameCollectionService } from './game-collection.service';
import { applyPointsDelta } from '../loyalty/points-ledger';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { CommunityFeedService } from '../feed/community-feed.service';
import { DEFAULT_TREE_TYPE, harvestCouponMinOrder } from './game.constants';
import { ensureGameProfile } from './game-profile';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
import { startOfVnDay } from '../../common/vn-time';
import { maskName } from '../../common/mask-name';
import { parseTreeBuyKey, treeCertificateCodeFor } from './tree-purchase-key';

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
  private readonly logger = new Logger(GameService.name);
  /** Giải hỏng đã cảnh báo (id + lý do), để một cấu hình hỏng không log ở mỗi lượt quay. */
  private readonly warnedPrizes = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly analytics: AnalyticsEventsService,
    // Optional: hồ cộng đồng Phase 2. Tests dựng GameService 2 tham số → bỏ qua góp hồ.
    @Optional() private readonly community?: GameCommunityService,
    // Optional: sổ tay loài Phase 3. Thu hoạch → sưu tập 1 loài.
    @Optional() private readonly collection?: GameCollectionService,
    // Optional: bảng tin cộng đồng §6.14.12 — auto-post thành tích khi thu hoạch.
    @Optional() private readonly feed?: CommunityFeedService,
    // Optional như các dịch vụ trên để test dựng GameService ít tham số; riêng spin và buyTree (hai chỗ tiêu Điểm Xanh
    // thường của khách) BẮT BUỘC có để đọc điểm đang khoá.
    @Optional() private readonly loyalty?: LoyaltyService,
  ) {}

  // ── Profile ────────────────────────────────────────
  async ensureProfile(userId: string) {
    return ensureGameProfile(this.prisma, this.config, userId);
  }

  async getProfile(userId: string) {
    const profile = await this.ensureProfile(userId);
    const wiltDays = await this.config.get<number>('game.wilt_days', 3);
    const deathDays = await this.config.get<number>('game.death_days', 7);
    const streakRepairCost = await this.config.get<number>('game.streak_repair_cost', 150);
    const windowH = await this.config.get<number>('game.streak_repair_window_hours', 48);
    const cooldownD = await this.config.get<number>('game.streak_repair_cooldown_days', 30);
    // Giá các món — FE trước đây chép cứng (80💧 đóng băng chuỗi, giá góp quỹ trồng cây): admin đổi
    // config thì nhãn trên nút vẫn hiện giá cũ, bấm xong mới biết trừ khác.
    const [streakFreezeCost, treePointsPrice, tankCapacity, spinCostPoints] = await Promise.all([
      this.config.get<number>('game.streak_freeze_cost', 80),
      this.config.get<number>('game.tree_points_price', 50),
      this.config.get<number>('game.tank_capacity', 500),
      this.config.get<number>('game.spin_buy_cost_points', 10),
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
      treePointsPrice,
      tankCapacity,
      spinCostPoints,
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
  /**
   * Quay bằng Điểm Xanh thường (lô STANDARD; lô quy đổi không vào vòng quay, PD-3 OQ-3). Chỉ tiêu phần DÙNG ĐƯỢC
   * (số dư − lockedOrderPoints, cùng luật checkout/đổi voucher/góp quỹ): điểm đơn vừa giao còn trong hạn đổi/trả mà
   * bị quay hết thì trả đơn không thu hồi được (thu hồi không làm số dư âm), khách giữ điểm của đơn đã trả.
   */
  async spin(userId: string) {
    if (!this.loyalty) throw new Error('GameService.spin cần LoyaltyService để đọc điểm đang khoá');
    const loyalty = this.loyalty;
    const cost = await this.config.get<number>('game.spin_buy_cost_points', 10);
    const rawLimit = Number(await this.config.get<number>('game.spin_buy_daily_limit', 5));
    // Config hỏng rơi về mặc định; 0/âm nghĩa là khoá vòng quay (không hiểu thành "không giới hạn").
    const dailyLimit = Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 5;
    const notEnough = `Cần ${cost} Điểm Xanh để quay.`;
    const prizes = this.usableSpinPrizes(await this.config.get<SpinPrize[]>('game.spin_prizes', []));
    if (prizes.length === 0) throw new BadRequestException('Vòng quay chưa cấu hình.');

    const prize = this.pickWeighted(prizes);
    // Thưởng điểm là Điểm Xanh thường nên có hạn như mọi điểm thưởng khác. Tính NGOÀI tx: đọc cấu hình không giữ
    // kết nối tx; và thiếu LoyaltyService thì dừng trước khi trừ điểm, không để lọt dòng thưởng không hạn.
    const winExpiresAt = prize.rewardType === 'POINTS' ? await this.rewardPointsExpiresAt() : null;
    // Cửa sổ đổi/trả cho lockedOrderPoints trong tx bên dưới, đọc TRƯỚC khi mở tx rồi truyền vào: lần trượt cache cấu hình
    // trong tx xin kết nối pool thứ hai khi tx đang giữ một (và khoá dòng user), nhiều lượt quay cùng chạm lúc cache hết
    // hạn có thể cạn pool (P2024). Làm ấm cache không đủ vì khoảng hở gồm cả thời gian chờ FOR UPDATE.
    const windowDays = await loyalty.returnWindowDays();
    // Trần bình nước của giải SEEDS: cùng lý do, không đọc cấu hình trong tx. Mặc định khớp với các call site khác
    // (buySeeds/checkIn/collectDew/quiz/gift) và giá trị SystemConfig thật (500) — tránh clamp sai xuống 200 khi config thiếu.
    const tankCap = prize.rewardType === 'SEEDS' ? await this.config.get<number>('game.tank_capacity', 500) : 0;

    return this.prisma.$transaction(async (tx) => {
      // Khoá dòng user TRƯỚC khi đọc số dư và điểm đang khoá (cùng quy ước buyTree/redeemReward/reverseOrderPoints:
      // user rồi mới tới sổ): trả hàng song song xếp hàng ở đây thay vì chen giữa lúc đã đọc "dùng được" và lúc trừ.
      const [bal] = await tx.$queryRaw<{ pointsBalance: number }[]>`
        SELECT "pointsBalance" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
      const lock = await loyalty.lockedOrderPoints(userId, new Date(), tx, windowDays);
      if (Math.max(0, (bal?.pointsBalance ?? 0) - lock.locked) < cost) {
        throw new BadRequestException(
          lock.locked > 0 ? `${notEnough} Một phần điểm chưa dùng được: ${loyalty.lockedPointsMessage(lock)}.` : notEnough,
        );
      }
      // Trừ điểm ATOMIC (gte phí + điểm khoá) trong transaction — lưới an toàn cuối nếu số dư đổi giữa hai câu.
      const dec = await tx.user.updateMany({
        where: { id: userId, pointsBalance: { gte: cost + lock.locked } },
        data: { pointsBalance: { decrement: cost } },
      });
      if (dec.count === 0) throw new BadRequestException(notEnough);
      // Đếm SAU khi đã giữ khoá dòng user (FOR UPDATE ở trên, giữ tới hết tx): các lượt quay song song của cùng user
      // xếp hàng ở khoá, và (READ COMMITTED) mỗi câu lệnh mới thấy lượt quay mà tx trước đã commit — không thể cùng
      // đọc "còn lượt" rồi cùng vượt trần.
      const spunToday = await tx.gameSpin.count({
        where: { userId, spunAt: { gte: this.startOfDay(new Date()) } },
      });
      if (spunToday >= dailyLimit) {
        throw new BadRequestException(
          dailyLimit > 0 ? `Bạn đã quay đủ ${dailyLimit} lượt hôm nay. Hẹn bạn ngày mai nhé!` : 'Vòng quay đang tạm đóng.',
        );
      }
      await tx.pointsTransaction.create({
        data: { userId, delta: -cost, reason: 'GAME_SPIN_COST', refType: 'GAME' },
      });

      let rewardRefId: string | null = null;
      if (prize.rewardType === 'POINTS') {
        await this.creditPoints(userId, prize.value, `GAME_SPIN_WIN:${prize.id}`, tx, winExpiresAt);
      } else if (prize.rewardType === 'SEEDS') {
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

      await this.analytics.record(tx, {
        eventName: 'engagement_action',
        userId,
        platform: 'miniapp',
        props: { action: 'spin', prizeId: prize.id, rewardType: prize.rewardType, rewardRefId },
      });

      return { prize: { id: prize.id, name: prize.name, rewardType: prize.rewardType, value: prize.value } };
    });
  }

  /**
   * Chỉ giữ giải hợp lệ. Luật ghi cấu hình (SystemConfigService) đã chặn giải hỏng, nhưng bảng đã lưu từ trước vẫn có thể
   * có giải POINTS value âm: trúng giải đó đi vào nhánh trừ điểm của creditPoints, trừ điểm của khách ngoài lockedOrderPoints.
   * Bỏ giải hỏng khỏi vòng quay (không đoán ý admin) và ghi log để sửa cấu hình.
   */
  private usableSpinPrizes(prizes: SpinPrize[]): SpinPrize[] {
    if (!Array.isArray(prizes)) return [];
    return prizes.filter((p) => {
      const problem = spinPrizeProblem(p);
      if (!problem) return true;
      const id = (p as { id?: unknown } | null)?.id;
      const label = typeof id === 'string' ? id : '(không có id)';
      const key = `${label}|${problem}`;
      if (!this.warnedPrizes.has(key)) {
        this.warnedPrizes.add(key);
        this.logger.warn(`Bỏ giải "${label}" khỏi vòng quay (game.spin_prizes): ${problem}.`);
      }
      return false;
    });
  }

  // ── Tree water + harvest ───────────────────────────
  async waterTree(userId: string, drops: number) {
    if (drops <= 0) throw new BadRequestException('Số giọt nước không hợp lệ.');

    const harvestAmount = await this.config.get<number>('game.harvest_coupon_amount', 30000);
    const harvestMinOrder = await harvestCouponMinOrder(this.config, harvestAmount);
    const deathDays = await this.config.get<number>('game.death_days', 7);
    // Trần cứng số coupon thu hoạch/ngày — ĐỘC LẬP với giá giọt nước trong config.
    // Nước rẻ hơn nhiều lần giá trị coupon (mặc định 30.000đ): không có trần thì vòng
    // kiếm-nước→tưới→thu-hoạch in coupon vô hạn (P0-1, docs/2026-09-08-review-progress.md; lúc đó nước
    // còn mua được bằng xu, nay đã ngừng). Đặt trần bằng CODE thay vì chỉ dựa vào admin cấu hình đúng
    // giá — admin sửa nhầm config không được vô tình tắt lưới an toàn.
    const dailyCap = await this.config.get<number>('game.harvest_coupon_daily_cap', 3);
    const dayStart = startOfVnDay();

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
            // Khoản góp quỹ trồng cây + mã ghi nhận KHÔNG bị cap — chỉ coupon (giá trị tiền) mới giới hạn/ngày.
            certificateCode = await this.plantTree(userId, eco.treeType, tx);
            if (couponsToday < dailyCap) {
              couponCode = await this.grantCoupon(userId, harvestAmount, tx, harvestMinOrder);
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

          await this.analytics.record(tx, {
            eventName: 'engagement_action',
            userId,
            platform: 'miniapp',
            props: { action: 'water_tree', drops },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      // P2034 = Postgres serialization failure (2 request song song đụng trần coupon/tồn kho
      // nước) — KHÔNG nuốt lỗi như rewardWithDailyCap (đó là bonus best-effort, còn ở đây nước
      // là tài nguyên thật): báo lỗi rõ để client thử lại, giao dịch đã tự rollback nguyên vẹn.
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

  /** Tạo bản ghi góp quỹ trồng cây (PLEDGED) + mã ghi nhận. Trả mã. */
  private async plantTree(userId: string, treeType: string, tx?: Prisma.TransactionClient): Promise<string> {
    const certificateCode = `TUBU-${randomUUID().slice(0, 8).toUpperCase()}`;
    const db = tx ?? this.prisma;
    await db.plantedTree.create({ data: { userId, treeType, certificateCode } });
    return certificateCode;
  }

  // ── Mua nước / góp quỹ trồng cây ─────────────────
  /**
   * Đã ngừng (C-009, quyết định Q-02): xu mua nước rẻ hơn rất nhiều so với coupon thu hoạch nên
   * Ví → xu → 💧 → coupon thành vòng in tiền. Route vẫn giữ để bản miniapp cũ nhận lỗi đọc được
   * thay vì 404.
   */
  async buySeeds(_userId: string, _seeds: number): Promise<never> {
    throw new GoneException('Tính năng mua giọt nước đã ngừng. Hãy điểm danh, làm quiz hoặc nhận sương sớm để có thêm nước.');
  }

  /**
   * Góp 1 cây vào quỹ trồng cây (PlantedTree ghi nhận khoản góp, không hứa cây cụ thể) bằng Điểm Xanh
   * (PD-3, OQ-5): tiêu lô STANDARD trước (lô có hạn), thiếu thì lấy lô quy đổi. Không sinh giá trị ngược
   * lại nên lô quy đổi không thể đổi ra thứ đáng hơn số điểm đã bỏ.
   * Lô STANDARD chỉ tiêu phần DÙNG ĐƯỢC (số dư − lockedOrderPoints, cùng luật checkout/đổi voucher): điểm đơn
   * vừa giao còn trong hạn đổi/trả mà bị tiêu ở đây thì trả đơn sẽ đẩy số dư thường xuống âm.
   *
   * Idempotency-Key (tuỳ chọn, chống bấm đôi): có key thì mã chứng nhận suy ra tất định từ (user, key), nên
   * gọi lại cùng key trả đúng kết quả lượt đầu và không trừ thêm. Việc "đã có chưa" được kiểm trong
   * transaction SAU khi khoá dòng user: hai request song song cùng key xếp hàng ở khoá đó, request sau thấy
   * cây request trước đã commit. Không key: mỗi lần một mã ngẫu nhiên như cũ.
   */
  async buyTree(userId: string, idempotencyKey?: string) {
    if (!this.loyalty) throw new Error('GameService.buyTree cần LoyaltyService để đọc điểm đang khoá');
    const loyalty = this.loyalty;
    const key = parseTreeBuyKey(idempotencyKey);
    const price = await this.config.get<number>('game.tree_points_price', 50);
    if (!Number.isSafeInteger(price) || price <= 0) {
      throw new BadRequestException('Tính năng góp quỹ trồng cây chưa khả dụng.');
    }
    const certificateCode = key ? treeCertificateCodeFor(userId, key) : `TUBU-${randomUUID().slice(0, 8).toUpperCase()}`;
    const reason = `GAME_BUY_TREE:${certificateCode}`;
    const notEnough = `Cần ${price} Điểm Xanh để góp quỹ trồng cây.`;
    // Đọc ngoài tx rồi truyền cho lockedOrderPoints, cùng lý do như spin().
    const windowDays = await loyalty.returnWindowDays();
    return this.prisma.$transaction(async (tx) => {
      // Khoá dòng user rồi mới chia lô: hai lượt góp song song không cùng đọc một số dư.
      const [bal] = await tx.$queryRaw<{ pointsBalance: number; pointsConvertedBalance: number }[]>`
        SELECT "pointsBalance", "pointsConvertedBalance" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
      if (key) {
        const replay = await this.replayTreeBuy(tx, userId, certificateCode);
        if (replay) return replay;
      }
      const lock = await loyalty.lockedOrderPoints(userId, new Date(), tx, windowDays);
      const std = Math.min(price, Math.max(0, (bal?.pointsBalance ?? 0) - lock.locked));
      const conv = price - std;
      if (conv > Math.max(0, bal?.pointsConvertedBalance ?? 0)) {
        throw new BadRequestException(
          lock.locked > 0 ? `${notEnough} Một phần điểm chưa dùng được: ${loyalty.lockedPointsMessage(lock)}.` : notEnough,
        );
      }
      for (const [lot, amount] of [['STANDARD', std], ['CONVERTED', conv]] as const) {
        if (amount <= 0) continue;
        const r = await applyPointsDelta(tx, { userId, delta: -amount, lot, reason, refType: 'GAME' });
        if (!r.applied) throw new BadRequestException(notEnough);
      }
      await tx.plantedTree.create({ data: { userId, treeType: DEFAULT_TREE_TYPE, certificateCode } });
      return { certificateCode, treeType: DEFAULT_TREE_TYPE, cost: price, pointsUsed: price, pointsUsedConverted: conv };
    });
  }

  /**
   * Lượt góp đã ghi với mã suy ra từ Idempotency-Key, dựng lại từ sổ điểm (giá/phần quy đổi LÚC ĐÓ, không
   * phải giá cấu hình hôm nay). Gọi trong tx đã khoá dòng user. Mã thuộc user KHÁC (va chạm hash hoặc cố ý
   * mài key) thì từ chối chứ không bao giờ trả dữ liệu của họ; tra sổ điểm luôn kèm userId.
   */
  private async replayTreeBuy(tx: Prisma.TransactionClient, userId: string, certificateCode: string) {
    const existing = await tx.plantedTree.findUnique({ where: { certificateCode }, select: { userId: true, treeType: true } });
    if (!existing) return null;
    if (existing.userId !== userId) {
      throw new BadRequestException('Idempotency-Key này không dùng được, hãy tạo khoá khác.');
    }
    const spent = await tx.pointsTransaction.findMany({
      where: { userId, reason: `GAME_BUY_TREE:${certificateCode}` },
      select: { delta: true, lot: true },
    });
    const pointsUsed = spent.reduce((sum, e) => sum - e.delta, 0);
    const pointsUsedConverted = spent.filter((e) => e.lot === 'CONVERTED').reduce((sum, e) => sum - e.delta, 0);
    return { certificateCode, treeType: existing.treeType, cost: pointsUsed, pointsUsed, pointsUsedConverted };
  }

  /** Danh sách cây tôi đã góp vào quỹ trồng cây + mã ghi nhận (§6.7.7). */
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
  /** Chỉ số THÔ (không cap theo goal) đằng sau tiến trình nhiệm vụ — dùng chung cho getMissions
   * (hiển thị, cap tại đây) VÀ claimMission (tính cycleKey của nhiệm vụ lặp lại). Tách ra để 2 nơi
   * không lệch định nghĩa "đạt điều kiện" (trước đây chỉ getMissions có logic này). */
  private missionRawProgress(
    code: string,
    metrics: { streakDays: number; ordersCount: number; reviewsCount: number; referralsCount: number },
  ): number {
    switch (code) {
      case 'CHECKIN_7':
        return metrics.streakDays;
      case 'FIRST_ORDER':
        return metrics.ordersCount;
      case 'REVIEW_3':
        return metrics.reviewsCount;
      case 'INVITE_3':
        return metrics.referralsCount;
      default:
        return 0;
    }
  }

  private async missionMetrics(userId: string) {
    const [profile, ordersCount, reviewsCount, referralsCount] = await Promise.all([
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
    return { streakDays: profile?.streakDays ?? 0, ordersCount, reviewsCount, referralsCount };
  }

  /** Nhiệm vụ không lặp lại: 1 chu kỳ duy nhất, cố định '0'. Nhiệm vụ lặp lại (isRepeatable, vd
   * CHECKIN_7): mỗi lần chỉ số thô vượt thêm 1 lần `goal` là một chu kỳ mới có thể nhận lại (streak
   * 7 → 14 → 21…) — mirror cách CtvMilestoneClaim dùng monthKey phân biệt các lượt nhận lặp lại. */
  private missionCycleKey(mission: { isRepeatable: boolean }, rawProgress: number, targetGoal: number): string {
    if (!mission.isRepeatable) return '0';
    return String(Math.floor(rawProgress / Math.max(1, targetGoal)));
  }

  async getMissions(userId: string) {
    const [missions, metrics] = await Promise.all([this.prisma.mission.findMany(), this.missionMetrics(userId)]);

    const missionIds = missions.map((m) => m.id);
    // A1-02: mission_progress giờ là khoá "đã nhận" thật (trước đây tồn tại trong schema nhưng
    // không nơi nào đọc/ghi) — 1 dòng ứng với 1 (mission, chu kỳ) ĐÃ NHẬN thưởng.
    const claims =
      missionIds.length > 0
        ? await this.prisma.missionProgress.findMany({ where: { userId, missionId: { in: missionIds } } })
        : [];
    const claimedKeys = new Set(claims.map((c) => `${c.missionId}:${c.cycleKey}`));

    return missions.map((m) => {
      const targetGoal = m.goal > 0 ? m.goal : 1;
      const raw = this.missionRawProgress(m.code, metrics);
      const progress = Math.min(targetGoal, raw);
      const completed = raw >= targetGoal;
      const cycleKey = this.missionCycleKey(m, raw, targetGoal);
      const claimed = claimedKeys.has(`${m.id}:${cycleKey}`);

      return {
        code: m.code,
        title: m.title,
        description: m.description,
        rewardPoints: m.rewardPoints,
        progress,
        goal: targetGoal,
        completed,
        claimed,
      };
    });
  }

  /**
   * Nhận thưởng nhiệm vụ (A1-02): trước đây thẻ nhiệm vụ hứa "+20đ/+30đ/+50đ" và hiện ✓ khi đạt
   * điều kiện, nhưng KHÔNG có đường cộng nào — `MissionProgress` được định nghĩa trong schema
   * nhưng không nơi nào đọc/ghi. Idempotent + atomic, mirror SeasonPassService.claim /
   * AffiliateService.claimMilestone: insert dòng mission_progress (khoá unique userId+missionId+
   * cycleKey) TRƯỚC khi cộng thưởng — request thua race ăn P2002 → rollback cả tx, không cộng 2 lần.
   * Thưởng cộng vào pointsBalance (Điểm Xanh) — "đ" trong copy game.tsx KHÔNG phải VNĐ, đúng ledger
   * dùng bởi mọi nguồn cộng điểm khác (đơn giao, đánh giá, điểm danh, vòng quay — xem creditPoints).
   */
  async claimMission(userId: string, code: string) {
    const mission = await this.prisma.mission.findUnique({ where: { code } });
    if (!mission) throw new NotFoundException(`Nhiệm vụ "${code}" không tồn tại.`);

    const metrics = await this.missionMetrics(userId);
    const targetGoal = mission.goal > 0 ? mission.goal : 1;
    const raw = this.missionRawProgress(mission.code, metrics);
    if (raw < targetGoal) {
      throw new BadRequestException('Chưa đủ điều kiện để nhận thưởng nhiệm vụ này.');
    }
    const cycleKey = this.missionCycleKey(mission, raw, targetGoal);
    // NGOÀI tx, cùng lý do như spin(); chỉ cần khi nhiệm vụ có thưởng điểm.
    const rewardExpiresAt = mission.rewardPoints > 0 ? await this.rewardPointsExpiresAt() : null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Insert claim TRƯỚC khi cộng thưởng — khoá idempotency thật là unique của mission_progress,
        // không phải check đọc-rồi-ghi (TOCTOU dưới đồng thời).
        await tx.missionProgress.create({
          data: {
            userId,
            missionId: mission.id,
            cycleKey,
            progress: Math.min(targetGoal, raw),
            goal: targetGoal,
            completedAt: new Date(),
          },
        });

        await this.creditPoints(userId, mission.rewardPoints, `MISSION:${mission.code}:${cycleKey}`, tx, rewardExpiresAt);

        // rewardCoupon (schema) chưa được seed dùng ở nhiệm vụ nào hiện tại — hỗ trợ sẵn để nhiệm
        // vụ tương lai cấu hình coupon không bị lặp lại lỗi "hứa mà không trả" như A1-02.
        let couponCode: string | null = null;
        const couponAmount = mission.rewardCoupon ? Number(mission.rewardCoupon) : NaN;
        if (Number.isFinite(couponAmount) && couponAmount > 0) {
          couponCode = await this.grantCoupon(userId, couponAmount, tx);
        }

        return { claimed: true, rewardPoints: mission.rewardPoints, couponCode };
      });
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        throw new BadRequestException('Bạn đã nhận thưởng nhiệm vụ này rồi.');
      }
      throw err;
    }
  }

  async getLeaderboard() {
    const top = await this.prisma.gameProfile.findMany({
      orderBy: [{ longestStreak: 'desc' }, { totalSeeds: 'desc' }],
      take: 10,
      include: { user: { select: { fullName: true } } },
    });
    return top.map((p, i) => ({
      rank: i + 1,
      nickname: maskName(p.user.fullName),
      streak: p.longestStreak,
      treesPlanted: this.eco(p.ecoImpact).treesPlanted,
    }));
  }

  // ── Helpers ────────────────────────────────────────
  /** Hạn của điểm thưởng game (lô STANDARD). Bắt buộc có LoyaltyService, như buyTree: thiếu thì không ghi gì. */
  private async rewardPointsExpiresAt(): Promise<Date> {
    if (!this.loyalty) throw new Error('GameService cần LoyaltyService để tính hạn điểm thưởng');
    return this.loyalty.pointsExpiresAt(new Date());
  }

  /**
   * `expiresAt` bắt buộc cho lệnh cộng (điểm thưởng có hạn); lệnh trừ không dùng tới. Nhánh trừ KHÔNG tính lockedOrderPoints
   * nên không phải đường chi tiêu của khách: caller chỉ truyền thưởng dương (giải vòng quay đã qua usableSpinPrizes, thưởng
   * nhiệm vụ lấy từ bảng missions chỉ có seed ghi).
   */
  private async creditPoints(
    userId: string,
    delta: number,
    reason: string,
    tx: Prisma.TransactionClient,
    expiresAt: Date | null,
  ) {
    if (delta < 0) {
      const abs = Math.abs(delta);
      const dec = await tx.user.updateMany({
        where: { id: userId, pointsBalance: { gte: abs } },
        data: { pointsBalance: { decrement: abs } },
      });
      if (dec.count === 0) throw new BadRequestException('Số điểm Xanh không đủ.');
      await tx.pointsTransaction.create({ data: { userId, delta: -abs, reason, refType: 'GAME' } });
    } else {
      if (delta > 0 && !expiresAt) throw new Error(`creditPoints: điểm cộng (${reason}) phải có expiresAt`);
      await tx.pointsTransaction.create({
        data: { userId, delta, reason, refType: 'GAME', ...(delta > 0 ? { expiresAt } : {}) },
      });
      await tx.user.update({ where: { id: userId }, data: { pointsBalance: { increment: delta } } });
    }
  }

  /**
   * Tạo coupon cá nhân AMOUNT cho user (thưởng game). Trả về code.
   * minOrder mặc định = chính giá trị coupon (mirror groupbuy.service.ts grantCoupon, P0-2): không
   * có ràng buộc này, coupon AMOUNT không có product/minOrder restriction dùng được trên BẤT KỲ
   * đơn nào (CouponsService.validateAndCompute chỉ trừ min(value, subtotal), không xét sản
   * phẩm) — thu hoạch xong là có "tiền free" tiêu ở đơn bất kỳ, không cần đơn thật tương xứng.
   * Coupon thu hoạch truyền minOrder riêng (harvestCouponMinOrder) — không bao giờ thấp hơn value.
   */
  private async grantCoupon(
    userId: string,
    amount: number,
    tx?: Prisma.TransactionClient,
    minOrder: number = amount,
  ): Promise<string> {
    const code = `GAME${amount}-${userId.slice(-5)}-${Math.floor(Math.random() * 9000 + 1000)}`.toUpperCase();
    const end = new Date();
    end.setDate(end.getDate() + 30);
    const db = tx ?? this.prisma;
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

  private startOfDay(d: Date): Date {
    const utc7 = new Date(d.getTime() + 7 * 3600 * 1000);
    utc7.setUTCHours(0, 0, 0, 0);
    return new Date(utc7.getTime() - 7 * 3600 * 1000);
  }
}
