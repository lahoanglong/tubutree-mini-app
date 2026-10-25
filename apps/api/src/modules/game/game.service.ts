import { BadRequestException, ForbiddenException, GoneException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
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
import {
  DAILY_LOGIN_SEEDS_DEFAULT,
  DEFAULT_TREE_TYPE,
  DEW_SEEDS_DEFAULT,
  FIRST_CHECKIN_BONUS_DEFAULT,
  FIRST_HARVEST_POINTS_DEFAULT,
  HARVEST_COUPON_DAILY_CAP_DEFAULT,
  HARVEST_COUPON_MONTHLY_CAP_DEFAULT,
  QUIZ_WRONG_SEEDS_DEFAULT,
  configInt,
  harvestCouponMinOrder,
  HARVEST_COUPON_PREFIX,
  HARVEST_COUPON_CODE_PREFIXES,
  ladderTarget,
  spinVoucherMinOrder,
  streak7Seeds,
  treeTargetLadder,
} from './game.constants';
import { countReferralSuccesses } from '../wallet/referral-reward';
import { ensureGameProfile, initialEcoImpact, sproutAlreadyRewarded } from './game-profile';
import { isRealUser } from '../../common/real-user';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
import { startOfVnDay, startOfVnMonth } from '../../common/vn-time';
import { maskName } from '../../common/mask-name';
import { formatPoints } from '../../common/format-points';
import { parseTreeBuyKey, treeCertificateCodeFor } from './tree-purchase-key';
import { returnedProductsByOrder, REVIEWABLE_ORDER, returnWindowClosed } from '../reviews/review-eligibility';

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
  /** Đã cấp điểm cây mầm chưa. Thiếu = hồ sơ cũ, suy từ treesPlanted (xem sproutAlreadyRewarded). */
  sproutRewarded?: boolean;
}

/** Thêm vào mô tả thẻ nhiệm vụ khi đơn đã giao nhưng chưa tính vì còn trong hạn đổi/trả. */
const MISSION_WAITING_NOTE =
  'Đơn đã giao đang trong thời gian đổi/trả hoặc đang chờ duyệt yêu cầu trả, thưởng mở khi hết hạn đổi/trả và yêu cầu trả (nếu có) đã được xử lý.';

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
    const streakRepairCost = await this.config.get<number>('game.streak_repair_cost', 150);
    const windowH = await this.config.get<number>('game.streak_repair_window_hours', 48);
    const cooldownD = await this.config.get<number>('game.streak_repair_cooldown_days', 30);
    // Giá các món — FE trước đây chép cứng (80💧 đóng băng chuỗi, giá góp quỹ trồng cây): admin đổi
    // config thì nhãn trên nút vẫn hiện giá cũ, bấm xong mới biết trừ khác.
    const [
      streakFreezeCost,
      treePointsPrice,
      tankCapacity,
      spinCostPoints,
      dailyLoginSeeds,
      dewSeeds,
      streak7SeedsValue,
      quizWrongSeeds,
      firstCheckinBonusConfig,
      ladder,
    ] = await Promise.all([
      this.config.get<number>('game.streak_freeze_cost', 80),
      this.config.get<number>('game.tree_points_price', 50_000),
      this.config.get<number>('game.tank_capacity', 500),
      this.config.get<number>('game.spin_buy_cost_points', 10_000),
      configInt(this.config, 'game.daily_login_seeds', DAILY_LOGIN_SEEDS_DEFAULT),
      configInt(this.config, 'game.dew_seeds', DEW_SEEDS_DEFAULT),
      streak7Seeds(this.config),
      configInt(this.config, 'game.quiz_wrong_seeds', QUIZ_WRONG_SEEDS_DEFAULT),
      configInt(this.config, 'game.first_checkin_bonus', FIRST_CHECKIN_BONUS_DEFAULT),
      treeTargetLadder(this.config),
    ]);
    const eco = this.eco(profile.ecoImpact, ladder);
    const streakRepairable =
      !!profile.brokenStreakAt &&
      profile.brokenStreakDays > 0 &&
      Date.now() - new Date(profile.brokenStreakAt).getTime() <= windowH * 3600 * 1000 &&
      (!profile.lastStreakRepairAt || Date.now() - new Date(profile.lastStreakRepairAt).getTime() >= cooldownD * 86400 * 1000);
    return {
      ...profile,
      ecoImpact: eco,
      treeHealth: this.treeHealth(profile, wiltDays),
      brokenStreakDays: profile.brokenStreakDays,
      streakRepairCost,
      streakRepairable,
      streakFreezeCost,
      treePointsPrice,
      tankCapacity,
      spinCostPoints,
      // Lượng 💧 hiện trước khi khách bấm (cùng nguồn với checkIn/collectDew/answerQuiz).
      dailyLoginSeeds,
      dewSeeds,
      streak7Seeds: streak7SeedsValue,
      firstCheckinBonus: profile.lastCheckInAt === null ? firstCheckinBonusConfig : 0,
      quizWrongSeeds,
      currentTreeTarget: eco.target,
      nextTreeTarget: ladderTarget(ladder, eco.treesPlanted + 1),
    };
  }

  /** §6.7.3: trạng thái cây theo số ngày không tưới (chỉ tính khi đã có tiến trình). */
  private treeHealth(
    profile: { lastWateredAt: Date | null; ecoImpact: unknown },
    wiltDays: number,
  ): 'HEALTHY' | 'WILTED' | 'DEAD' {
    if (!profile.lastWateredAt || this.eco(profile.ecoImpact).progress <= 0) return 'HEALTHY';
    const days = (Date.now() - new Date(profile.lastWateredAt).getTime()) / 864e5;
    // Cây không còn chết hay mất tiến độ nên không bao giờ trả 'DEAD' (giữ kiểu enum cho FE cũ).
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
    const cost = await this.config.get<number>('game.spin_buy_cost_points', 10_000);
    const rawLimit = Number(await this.config.get<number>('game.spin_buy_daily_limit', 5));
    // Config hỏng rơi về mặc định; 0/âm nghĩa là khoá vòng quay (không hiểu thành "không giới hạn").
    const dailyLimit = Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 5;
    const notEnough = `Cần ${formatPoints(cost)} Điểm Xanh để quay.`;
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
    const seedsEcoImpact = prize.rewardType === 'SEEDS' ? await initialEcoImpact(this.config) : null;
    const voucherMinOrder = prize.rewardType === 'COUPON' ? await spinVoucherMinOrder(this.config, prize.value) : 0;

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
      let coupon: { code: string; minOrder: number; expiresAt: Date } | undefined;
      if (prize.rewardType === 'POINTS') {
        await this.creditPoints(userId, prize.value, `GAME_SPIN_WIN:${prize.id}`, tx, winExpiresAt);
      } else if (prize.rewardType === 'SEEDS') {
        // Cộng totalSeeds ATOMIC bằng increment + guard cap (updateMany) trong CÙNG tx — chống
        // lost-update khi trúng SEEDS đồng thời với spin/checkin/quiz/gift khác đang đổi
        // totalSeeds (pattern cũ đọc-rồi-ghi-tuyệt-đối sẽ đè mất phần cộng của thao tác kia).
        // Upsert: khách quay trước khi từng mở Vườn Xanh chưa có hồ sơ (update ném P2025 → 404 "Không tìm thấy bản ghi").
        await tx.gameProfile.upsert({
          where: { userId },
          update: { totalSeeds: { increment: prize.value } },
          create: {
            userId,
            totalSeeds: prize.value,
            ecoImpact: seedsEcoImpact ?? {},
          },
        });
        await tx.gameProfile.updateMany({
          where: { userId, totalSeeds: { gt: tankCap } },
          data: { totalSeeds: tankCap },
        });
      } else if (prize.rewardType === 'COUPON') {
        coupon = await this.grantCouponWithTerms(userId, prize.value, tx, voucherMinOrder);
        rewardRefId = coupon.code;
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

      return {
        prize: { id: prize.id, name: prize.name, rewardType: prize.rewardType, value: prize.value, ...(coupon ? { coupon } : {}) },
      };
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
    // Trần cứng số coupon thu hoạch/ngày và /tháng — ĐỘC LẬP với giá giọt nước trong config.
    // Nước rẻ hơn nhiều lần giá trị coupon (mặc định 30.000đ): không có trần thì vòng
    // kiếm-nước→tưới→thu-hoạch in coupon vô hạn (P0-1, docs/2026-09-08-review-progress.md; lúc đó nước
    // còn mua được bằng xu, nay đã ngừng). Đặt trần bằng CODE thay vì chỉ dựa vào admin cấu hình đúng
    // giá — admin sửa nhầm config không được vô tình tắt lưới an toàn.
    const dailyCap = await configInt(this.config, 'game.harvest_coupon_daily_cap', HARVEST_COUPON_DAILY_CAP_DEFAULT);
    const monthlyCap = await configInt(this.config, 'game.harvest_coupon_monthly_cap', HARVEST_COUPON_MONTHLY_CAP_DEFAULT);
    const dayStart = startOfVnDay();
    const monthStart = startOfVnMonth();
    // Thang target và điểm cây mầm đọc NGOÀI giao dịch Serializable (đọc cấu hình trong tx xin thêm một kết nối pool).
    const ladder = await treeTargetLadder(this.config);
    const firstHarvestPoints = await configInt(this.config, 'game.first_harvest_points', FIRST_HARVEST_POINTS_DEFAULT);
    // Chỉ khách thật (isRealUser: có SĐT hoặc zaloId Zalo thật) nhận mã thu hoạch và điểm cây mầm; guest_ tạo vô hạn
    // bằng deviceId nên không được nhận. Guest đã xác thực SĐT vẫn là khách thật.
    const owner = await this.prisma.user.findUnique({ where: { id: userId }, select: { zaloId: true, phone: true } });
    const realUser = isRealUser(owner);
    // Cây mầm (lần thu hoạch đầu của khách thật chưa nhận điểm cây mầm) thưởng điểm thay mã; hạn điểm tính trước tx như
    // `spin`. Đọc trước tx chỉ để quyết định có cần tính hạn điểm; cờ thật được đọc lại trong tx.
    let sproutEligible = false;
    let sproutExpiresAt: Date | null = null;
    if (firstHarvestPoints > 0 && realUser) {
      const pre = await this.prisma.gameProfile.findUnique({ where: { userId }, select: { ecoImpact: true } });
      if (pre && !sproutAlreadyRewarded(this.eco(pre.ecoImpact, ladder))) {
        sproutEligible = true;
        if (this.loyalty) sproutExpiresAt = await this.rewardPointsExpiresAt();
      }
    }

    let harvestCount = 0;
    let harvestedDrops = 0;
    const couponCodes: string[] = [];
    let certificateCode: string | undefined;
    let couponCapped: 'DAY' | 'MONTH' | undefined;
    let rewardBlocked: 'GUEST' | undefined;
    let sproutPoints = 0;
    let sproutHarvested = false;
    const revivedFromDead = false;
    let eco: EcoImpact = { progress: 0, target: ladderTarget(ladder, 0), treeType: DEFAULT_TREE_TYPE, treesPlanted: 0 };

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
          // DÙNG CHUNG trần với waterPlot (lô phụ, game-garden.service.ts): đếm mã 'HARVEST' (lô nhà) lẫn
          // 'GARDEN' (lô phụ) trong CÙNG 1 trần/user/ngày và /tháng — nếu không, user có thể lách trần bằng cách
          // tưới lô nhà + lô phụ song song. Mã 'GAME' của vòng quay/nhiệm vụ không thuộc trần này.
          const harvestCouponWhere = {
            OR: HARVEST_COUPON_CODE_PREFIXES.map((prefix) => ({ code: { startsWith: prefix } })),
            scopeMeta: { path: ['userId'], equals: userId },
          };
          let couponsToday = await tx.coupon.count({ where: { ...harvestCouponWhere, startAt: { gte: dayStart } } });
          let couponsMonth = await tx.coupon.count({ where: { ...harvestCouponWhere, startAt: { gte: monthStart } } });

          eco = this.eco(profile.ecoImpact, ladder);
          let sproutDue = sproutEligible && !sproutAlreadyRewarded(eco);
          // Cây bỏ lâu chỉ héo (treeHealth), KHÔNG mất tiến độ.
          eco.progress += drops;

          // Chặn target<=0 (config game.tree_target_ladder sai, hoặc dữ liệu cũ hỏng) TRƯỚC
          // vòng lặp thu hoạch — nếu không, while (progress>=target) không bao giờ thoát, giữ
          // lock trong transaction Serializable tới khi pool timeout (P2-4, mirror guard đã có
          // ở game-garden.service.ts).
          if (!Number.isInteger(eco.target) || eco.target <= 0) {
            throw new BadRequestException('Cây chưa cấu hình mục tiêu hợp lệ.');
          }

          // Thu hoạch khi đủ target; phần dư được CARRY-OVER sang cây mới (không mất nước).
          while (eco.progress >= eco.target) {
            eco.progress -= eco.target;
            harvestedDrops += eco.target;
            const isSprout = eco.treesPlanted === 0;
            if (isSprout) sproutHarvested = true;
            eco.treesPlanted += 1;
            harvestCount += 1;
            // Cây kế tiếp theo thang; cây đang trồng của hồ sơ cũ giữ target đã lưu cho tới lần thu hoạch này.
            eco.target = ladderTarget(ladder, eco.treesPlanted);
            await this.analytics.record(tx, {
              eventName: 'engagement_action',
              userId,
              platform: 'miniapp',
              props: { action: 'harvest', treeNo: eco.treesPlanted },
            });
            if (sproutDue) {
              sproutDue = false;
              // Hồ sơ cũ chưa có cờ mà đã nhận điểm cây mầm (sổ điểm có dòng GAME_FIRST_HARVEST): chỉ bật cờ, không cộng lại.
              const paid = await tx.pointsTransaction.findFirst({ where: { userId, reason: 'GAME_FIRST_HARVEST' }, select: { id: true } });
              if (!paid) {
                // Thiếu hạn điểm (không có LoyaltyService) thì dừng và rollback cả lần tưới, không để lọt dòng điểm không hạn.
                if (!sproutExpiresAt) throw new Error('GameService cần LoyaltyService để tính hạn điểm cây mầm');
                await this.creditPoints(userId, firstHarvestPoints, 'GAME_FIRST_HARVEST', tx, sproutExpiresAt);
                sproutPoints += firstHarvestPoints;
              }
              eco.sproutRewarded = true;
            }
            if (!realUser) rewardBlocked = 'GUEST';
            // Cây mầm thật sự (cây đầu tiên): điểm, không mã, không ghi góp quỹ cây.
            if (isSprout) continue;
            // Khoản góp quỹ trồng cây + mã ghi nhận KHÔNG bị cap — chỉ coupon (giá trị tiền) mới giới hạn.
            certificateCode = await this.plantTree(userId, eco.treeType, tx);
            if (!realUser) continue;
            if (couponsMonth >= monthlyCap) {
              couponCapped = 'MONTH';
            } else if (couponsToday >= dailyCap) {
              couponCapped = 'DAY';
            } else {
              couponCodes.push(await this.grantCoupon(userId, harvestAmount, tx, harvestMinOrder, HARVEST_COUPON_PREFIX));
              couponsToday += 1;
              couponsMonth += 1;
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
      coupons?: string[];
      certificate?: string;
      species?: { name: string; emoji: string; rarity: string; ecoFact: string | null };
      points?: number;
      sprout?: boolean;
    } = {
      ...(sproutHarvested ? { sprout: true } : {}),
      ...(couponCodes.length > 0 ? { coupon: couponCodes[0], coupons: couponCodes } : {}),
      ...(certificateCode ? { certificate: certificateCode } : {}),
      ...(species ? { species } : {}),
      ...(sproutPoints > 0 ? { points: sproutPoints } : {}),
    };

    // Phase 2: thu hoạch → 💧 đã nuôi cây góp vào hồ cộng đồng (Ant Forest gom batch).
    // Lỗi góp hồ không được chặn thu hoạch của user.
    if (harvested && this.community) {
      await this.community.contribute(userId, harvestedDrops).catch(() => undefined);
    }

    return {
      progress: eco.progress,
      target: eco.target,
      harvested,
      treesPlanted: eco.treesPlanted,
      revivedFromDead,
      ...(couponCapped ? { couponCapped } : {}),
      ...(rewardBlocked ? { rewardBlocked } : {}),
      reward,
    };
  }

  /**
   * Khách tự bấm chia sẻ thành tích thu hoạch lên Cộng đồng. Nội dung do server dựng từ số cây của chính người đó, không
   * nhận gì từ client. Mỗi mức `treesPlanted` chỉ có một bài: khoá tư vấn theo user giữ hai request song song nối đuôi nhau.
   */
  async shareHarvest(userId: string): Promise<{ shared: true; alreadyShared: boolean }> {
    const owner = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true, zaloId: true } });
    if (!isRealUser(owner)) throw new ForbiddenException('Chỉ tài khoản đã đăng nhập Zalo mới chia sẻ được lên Cộng đồng.');
    const profile = await this.prisma.gameProfile.findUnique({ where: { userId }, select: { ecoImpact: true } });
    const treesPlanted = profile ? this.eco(profile.ecoImpact).treesPlanted : 0;
    if (treesPlanted < 1) throw new BadRequestException('Bạn chưa thu hoạch cây nào để chia sẻ.');
    if (!this.feed) throw new BadRequestException('Cộng đồng đang tạm đóng.');
    const feed = this.feed;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`harvest-share:${userId}`}))`;
      const existing = await tx.feedPost.findFirst({
        where: { userId, kind: 'HARVEST', meta: { path: ['treesPlanted'], equals: treesPlanted } },
        select: { id: true },
      });
      if (existing) return { shared: true as const, alreadyShared: true };
      await feed.createAchievementPost(userId, 'HARVEST', 'Vừa thu hoạch 1 cây trong Vườn Xanh 🌳', { treesPlanted }, tx);
      return { shared: true as const, alreadyShared: false };
    });
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
    const price = await this.config.get<number>('game.tree_points_price', 50_000);
    if (!Number.isSafeInteger(price) || price <= 0) {
      throw new BadRequestException('Tính năng góp quỹ trồng cây chưa khả dụng.');
    }
    const certificateCode = key ? treeCertificateCodeFor(userId, key) : `TUBU-${randomUUID().slice(0, 8).toUpperCase()}`;
    const reason = `GAME_BUY_TREE:${certificateCode}`;
    const notEnough = `Cần ${formatPoints(price)} Điểm Xanh để góp quỹ trồng cây.`;
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
    metrics: { streakDays: number; ordersCount: number; reviewedProductsCount: number; referralsCount: number },
  ): number {
    switch (code) {
      case 'CHECKIN_7':
        return metrics.streakDays;
      case 'FIRST_ORDER':
        return metrics.ordersCount;
      case 'REVIEW_3':
        return metrics.reviewedProductsCount;
      case 'INVITE_3':
        return metrics.referralsCount;
      default:
        return 0;
    }
  }

  /**
   * FIRST_ORDER chỉ tính đơn bán lẻ đã giao của chính khách và đã hết hạn đổi/trả: thưởng trả bằng điểm dùng ngay được, nên
   * đơn còn có thể bị trả (còn trong returns.window_days hoặc đang có yêu cầu trả chờ duyệt) chưa được tính, nếu không khách
   * nhận thưởng rồi trả đơn mà vẫn giữ điểm. INVITE_3 dùng đúng
   * số lượt giới thiệu thành công của chương trình giới thiệu (bạn được mời mua thành công, trừ lượt bị thu hồi), không
   * đếm tài khoản được mời: tài khoản khách tạo bằng deviceId không tốn gì (ENGAGE-1). REVIEW_3 chỉ tính đánh giá có ảnh,
   * đúng điều mô tả nhiệm vụ hứa ("Viết 3 đánh giá có ảnh"), của đơn gốc cũng đã hết hạn đổi/trả, và đếm theo SẢN PHẨM khác
   * nhau: mỗi lần mua được một đánh giá nên đếm theo dòng thì mua cùng một sản phẩm ba lần là xong nhiệm vụ.
   *
   * Đánh giá của sản phẩm đã có dòng trả được duyệt trên đơn đó (thưởng đánh giá đã thu hồi) không tính, dù đơn còn trong hạn
   * hay đã qua hạn.
   *
   * `pending*` là phần đã có nhưng còn chờ hết hạn đổi/trả, để thẻ nhiệm vụ nói đúng lý do chưa tính.
   */
  private async missionMetrics(userId: string) {
    const [profile, orders, imageReviews, referralsCount] = await Promise.all([
      this.prisma.gameProfile.findUnique({ where: { userId } }),
      this.deliveredOrders(userId),
      this.prisma.review.findMany({
        where: { userId, NOT: { images: { isEmpty: true } } },
        select: { productId: true, orderId: true },
      }),
      countReferralSuccesses(this.prisma, userId),
    ]);
    // Sản phẩm đã bị trả (dù một phần) trên đơn đó đã mất thưởng đánh giá nên không tính vào nhiệm vụ nữa.
    const returned = await returnedProductsByOrder(this.prisma, [...new Set(imageReviews.map((r) => r.orderId))]);
    const counted = imageReviews.filter((r) => !returned.get(r.orderId)?.has(r.productId));
    const settledProducts = new Set(counted.filter((r) => orders.settled.has(r.orderId)).map((r) => r.productId));
    const pendingProducts = new Set(
      counted.filter((r) => orders.pending.has(r.orderId) && !settledProducts.has(r.productId)).map((r) => r.productId),
    );
    return {
      streakDays: profile?.streakDays ?? 0,
      ordersCount: orders.settled.size,
      pendingOrdersCount: orders.pending.size,
      reviewedProductsCount: settledProducts.size,
      pendingReviewedProductsCount: pendingProducts.size,
      referralsCount,
    };
  }

  /**
   * Đơn bán lẻ đã giao của khách (cùng REVIEWABLE_ORDER với đánh giá): `settled` đã qua hạn đổi/trả và không có yêu cầu trả
   * chờ duyệt; `pending` là phần còn lại. Hết hạn thì khách không gửi thêm được yêu cầu trả (OrderReturnsService.request), nên
   * đơn settled không còn đường nào bị trả sau lúc nhận thưởng.
   */
  private async deliveredOrders(userId: string): Promise<{ settled: Set<string>; pending: Set<string> }> {
    const [windowDays, orders] = await Promise.all([
      this.returnWindowDays(),
      this.prisma.order.findMany({ where: { userId, ...REVIEWABLE_ORDER }, select: { id: true, deliveredAt: true, updatedAt: true } }),
    ]);
    const open =
      orders.length > 0
        ? await this.prisma.returnRequest.findMany({
            where: { orderId: { in: orders.map((o) => o.id) }, status: 'REQUESTED' },
            select: { orderId: true },
          })
        : [];
    const withOpenRequest = new Set(open.map((r) => r.orderId));
    const now = new Date();
    const settled = new Set<string>();
    const pending = new Set<string>();
    for (const o of orders) {
      (returnWindowClosed(o, windowDays, now) && !withOpenRequest.has(o.id) ? settled : pending).add(o.id);
    }
    return { settled, pending };
  }

  /** returns.window_days (cùng khoá và mặc định 7 với OrderReturnsService.request); sai kiểu → 7. */
  private async returnWindowDays(): Promise<number> {
    const v = Number(await this.config.get<number>('returns.window_days', 7));
    return Number.isFinite(v) && v >= 0 ? v : 7;
  }

  /** Nhiệm vụ đã có đơn/đánh giá nhưng chưa tính vì đơn còn trong hạn đổi/trả (hoặc đang có yêu cầu trả). */
  private missionWaitsForReturnWindow(
    code: string,
    goal: number,
    metrics: { pendingOrdersCount: number; reviewedProductsCount: number; pendingReviewedProductsCount: number },
  ): boolean {
    if (code === 'FIRST_ORDER') return metrics.pendingOrdersCount > 0;
    // Chỉ nói "chờ hết hạn" khi phần đang chờ đủ để hoàn thành nhiệm vụ; thiếu thì khách còn phải viết thêm đánh giá.
    if (code === 'REVIEW_3') return metrics.pendingReviewedProductsCount > 0 && metrics.reviewedProductsCount + metrics.pendingReviewedProductsCount >= goal;
    return false;
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
    // Nhiệm vụ không lặp lại: đã nhận ở chu kỳ nào cũng là đã nhận (dòng cũ có cycleKey khác '0' khi nhiệm vụ từng lặp lại).
    const claimedOnce = new Set(claims.map((c) => c.missionId));

    return missions.map((m) => {
      const targetGoal = m.goal > 0 ? m.goal : 1;
      const raw = this.missionRawProgress(m.code, metrics);
      const cycleKey = this.missionCycleKey(m, raw, targetGoal);
      const claimed = m.isRepeatable ? claimedKeys.has(`${m.id}:${cycleKey}`) : claimedOnce.has(m.id);
      // Nhiệm vụ không lặp lại đã nhận là đã xong: chỉ số thô có thể tụt sau lúc nhận (đơn trả, đánh giá xoá, REVIEW_3 đếm
      // theo sản phẩm) mà thẻ không được quay về "1/3" kèm dấu đã nhận.
      const done = !m.isRepeatable && claimed;
      const progress = done ? targetGoal : Math.min(targetGoal, raw);
      const completed = done || raw >= targetGoal;
      const waiting = !done && raw < targetGoal && this.missionWaitsForReturnWindow(m.code, targetGoal, metrics);

      return {
        code: m.code,
        title: m.title,
        description: waiting ? [m.description, MISSION_WAITING_NOTE].filter(Boolean).join(' ') : m.description,
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
    // Đã nhận thì báo đã nhận trước khi xét điều kiện, cùng lý do getMissions coi nhiệm vụ đã nhận là đã xong.
    if (!mission.isRepeatable) {
      const prior = await this.prisma.missionProgress.findFirst({ where: { userId, missionId: mission.id } });
      if (prior) throw new BadRequestException('Bạn đã nhận thưởng nhiệm vụ này rồi.');
    }
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
    prefix: string = 'GAME',
  ): Promise<string> {
    return (await this.grantCouponWithTerms(userId, amount, tx, minOrder, prefix)).code;
  }

  private async grantCouponWithTerms(
    userId: string,
    amount: number,
    tx?: Prisma.TransactionClient,
    minOrder: number = amount,
    prefix: string = 'GAME',
  ): Promise<{ code: string; minOrder: number; expiresAt: Date }> {
    const code = `${prefix}${amount}-${userId.slice(-5)}-${Math.floor(Math.random() * 9000 + 1000)}`.toUpperCase();
    const end = new Date();
    end.setDate(end.getDate() + 30);
    const effectiveMinOrder = Math.max(amount, minOrder);
    const db = tx ?? this.prisma;
    await db.coupon.create({
      data: {
        code,
        type: 'AMOUNT',
        value: amount,
        minOrder: effectiveMinOrder,
        startAt: new Date(),
        endAt: end,
        perUserLimit: 1,
        scope: 'USER_GROUP',
        scopeMeta: { userId } as object,
      },
    });
    return { code, minOrder: effectiveMinOrder, expiresAt: end };
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

  private eco(json: unknown, ladder?: readonly number[]): EcoImpact {
    const e = (json ?? {}) as Partial<EcoImpact>;
    const treesPlanted = e.treesPlanted ?? 0;
    const progress = e.progress ?? 0;
    let target = e.target ?? (ladder ? ladderTarget(ladder, treesPlanted) : 600);
    // Hồ sơ chưa có cây và chưa nhận cây mầm (target 600 của thang cũ): luôn hạ về bậc đầu, nước đã tưới chảy sang cây sau.
    // Cờ ghi rõ false để guest cũ nhận điểm hoãn khi nâng cấp (không có cờ thì treesPlanted > 0 bị coi là đã nhận).
    const unsprouted = !!ladder && treesPlanted === 0 && e.sproutRewarded !== true;
    if (unsprouted) target = Math.min(target, ladderTarget(ladder, 0));
    return {
      progress,
      target,
      treeType: e.treeType ?? DEFAULT_TREE_TYPE,
      treesPlanted,
      ...(unsprouted ? { sproutRewarded: false } : e.sproutRewarded !== undefined ? { sproutRewarded: e.sproutRewarded } : {}),
    };
  }

  private startOfDay(d: Date): Date {
    const utc7 = new Date(d.getTime() + 7 * 3600 * 1000);
    utc7.setUTCHours(0, 0, 0, 0);
    return new Date(utc7.getTime() - 7 * 3600 * 1000);
  }
}
