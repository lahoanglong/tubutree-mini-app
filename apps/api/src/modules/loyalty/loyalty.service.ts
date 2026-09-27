import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { MembershipTier, PosPointCredit, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { isCouponEligible } from '../coupons/coupon-scope';
import { decideTier } from './tier-policy';
import { POS_ORDER_TOTAL_HARD_MAX } from './dto/loyalty-staff.dto';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';

/**
 * Loyalty core (Build Spec §6.6). Phase 1 dùng cho vòng đời đơn:
 *  - creditOrderPoints khi DELIVERED
 *  - reverseOrderPoints khi CANCELLED/RETURNED
 *  - recalcTier theo điểm hoặc chi tiêu 12 tháng
 * Redemption/voucher endpoints mở rộng ở Phase 2.
 * CNV Loyalty Parity (2026-09): đổi quà lấy voucher, điểm danh 7 ngày (bảng loyalty_check_ins
 * RIÊNG, không dùng GameProfile), thẻ thành viên số, tích điểm hoá đơn tại quầy (POS, mặc định tắt).
 */
@Injectable()
export class LoyaltyService {
  private static readonly RECALC_PAGE = 500;
  /** 500 × 2.000 = 1 triệu thành viên mỗi đêm; cũng là chốt chặn vòng lặp vô tận. */
  private static readonly RECALC_MAX_PAGES = 2_000;

  private readonly logger = new Logger(LoyaltyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    // Optional: loyalty-features.spec.ts dựng LoyaltyService 2 tham số (không wiring analytics) ở
    // rất nhiều test không liên quan tới dailyCheckIn — @Optional() + guard `?.` ở call site để
    // không phải sửa hàng loạt test đó (ngoài phạm vi Task 9).
    @Optional() private readonly analytics?: AnalyticsEventsService,
  ) {}

  /**
   * Cộng điểm tích cho đơn đã giao (idempotent theo reason).
   *
   * RACE: 2 webhook DELIVERED song song/retry trước đây cùng findFirst NGOÀI tx → cùng thấy
   * chưa cộng → cùng create + increment → DOUBLE credit. Fix: pre-check để giảm ops vô ích,
   * nhưng GUARD CỨNG là partial unique index (reason, refId) where reason LIKE 'ORDER_DELIVERED:%'
   * (migration 20260623010000_loyalty_credit_unique). Caller thua race ăn P2002 → bail idempotent.
   * Đối xứng với reverseOrderPoints.
   */
  async creditOrderPoints(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.pointsEarned <= 0) {
      // 0 điểm vẫn phải recalc: đơn DELIVERED đầu tiên (dù 0 điểm) là lúc DUY NHẤT user được
      // gán hạng lần đầu (recalcAllTiers chỉ quét user ĐÃ có tierId). Bail sớm mà không recalc
      // sẽ khiến user kẹt vĩnh viễn không có tier — xem candidate 2 trong audit loyalty.
      await this.recalcTier(order.userId);
      return;
    }
    const reason = `ORDER_DELIVERED:${order.code}`;

    const existed = await this.prisma.pointsTransaction.findFirst({
      where: { userId: order.userId, reason },
    });
    if (existed) {
      // Đã cộng điểm ở lần gọi trước nhưng có thể đã crash TRƯỚC KHI recalcTier (dòng cuối
      // hàm này) kịp chạy — recalc lại ở đây để không kẹt vĩnh viễn không có tier.
      await this.recalcTier(order.userId);
      return;
    }

    const expireMonths = await this.config.get<number>('loyalty.point_expire_months', 12);
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + expireMonths);

    try {
      await this.prisma.$transaction([
        this.prisma.pointsTransaction.create({
          data: {
            userId: order.userId,
            delta: order.pointsEarned,
            reason,
            refType: 'ORDER',
            refId: order.id,
            expiresAt,
          },
        }),
        this.prisma.user.update({
          where: { id: order.userId },
          data: { pointsBalance: { increment: order.pointsEarned } },
        }),
      ]);
    } catch (err) {
      // Partial unique (reason, refId) chặn double-credit — caller thua race ăn P2002 → no-op.
      // CHỈ coi idempotent skip nếu P2002 ĐÚNG là index credit này: re-query thấy bản ghi reason
      // đã tồn tại (kẻ thắng race đã commit). P2002 từ constraint KHÁC (vd unique mới thêm sau này
      // trên cùng tx) → bản ghi reason vẫn chưa có → re-throw, KHÔNG nuốt lỗi thật làm mất điểm âm thầm.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const already = await this.prisma.pointsTransaction.findFirst({
          where: { userId: order.userId, reason },
          select: { id: true },
        });
        if (already) {
          this.logger.debug(`creditOrderPoints idempotent skip order=${order.code}`);
          // Kẻ thắng race đã commit điểm nhưng có thể chưa/không kịp recalcTier — recalc ở
          // đây để bail idempotent không kéo theo mất tier vĩnh viễn.
          await this.recalcTier(order.userId);
          return;
        }
        this.logger.error(
          `creditOrderPoints P2002 KHÔNG khớp idempotency (reason=${reason}) order=${order.code} — re-throw`,
        );
      }
      throw err;
    }
    await this.recalcTier(order.userId);
  }

  /**
   * Hoàn ngược khi hủy/trả: trừ điểm đã tích, hoàn lại điểm đã tiêu.
   *
   * RACE: 2 caller song song (orders.cancel + webhook RETURNED) trước đây cùng
   * findFirst NGOÀI tx → cùng thấy chưa reverse → cùng cộng/trừ → DOUBLE.
   * Fix: di chuyển ALL check + write VÀO 1 transaction; relies on
   * unique partial index (reason, refId) để insert thứ 2 P2002 → bail idempotent.
   * Migration 20260623000000_loyalty_reverse_unique tạo unique index.
   */
  async reverseOrderPoints(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    try {
      await this.prisma.$transaction(async (tx) => {
        // Re-check trong tx để giảm xác suất chạy ops vô ích; unique index là guard cứng.
        const reversed = await tx.pointsTransaction.findFirst({
          where: {
            userId: order.userId,
            refId: order.id,
            reason: { in: [`ORDER_REVERSED:${order.code}`, `ORDER_REFUND_POINTS:${order.code}`] },
          },
          select: { id: true },
        });
        if (reversed) return;

        // pointsEarned CHỈ được cộng khi đơn DELIVERED (xem creditOrderPoints).
        // Nếu user hủy đơn CONFIRMED (chưa giao), điểm chưa cộng → KHÔNG trừ.
        const wasCredited = order.pointsEarned > 0
          ? Boolean(
              await tx.pointsTransaction.findFirst({
                where: { userId: order.userId, reason: `ORDER_DELIVERED:${order.code}` },
                select: { id: true },
              }),
            )
          : false;

        if (wasCredited) {
          // create() trước user.update — nếu duplicate caller chạy đồng thời, P2002
          // bay ra TRƯỚC khi balance bị decrement lần 2 (xem catch ngoài tx).
          await tx.pointsTransaction.create({
            data: {
              userId: order.userId,
              delta: -order.pointsEarned,
              reason: `ORDER_REVERSED:${order.code}`,
              refType: 'ORDER',
              refId: order.id,
            },
          });
          await tx.user.update({
            where: { id: order.userId },
            data: { pointsBalance: { decrement: order.pointsEarned } },
          });
        }
        if (order.pointsUsed > 0) {
          await tx.pointsTransaction.create({
            data: {
              userId: order.userId,
              delta: order.pointsUsed,
              reason: `ORDER_REFUND_POINTS:${order.code}`,
              refType: 'ORDER',
              refId: order.id,
            },
          });
          await tx.user.update({
            where: { id: order.userId },
            data: { pointsBalance: { increment: order.pointsUsed } },
          });
        }
      });
    } catch (err) {
      // Unique partial index (reason, refId) trên points_transactions chặn double-reverse —
      // 2 caller song song: 1 thắng commit, 1 bị P2002 → coi như idempotent no-op.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.logger.debug(`reverseOrderPoints idempotent skip order=${order.code}`);
        return;
      }
      throw err;
    }
  }

  /**
   * Tính lại hạng theo điểm tích lũy HOẶC chi tiêu 12 tháng (chọn hạng cao nhất đạt).
   *
   * `preloadedTiers` cho phép caller chạy batch (vd recalcAllTiers) truyền sẵn danh sách hạng
   * đã load 1 lần thay vì để mỗi lần gọi tự findMany lại — tránh N+1 query khi quét N user.
   * Bỏ trống thì tự load (giữ hành vi cũ cho caller đơn lẻ như creditOrderPoints).
   */
  async recalcTier(userId: string, preloadedTiers?: MembershipTier[]): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const tiers =
      preloadedTiers ?? (await this.prisma.membershipTier.findMany({ orderBy: { sortOrder: 'asc' } }));

    const since = new Date();
    since.setMonth(since.getMonth() - 12);
    // Đơn trả bằng TubuXu (tín dụng tự-fund) KHÔNG tính vào chi tiêu lên hạng (mặc định) — nhất quán
    // với việc đơn XU không sinh điểm (checkout). Tránh khuếch đại: đổi Ví→xu ×1.2 rồi tiêu để lên
    // hạng rẻ tiền. Lật cùng config loyalty.earn_points_on_xu=true thì XU lại được tính cả điểm lẫn hạng.
    const earnOnXu = (await this.config.get<boolean>('loyalty.earn_points_on_xu', false)) === true;
    const spentAgg = await this.prisma.order.aggregate({
      where: {
        userId,
        status: 'DELIVERED',
        createdAt: { gte: since },
        ...(earnOnXu ? {} : { paymentMethod: { not: 'XU' } }),
      },
      _sum: { total: true },
    });
    const spent12m = spentAgg._sum.total ?? 0;

    // Hạng xét theo điểm ĐÃ TÍCH trong 12 tháng, KHÔNG phải số dư còn lại. Trước đây dùng
    // `user.pointsBalance`: tiêu điểm lúc thanh toán (hoặc điểm hết hạn) kéo số dư xuống dưới
    // mốc → hết ân hạn là bị hạ hạng, mất ×1,5 điểm + freeship. Dùng đúng loyalty currency lại
    // bị phạt, trong khi doc-comment và FE ("từ X điểm") đều mô tả là điểm TÍCH LUỸ
    // (P2, docs/2026-09-08-review-progress.md). Cùng cửa sổ 12 tháng với tiêu chí chi tiêu nên
    // hạng vẫn phản ánh mức độ hoạt động gần đây, không thành hạng vĩnh viễn.
    // CHỈ điểm từ đơn đã giao (trừ phần đơn đó bị trả/huỷ) — xem tierPoints.
    const earned12m = await this.tierPoints(userId, since);

    let qualified = tiers[0];
    for (const t of tiers) {
      const byPoints = earned12m >= t.minPoints;
      const bySpending = t.minSpending != null && spent12m >= t.minSpending;
      if (byPoints || bySpending) qualified = t;
    }
    if (!qualified) return;

    // Lên hạng áp ngay; RỚT hạng có ân hạn (config loyalty.tier_grace_days) để không
    // tụt hạng đột ngột khi điểm/chi tiêu 12 tháng vừa rớt mốc.
    const graceDays = await this.config.get<number>('loyalty.tier_grace_days', 30);
    const decision = decideTier({
      currentTierId: user.tierId,
      tiers: tiers.map((t) => ({ id: t.id, sortOrder: t.sortOrder })),
      qualifiedId: qualified.id,
      graceUntil: user.tierGraceUntil,
      now: new Date(),
      graceDays,
    });
    const graceChanged = (decision.graceUntil?.getTime() ?? null) !== (user.tierGraceUntil?.getTime() ?? null);
    if (decision.tierId !== user.tierId || graceChanged) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { tierId: decision.tierId, tierGraceUntil: decision.graceUntil },
      });
    }
  }

  /**
   * Cron nightly: tính lại hạng cho mọi user ĐÃ có hạng — nơi DUY NHẤT thực sự áp rớt hạng
   * sau khi hết ân hạn (sự kiện đơn hàng chỉ chạy lẻ tẻ). User chưa có hạng sẽ được gán
   * hạng ở đơn DELIVERED đầu tiên nên không cần quét. Lỗi 1 user không chặn người khác.
   */
  async recalcAllTiers(): Promise<number> {
    // Load tiers 1 LẦN cho cả batch — trước đây mỗi recalcTier tự findMany lại → N+1 query
    // thật sự khi quét hàng nghìn user/đêm. Danh sách hạng gần như tĩnh, không cần fresh mỗi user.
    const tiers = await this.prisma.membershipTier.findMany({ orderBy: { sortOrder: 'asc' } });
    // Phân trang bằng cursor: `findMany` không giới hạn nạp TOÀN BỘ thành viên có hạng vào RAM
    // ngay dòng đầu. Với vài trăm nghìn thành viên, job bắt đầu 03:15 có thể chạy sang tận sáng
    // và chồng lên lần chạy đêm sau (@Cron không tự chặn overlap).
    let processed = 0;
    let cursor: string | undefined;
    for (let page = 0; page < LoyaltyService.RECALC_MAX_PAGES; page++) {
      const users = await this.prisma.user.findMany({
        where: { tierId: { not: null } },
        orderBy: { id: 'asc' },
        take: LoyaltyService.RECALC_PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true },
      });
      if (users.length === 0) break;
      cursor = users[users.length - 1]!.id;
      for (const u of users) {
        await this.recalcTier(u.id, tiers).catch((e) => this.logger.warn(`recalcTier lỗi user=${u.id}: ${(e as Error).message}`));
        processed++;
      }
      if (users.length < LoyaltyService.RECALC_PAGE) break;
    }
    return processed;
  }

  /**
   * "Điểm xét hạng" 12 tháng — WHITELIST: chỉ điểm tích từ đơn online ĐÃ GIAO (dòng
   * `ORDER_DELIVERED:<code>`, creditOrderPoints) có trong cửa sổ, TRỪ dòng `ORDER_REVERSED:<code>`
   * của CHÍNH các đơn đó (reverseOrderPoints — cùng refId = order.id) khi đơn bị trả/huỷ.
   *
   * Hạng là hạng theo CHI TIÊU: seed đặt minPoints đúng bằng minSpending / loyalty.vnd_per_point
   * (500 điểm ↔ 5 triệu, 2.000 ↔ 20 triệu, 5.000 ↔ 50 triệu), nên điểm chỉ là thước đo thay cho
   * tiền đã mua. Bản blacklist trước đây (loại DAILY_CHECKIN/POS_OFFLINE_ORDER/ORDER_REFUND_POINTS)
   * vẫn đếm mọi nguồn mới thêm sau: GAME_SPIN_WIN (quay vòng quay = đổi số dư thành điểm hạng),
   * REVIEW, SEASONPASS…, và bỏ qua ORDER_REVERSED nên mua → giao → trả hàng vẫn giữ nguyên điểm hạng.
   *
   * THAY ĐỔI HÀNH VI (2026-09-27): điểm game, đánh giá, season pass, điểm danh, POS KHÔNG còn tính
   * vào xét hạng — vẫn là Điểm Xanh tiêu được bình thường. Nguồn mới muốn tính hạng phải được thêm
   * vào đây một cách có chủ đích.
   *
   * Chỉ khớp ORDER_REVERSED theo đơn có dòng giao TRONG cửa sổ: đơn giao trước cửa sổ (điểm giao
   * không còn được tính) bị trả trong cửa sổ không trừ lần nữa.
   */
  private async tierPoints(userId: string, since: Date): Promise<number> {
    const delivered = await this.prisma.pointsTransaction.findMany({
      where: {
        userId,
        reason: { startsWith: TIER_DELIVERED_PREFIX },
        delta: { gt: 0 },
        createdAt: { gte: since },
      },
      select: { refId: true, delta: true },
    });
    if (delivered.length === 0) return 0;
    const earned = delivered.reduce((s, r) => s + r.delta, 0);
    const orderIds = [...new Set(delivered.map((r) => r.refId).filter((id): id is string => !!id))];
    if (orderIds.length === 0) return earned;
    const reversed = await this.prisma.pointsTransaction.aggregate({
      where: { userId, reason: { startsWith: TIER_REVERSED_PREFIX }, refId: { in: orderIds } },
      _sum: { delta: true },
    });
    // Dòng ORDER_REVERSED ghi delta ÂM (= -pointsEarned) → cộng vào là trừ đi.
    return Math.max(0, earned + (reversed._sum.delta ?? 0));
  }

  /**
   * Điểm Xanh CHƯA được đổi quà vì còn có thể bị đảo: điểm `ORDER_DELIVERED` của đơn
   *  - còn trong cửa sổ đổi/trả (`returns.window_days`, tính từ deliveredAt — cùng mốc
   *    OrdersService.requestReturn; đơn cũ thiếu deliveredAt dùng thời điểm cộng điểm), hoặc
   *  - đang có yêu cầu đổi/trả chờ duyệt (REQUESTED), hoặc
   *  - đã chuyển CANCELLED/RETURNED nhưng reverseOrderPoints chưa kịp trừ điểm,
   * và chưa có dòng ORDER_REVERSED. Lạm dụng mà hàm này chặn: nhận điểm đơn vừa giao → đổi ngay
   * voucher → trả hàng (điểm bị trừ lại, số dư có thể âm) nhưng voucher vẫn giữ.
   *
   * `db` = tx của redeemReward / CheckoutService.placeOrder khi dùng làm guard (đọc SAU khi đã khoá
   * dòng user), mặc định this.prisma cho màn hình tổng quan / báo giá checkout. Câu SQL thật được kiểm
   * ở test/integration-race. Public vì checkout tiêu điểm theo CÙNG luật (không tự viết lại SQL).
   */
  async lockedOrderPoints(
    userId: string,
    now: Date,
    db: Pick<Prisma.TransactionClient, '$queryRaw'> = this.prisma,
  ): Promise<LockedPoints> {
    const windowDays = await this.returnWindowDays();
    const cutoff = new Date(now.getTime() - windowDays * DAY_MS);
    const rows = await db.$queryRaw<{ delta: number; deliveredAt: Date; pendingReturn: boolean }[]>`
      SELECT pt."delta" AS "delta",
             COALESCE(o."deliveredAt", pt."createdAt") AS "deliveredAt",
             (o."status" <> 'DELIVERED' OR EXISTS (
               SELECT 1 FROM "return_requests" rr WHERE rr."orderId" = o."id" AND rr."status" = 'REQUESTED'
             )) AS "pendingReturn"
      FROM "points_transactions" pt
      JOIN "orders" o ON o."id" = pt."refId"
      WHERE pt."userId" = ${userId}
        AND pt."reason" LIKE 'ORDER_DELIVERED:%'
        AND pt."delta" > 0
        AND NOT EXISTS (
          SELECT 1 FROM "points_transactions" r
          WHERE r."userId" = pt."userId" AND r."refId" = pt."refId" AND r."reason" LIKE 'ORDER_REVERSED:%'
        )
        AND (
          COALESCE(o."deliveredAt", pt."createdAt") > ${cutoff}
          OR o."status" <> 'DELIVERED'
          OR EXISTS (SELECT 1 FROM "return_requests" rr WHERE rr."orderId" = o."id" AND rr."status" = 'REQUESTED')
        )`;
    let locked = 0;
    let lockedReturn = 0;
    let lockedUntil: Date | null = null;
    for (const r of rows) {
      const delta = Number(r.delta);
      locked += delta;
      if (r.pendingReturn) {
        lockedReturn += delta;
        continue;
      }
      const unlockAt = new Date(new Date(r.deliveredAt).getTime() + windowDays * DAY_MS);
      if (!lockedUntil || unlockAt > lockedUntil) lockedUntil = unlockAt;
    }
    return { locked, lockedReturn, lockedUntil };
  }

  /** returns.window_days (mặc định 7, cùng key/mặc định với OrdersService.requestReturn); sai kiểu → 7. */
  private async returnWindowDays(): Promise<number> {
    const v = Number(await this.config.get<number>('returns.window_days', 7));
    return Number.isFinite(v) && v >= 0 ? v : 7;
  }

  /** Câu giải thích vì sao 1 phần Điểm Xanh chưa dùng được (lỗi redeemReward + checkout tiêu điểm). */
  lockedPointsMessage(lock: LockedPoints): string {
    const parts: string[] = [];
    const inWindow = lock.locked - lock.lockedReturn;
    if (inWindow > 0 && lock.lockedUntil) {
      parts.push(
        `${inWindow} điểm từ đơn mới giao sẽ dùng được sau ngày ${vnDateLabel(lock.lockedUntil)} (hết hạn đổi/trả hàng)`,
      );
    }
    if (lock.lockedReturn > 0) {
      parts.push(`${lock.lockedReturn} điểm từ đơn đang chờ xử lý đổi/trả sẽ dùng được khi yêu cầu được xử lý xong`);
    }
    return parts.join('; ');
  }

  /** Multiplier điểm của hạng hiện tại (1 nếu chưa có hạng). */
  async getTierMultiplier(tierId?: string | null): Promise<number> {
    if (!tierId) return 1;
    const tier = await this.prisma.membershipTier.findUnique({ where: { id: tierId } });
    return tier ? Number(tier.pointMultiplier) : 1;
  }

  /** Tổng quan loyalty: hạng hiện tại, multiplier, tiến độ lên hạng kế tiếp. */
  async getOverview(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { tier: true },
    });
    const tiers = await this.prisma.membershipTier.findMany({ orderBy: { sortOrder: 'asc' } });
    // Mọi user mặc định ở hạng thấp nhất (Mầm Xanh, minPoints 0) — tierId chỉ được gán khi có
    // đơn DELIVERED đầu tiên, nên user mới chưa có tier. Hiển thị hạng nền để trang loyalty đúng.
    const current = user.tier ?? tiers[0] ?? null;
    const currentSort = current?.sortOrder ?? -1;
    const next = tiers.find((t) => t.sortOrder > currentSort);
    // "Còn X điểm để lên hạng" phải tính theo ĐÚNG điểm mà recalcTier xét (điểm tích từ mua hàng
    // 12 tháng), không theo số dư: số dư có cả điểm danh/POS — hiển thị theo số dư sẽ hứa lên hạng
    // mà backend không bao giờ cho.
    const since = new Date();
    since.setMonth(since.getMonth() - 12);
    const tierPoints = await this.tierPoints(userId, since);
    const lock = await this.lockedOrderPoints(userId, new Date());

    return {
      pointsBalance: user.pointsBalance,
      tierPoints,
      // Phần Điểm Xanh chưa đổi quà được vì đơn còn có thể bị trả hàng (xem lockedOrderPoints).
      lockedPoints: lock.locked,
      /** Phần khoá thuộc đơn đang có yêu cầu đổi/trả (mở khoá khi yêu cầu được xử lý, không theo ngày). */
      lockedReturnPoints: lock.lockedReturn,
      /** Mốc muộn nhất phần khoá theo cửa sổ đổi/trả được mở (null nếu không có). */
      lockedUntil: lock.lockedUntil?.toISOString() ?? null,
      redeemablePoints: Math.max(0, user.pointsBalance - lock.locked),
      tier: current
        ? {
            id: current.id,
            name: current.name,
            multiplier: Number(current.pointMultiplier),
            perks: current.perks,
          }
        : null,
      nextTier: next
        ? {
            id: next.id,
            name: next.name,
            minPoints: next.minPoints,
            pointsToGo: Math.max(0, next.minPoints - tierPoints),
          }
        : null,
      tiers: tiers.map((t) => ({
        id: t.id,
        name: t.name,
        minPoints: t.minPoints,
        multiplier: Number(t.pointMultiplier),
      })),
    };
  }

  getPointsTransactions(userId: string) {
    return this.prisma.pointsTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Coupon khả dụng cho user: PUBLIC + đúng hạng, còn hạn, chưa hết lượt cá nhân. */
  async getAvailableCoupons(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const now = new Date();
    const coupons = await this.prisma.coupon.findMany({
      where: { startAt: { lte: now }, endAt: { gte: now } },
    });

    // Pre-filter theo scope trước, rồi 1 groupBy duy nhất đếm used count cho mọi coupon.
    // Trước đây loop từng coupon gọi count() → 1 + N query khi user có nhiều voucher khả dụng.
    // Điều kiện scope dùng CHUNG isCouponEligible với CouponsService.assertScopeOwnership
    // (validate/redeem) để list & apply KHÔNG lệch (coupon hiện mà redeem fail).
    const filtered = coupons.filter((c) => isCouponEligible(c, user));

    const ids = filtered.map((c) => c.id);
    const grouped = ids.length
      ? await this.prisma.couponRedemption.groupBy({
          by: ['couponId'],
          where: { userId, couponId: { in: ids } },
          _count: { _all: true },
        })
      : [];
    const usedMap = new Map(grouped.map((g) => [g.couponId, g._count._all]));

    const result = [];
    for (const c of filtered) {
      const used = usedMap.get(c.id) ?? 0;
      // perUserLimit <= 0 = không giới hạn (nhất quán với coupons.service.ts validateAndCompute
      // và redeem()) — thiếu guard này trước đây ẩn vĩnh viễn coupon perUserLimit=0 khỏi danh sách.
      if (c.perUserLimit > 0 && used >= c.perUserLimit) continue;
      result.push({
        code: c.code,
        type: c.type,
        value: c.value,
        minOrder: c.minOrder,
        maxDiscount: c.maxDiscount,
        endAt: c.endAt,
      });
    }
    return result;
  }

  /** Danh mục phần thưởng đổi bằng Điểm Xanh (Reward Catalog). */
  async getRewardCatalog(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // canRedeem theo điểm DÙNG ĐƯỢC (cùng quy tắc guard của redeemReward), không theo số dư —
    // không thì nút "Đổi ngay" sáng mà bấm vào bị từ chối.
    const lock = await this.lockedOrderPoints(userId, new Date());
    const redeemable = Math.max(0, user.pointsBalance - lock.locked);
    return {
      pointsBalance: user.pointsBalance,
      lockedPoints: lock.locked,
      redeemablePoints: redeemable,
      rewards: DEFAULT_REWARD_CATALOG.map((r) => ({
        ...r,
        canRedeem: redeemable >= r.pointsCost,
      })),
    };
  }

  /**
   * Đổi Điểm Xanh lấy Voucher cá nhân (HSD 30 ngày).
   *
   * RACE: bản WIP đọc số dư trong tx (READ COMMITTED, không khoá) rồi decrement vô điều kiện →
   * 5 request song song với 100 điểm cùng đọc 100, cùng trừ → số dư -400 và 5 voucher 100k.
   * Fix: GIÀNH điểm bằng 1 câu updateMany có guard `pointsBalance >= giá` (atomic, cùng mẫu
   * checkout.service.ts / game creditPoints) — count=0 là không đủ điểm, không ghi gì thêm.
   * Coupon + dòng ledger chỉ tạo SAU khi đã giành được điểm, trong cùng transaction.
   *
   * CHỈ điểm không còn bị đảo được mới đổi được (lockedOrderPoints): đổi voucher bằng điểm đơn vừa
   * giao rồi trả hàng là giữ voucher miễn phí. Phần khoá tính TRONG tx rồi đưa thẳng vào guard
   * (`pointsBalance >= giá + khoá`). Khoá dòng user (FOR UPDATE) TRƯỚC khi tính: creditOrderPoints/
   * reverseOrderPoints đều ghi dòng ledger + cập nhật số dư của CHÍNH dòng user này, nên sau khoá,
   * phần khoá và số dư được đọc nhất quán (không lọt điểm của đơn vừa giao commit chen giữa 2 câu).
   */
  async redeemReward(userId: string, rewardId: string) {
    const reward = DEFAULT_REWARD_CATALOG.find((r) => r.id === rewardId);
    if (!reward) {
      throw new NotFoundException(`Phần thưởng "${rewardId}" không tồn tại.`);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
      const lock = await this.lockedOrderPoints(userId, new Date(), tx);
      const dec = await tx.user.updateMany({
        where: { id: userId, pointsBalance: { gte: reward.pointsCost + lock.locked } },
        data: { pointsBalance: { decrement: reward.pointsCost } },
      });
      if (dec.count === 0) {
        const cur = await tx.user.findUnique({ where: { id: userId }, select: { pointsBalance: true } });
        const balance = cur?.pointsBalance ?? 0;
        if (lock.locked > 0 && balance >= reward.pointsCost) {
          const usable = Math.max(0, balance - lock.locked);
          throw new BadRequestException(
            `Bạn cần ${reward.pointsCost} Điểm Xanh dùng được để đổi ưu đãi này — hiện dùng được ${usable}/${balance} điểm: ${this.lockedPointsMessage(lock)}.`,
          );
        }
        throw new BadRequestException(
          `Bạn cần ${reward.pointsCost} Điểm Xanh để đổi ưu đãi này (hiện có ${balance} điểm).`,
        );
      }

      const endAt = new Date();
      endAt.setDate(endAt.getDate() + 30);
      const coupon = await tx.coupon.create({
        data: {
          code: rewardCouponCode(reward),
          type: reward.type,
          value: reward.value,
          minOrder: reward.minOrder ?? null,
          maxDiscount: reward.maxDiscount ?? null,
          startAt: new Date(),
          endAt,
          usageLimit: 1,
          perUserLimit: 1,
          scope: 'USER_GROUP',
          scopeMeta: { userId },
        },
      });

      await tx.pointsTransaction.create({
        data: {
          userId,
          delta: -reward.pointsCost,
          reason: `LOYALTY_REDEEM_VOUCHER:${reward.id}`,
          refType: 'REWARD',
          refId: coupon.id,
        },
      });

      // Đọc lại số dư THẬT sau khi trừ (request khác có thể vừa cộng/trừ song song).
      const after = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } });

      return {
        success: true,
        message: `Đổi thành công ${reward.title}!`,
        pointsSpent: reward.pointsCost,
        remainingPoints: after.pointsBalance,
        coupon: {
          code: coupon.code,
          type: coupon.type,
          value: coupon.value,
          minOrder: coupon.minOrder,
          maxDiscount: coupon.maxDiscount,
          endAt: coupon.endAt,
        },
      };
    });
  }

  // ───────────────────────── Điểm danh hằng ngày ─────────────────────────

  /** Ngày theo giờ Việt Nam (UTC+7, không có DST) dạng 'YYYY-MM-DD'. */
  private getVnDayKey(d: Date): string {
    return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }

  /** Hạn dùng cho điểm mới cộng — cùng quy tắc loyalty.point_expire_months như creditOrderPoints. */
  private async pointsExpiresAt(from: Date): Promise<Date> {
    const raw = await this.config.get<number>('loyalty.point_expire_months', 12);
    const months = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 12;
    const d = new Date(from.getTime());
    d.setMonth(d.getMonth() + months);
    return d;
  }

  /** Số dương từ SystemConfig; sai kiểu/≤0 (admin gõ nhầm) → mặc định an toàn + cảnh báo. */
  private async positiveConfig(key: string, fallback: number): Promise<number> {
    const v = await this.config.get<number>(key, fallback);
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      this.logger.warn(`SystemConfig ${key}=${JSON.stringify(v)} không hợp lệ → dùng mặc định ${fallback}`);
      return fallback;
    }
    return v;
  }

  /**
   * Bảng điểm 7 ngày (SystemConfig `loyalty.checkin_points`, mặc định DEFAULT_CHECKIN_POINTS).
   * Chỉ nhận đúng 7 số nguyên 0..CHECKIN_MAX_POINTS_PER_DAY — gõ nhầm "1000" không biến nút
   * điểm danh thành máy in tiền; sai định dạng thì quay về bảng mặc định.
   */
  private async getCheckInPointsTable(): Promise<number[]> {
    const raw = await this.config.get<unknown>('loyalty.checkin_points', DEFAULT_CHECKIN_POINTS);
    const valid =
      Array.isArray(raw) &&
      raw.length === 7 &&
      raw.every((v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= CHECKIN_MAX_POINTS_PER_DAY);
    if (!valid) {
      this.logger.warn(`SystemConfig loyalty.checkin_points=${JSON.stringify(raw)} không hợp lệ → dùng mặc định`);
      return [...DEFAULT_CHECKIN_POINTS];
    }
    return raw as number[];
  }

  /**
   * Ngày trong vòng 7 ngày + chuỗi của LẦN ĐIỂM DANH KẾ TIẾP. Dùng chung cho status và
   * dailyCheckIn để ô "hôm nay" hiển thị luôn đúng là ô sẽ được trả thưởng (bản WIP lệch 1 ngày:
   * hiển thị N3 +20 nhưng bấm lại trả N4 +25; N7 🎁 nhưng trả N1).
   */
  private nextCheckIn(
    last: { dayKey: string; cycleDay: number; streakDays: number } | null,
    now: Date,
  ): { cycleDay: number; streakDays: number } {
    const yesterday = this.getVnDayKey(new Date(now.getTime() - DAY_MS));
    if (last && last.dayKey === yesterday) {
      return { cycleDay: (last.cycleDay % 7) + 1, streakDays: last.streakDays + 1 };
    }
    return { cycleDay: 1, streakDays: 1 };
  }

  private lastCheckIn(userId: string) {
    return this.prisma.loyaltyCheckIn.findFirst({ where: { userId }, orderBy: { dayKey: 'desc' } });
  }

  /** Trạng thái điểm danh chuỗi 7 ngày (chỉ ĐỌC; không đụng game_profiles). */
  async getDailyCheckInStatus(userId: string) {
    const now = new Date();
    const today = this.getVnDayKey(now);
    const [table, last] = await Promise.all([this.getCheckInPointsTable(), this.lastCheckIn(userId)]);
    const checkedInToday = last?.dayKey === today;

    let currentCycleDay: number;
    let streakDays: number;
    if (last && checkedInToday) {
      currentCycleDay = Math.min(7, Math.max(1, last.cycleDay));
      streakDays = last.streakDays;
    } else {
      const next = this.nextCheckIn(last, now);
      currentCycleDay = next.cycleDay;
      streakDays = next.streakDays - 1; // chuỗi còn sống = chuỗi hôm qua; đứt = 0
    }

    return {
      checkedInToday,
      streakDays,
      currentCycleDay,
      /** Điểm của ô hôm nay: đã nhận (nếu đã điểm danh) hoặc sẽ nhận khi bấm. */
      todayPoints: table[currentCycleDay - 1] ?? 0,
      rewards: table.map((points, idx) => ({
        day: idx + 1,
        points,
        claimed: checkedInToday ? idx + 1 <= currentCycleDay : idx + 1 < currentCycleDay,
        isToday: idx + 1 === currentCycleDay,
      })),
    };
  }

  /**
   * Điểm danh nhận Điểm Xanh — tối đa 1 lần/user/ngày giờ VN.
   *
   * Trạng thái nằm ở bảng RIÊNG loyalty_check_ins (không dùng GameProfile như bản WIP — xem doc
   * model LoyaltyCheckIn). Thứ tự trong transaction là chốt chặn race: INSERT dòng điểm danh
   * (unique userId+dayKey) TRƯỚC, rồi mới ghi ledger + cộng số dư. 10 request song song → 1 cái
   * insert được, 9 cái ăn P2002 và bị rollback trước khi cộng điểm. Dòng ledger còn có partial
   * unique (userId, refId=dayKey) WHERE refType='CHECKIN' làm lớp phòng thủ thứ hai.
   *
   * Điểm điểm danh có hạn (loyalty.point_expire_months) và KHÔNG tính vào xét hạng.
   */
  async dailyCheckIn(userId: string) {
    const now = new Date();
    const today = this.getVnDayKey(now);
    const last = await this.lastCheckIn(userId);
    if (last?.dayKey === today) {
      throw new BadRequestException(CHECKIN_ALREADY_MESSAGE);
    }

    const { cycleDay, streakDays } = this.nextCheckIn(last, now);
    const table = await this.getCheckInPointsTable();
    const points = table[cycleDay - 1] ?? 0;
    const expiresAt = await this.pointsExpiresAt(now);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.loyaltyCheckIn.create({ data: { userId, dayKey: today, cycleDay, streakDays, points } });

        let totalPoints: number;
        if (points > 0) {
          await tx.pointsTransaction.create({
            data: {
              userId,
              delta: points,
              reason: `DAILY_CHECKIN:DAY_${cycleDay}`,
              refType: 'CHECKIN',
              refId: today,
              expiresAt,
            },
          });
          const u = await tx.user.update({
            where: { id: userId },
            data: { pointsBalance: { increment: points } },
            select: { pointsBalance: true },
          });
          totalPoints = u.pointsBalance;
        } else {
          const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } });
          totalPoints = u.pointsBalance;
        }

        // Task 9: điểm danh xong → engagement_action, atomic CÙNG tx (analytics optional — xem
        // ghi chú constructor).
        await this.analytics?.record(tx, {
          eventName: 'engagement_action',
          userId,
          platform: 'miniapp',
          props: { action: 'loyalty_checkin', cycleDay, streakDays, pointsEarned: points },
        });

        return {
          success: true,
          cycleDay,
          streakDays,
          pointsEarned: points,
          totalPoints,
          message:
            points > 0
              ? `Điểm danh Ngày ${cycleDay} thành công! Nhận +${points} Điểm Xanh.`
              : `Điểm danh Ngày ${cycleDay} thành công!`,
        };
      });
    } catch (err) {
      // P2002 = request song song khác đã điểm danh hôm nay (unique loyalty_check_ins hoặc
      // partial unique CHECKIN trên ledger) — transaction này đã rollback, không cộng gì.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(CHECKIN_ALREADY_MESSAGE);
      }
      throw err;
    }
  }

  // ───────────────────────── Thẻ thành viên & POS ─────────────────────────

  /**
   * Thông tin Thẻ thành viên số (Digital Member Card).
   *
   * memberCode = "TUBU" + referralCode — referralCode là mã DUY NHẤT (unique), sinh ngẫu nhiên,
   * có sẵn cho mọi user, nên tra ngược CHÍNH XÁC được về đúng 1 người. Bản WIP dùng 6 số cuối
   * SĐT (trùng nhau giữa khách) + mã vạch "893…" giả mà endpoint quét không hề nhận; QR payload
   * chứa SĐT đầy đủ + userId. Giờ: FE vẽ QR của đúng chuỗi memberCode, endpoint quét nhận đúng
   * chuỗi đó — một payload chuẩn duy nhất.
   */
  async getMemberCard(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { tier: true },
    });
    const posCreditEnabled = (await this.config.get<boolean>('loyalty.pos_credit_enabled', false)) === true;

    return {
      memberCode: memberCodeOf(user.referralCode),
      name: user.fullName ?? 'Thành viên Tubu',
      phone: maskPhone(user.phone),
      tierName: user.tier?.name ?? 'Mầm Xanh',
      tierMultiplier: user.tier ? Number(user.tier.pointMultiplier) : 1,
      pointsBalance: user.pointsBalance,
      /** false → FE KHÔNG hứa "tích điểm tại quầy" (tính năng đang tắt ở backend). */
      posCreditEnabled,
    };
  }

  /** Người gọi phải là STAFF/ADMIN theo DB (JWT có thể còn role cũ sau khi bị hạ quyền) và không bị khoá. */
  private async assertPosStaff(staffUserId: string) {
    const staff = await this.prisma.user.findUniqueOrThrow({
      where: { id: staffUserId },
      select: { id: true, role: true, isBlocked: true },
    });
    if ((staff.role !== 'STAFF' && staff.role !== 'ADMIN') || staff.isBlocked) {
      throw new ForbiddenException('Chỉ nhân viên hoặc quản trị viên mới có quyền quét thẻ thành viên.');
    }
    return staff;
  }

  /**
   * Tra CHÍNH XÁC thành viên từ chuỗi quét/gõ tại quầy: "TUBU"+mã, mã giới thiệu trần, hoặc SĐT
   * đầy đủ (84…/+84… chuẩn hoá về 0…). KHÔNG endsWith, KHÔNG theo id. Chuỗi rỗng/quá ngắn bị từ
   * chối trước khi chạm DB; khớp > 1 người → 409 (không chọn bừa người nhận điểm).
   */
  private async resolveMember(raw: string) {
    const { phone, codes } = parseMemberCode(raw);
    const or: Prisma.UserWhereInput[] = [];
    if (phone) or.push({ phone });
    if (codes.length > 0) or.push({ referralCode: { in: codes } });

    const found = await this.prisma.user.findMany({ where: { OR: or }, take: 2, include: { tier: true } });
    if (found.length === 0) {
      throw new NotFoundException('Không tìm thấy thành viên với mã này.');
    }
    if (found.length > 1) {
      throw new ConflictException(
        'Mã này khớp nhiều hơn 1 thành viên — hãy quét mã QR trên thẻ hoặc nhập SĐT đầy đủ của khách.',
      );
    }
    return found[0]!;
  }

  private memberSummary(member: {
    id: string;
    referralCode: string;
    fullName: string | null;
    phone: string | null;
    pointsBalance: number;
    tier?: { name: string } | null;
  }) {
    return {
      id: member.id,
      memberCode: memberCodeOf(member.referralCode),
      name: member.fullName ?? 'Thành viên Tubu',
      phone: maskPhone(member.phone),
      tier: member.tier?.name ?? 'Mầm Xanh',
      pointsBalance: member.pointsBalance,
    };
  }

  /** Nhân viên / Quầy tra cứu thành viên (CHỈ tra cứu — cộng điểm đi creditPosPoints). */
  async lookupMemberByStaff(staffUserId: string, memberCode: string) {
    await this.assertPosStaff(staffUserId);
    const member = await this.resolveMember(memberCode);
    return { member: this.memberSummary(member) };
  }

  /**
   * Nhân viên tích điểm cho hoá đơn tại quầy (POS).
   *
   * Bản WIP: không trần, không idempotency, không ghi ai cộng, nhân viên tự cộng cho mình được,
   * tỷ lệ hard-code 10.000đ. Giờ:
   *  - Mặc định TẮT (`loyalty.pos_credit_enabled`=false) cho tới khi có màn thu ngân + nghiệp vụ duyệt.
   *  - Role STAFF/ADMIN theo DB, không bị khoá; KHÔNG tự tích cho chính mình.
   *  - receiptId = khoá idempotency (unique pos_point_credits.receiptId): gửi lại cùng hoá đơn →
   *    trả kết quả cũ; cùng mã mà khác thành viên/số tiền → 409.
   *  - Trần: mỗi hoá đơn `loyalty.pos_max_order_total`; mỗi ngày theo nhân viên
   *    `loyalty.pos_staff_daily_points_cap` và theo thành viên `loyalty.pos_member_daily_points_cap`.
   *    Cộng dồn + ghi chạy dưới pg_advisory_xact_lock để 2 hoá đơn song song không cùng đọc tổng cũ.
   *  - Tỷ lệ theo loyalty.vnd_per_point × hệ số hạng (như đơn online); điểm có hạn
   *    loyalty.point_expire_months; KHÔNG tính vào xét hạng (xem tierPointsWhere).
   *  - Sổ audit: pos_point_credits (staffUserId, memberId, receiptId, orderTotal, points, note).
   */
  async creditPosPoints(
    staffUserId: string,
    dto: { memberCode: string; orderTotal: number; receiptId: string; note?: string },
  ) {
    const staff = await this.assertPosStaff(staffUserId);
    const enabled = (await this.config.get<boolean>('loyalty.pos_credit_enabled', false)) === true;
    if (!enabled) {
      throw new ForbiddenException('Tính năng tích điểm tại quầy (POS) đang tắt. Liên hệ quản trị viên.');
    }

    const receiptId = (dto.receiptId ?? '').trim();
    if (!receiptId) throw new BadRequestException('Thiếu mã hoá đơn POS.');
    // Chốt lại ở service (không chỉ dựa DTO) vì service có thể được gọi trực tiếp.
    if (!Number.isInteger(dto.orderTotal) || dto.orderTotal < 1000 || dto.orderTotal > POS_ORDER_TOTAL_HARD_MAX) {
      throw new BadRequestException('Tổng tiền hoá đơn không hợp lệ.');
    }

    const member = await this.resolveMember(dto.memberCode);
    if (member.id === staff.id) {
      throw new ForbiddenException('Nhân viên không được tự tích điểm cho chính mình.');
    }
    if (member.isBlocked) {
      throw new BadRequestException('Tài khoản thành viên đang bị khoá, không thể tích điểm.');
    }

    const [maxOrderTotal, staffCap, memberCap, vndPerPoint] = await Promise.all([
      this.positiveConfig('loyalty.pos_max_order_total', POS_DEFAULTS.maxOrderTotal),
      this.positiveConfig('loyalty.pos_staff_daily_points_cap', POS_DEFAULTS.staffDailyPoints),
      this.positiveConfig('loyalty.pos_member_daily_points_cap', POS_DEFAULTS.memberDailyPoints),
      this.positiveConfig('loyalty.vnd_per_point', 10000),
    ]);
    if (dto.orderTotal > maxOrderTotal) {
      throw new BadRequestException(
        `Hoá đơn vượt trần ${maxOrderTotal.toLocaleString('vi-VN')}đ cho mỗi lần tích điểm tại quầy — liên hệ quản trị viên.`,
      );
    }

    const multiplier = member.tier ? Number(member.tier.pointMultiplier) : 1;
    const points = Math.floor((dto.orderTotal / vndPerPoint) * multiplier);
    if (!(points > 0)) {
      throw new BadRequestException('Hoá đơn chưa đủ giá trị để tích điểm.');
    }

    const now = new Date();
    const dayKey = this.getVnDayKey(now);
    const expiresAt = await this.pointsExpiresAt(now);
    const note = dto.note?.trim() || null;

    type Outcome = { replay: PosPointCredit } | { credit: PosPointCredit; balance: number };
    let outcome: Outcome;
    try {
      outcome = await this.prisma.$transaction(async (tx): Promise<Outcome> => {
        // Tuần tự hoá MỌI lần tích POS (khối lượng thấp): "cộng dồn hôm nay rồi mới ghi" chỉ đúng
        // khi không có request nào khác chen giữa. Postgres tự nhả khoá khi transaction kết thúc.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('loyalty.pos_credit'))`;

        const existing = await tx.posPointCredit.findUnique({ where: { receiptId } });
        if (existing) return { replay: existing };

        const staffAgg = await tx.posPointCredit.aggregate({
          where: { staffUserId: staff.id, dayKey },
          _sum: { points: true },
        });
        const staffToday = staffAgg._sum.points ?? 0;
        if (staffToday + points > staffCap) {
          throw new BadRequestException(
            `Vượt trần tích điểm tại quầy trong ngày của nhân viên (đã ${staffToday}/${staffCap} điểm). Liên hệ quản trị viên.`,
          );
        }
        const memberAgg = await tx.posPointCredit.aggregate({
          where: { memberId: member.id, dayKey },
          _sum: { points: true },
        });
        const memberToday = memberAgg._sum.points ?? 0;
        if (memberToday + points > memberCap) {
          throw new BadRequestException(
            `Thành viên đã được tích ${memberToday}/${memberCap} điểm tại quầy hôm nay — vượt trần ngày. Liên hệ quản trị viên.`,
          );
        }

        const credit = await tx.posPointCredit.create({
          data: {
            receiptId,
            memberId: member.id,
            staffUserId: staff.id,
            orderTotal: dto.orderTotal,
            points,
            multiplier,
            note,
            dayKey,
          },
        });
        await tx.pointsTransaction.create({
          data: {
            userId: member.id,
            delta: points,
            reason: `POS_OFFLINE_ORDER:${receiptId}`,
            refType: 'POS',
            refId: credit.id,
            expiresAt,
          },
        });
        const u = await tx.user.update({
          where: { id: member.id },
          data: { pointsBalance: { increment: points } },
          select: { pointsBalance: true },
        });
        return { credit, balance: u.pointsBalance };
      });
    } catch (err) {
      // Lưới an toàn nếu khoá advisory không có tác dụng (vd pgbouncer transaction pooling):
      // unique receiptId vẫn chặn cộng đôi — request thua đọc lại bản ghi của request thắng.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.posPointCredit.findUnique({ where: { receiptId } });
        if (!existing) throw err;
        outcome = { replay: existing };
      } else {
        throw err;
      }
    }

    if ('replay' in outcome) {
      const prev = outcome.replay;
      if (prev.memberId !== member.id || prev.orderTotal !== dto.orderTotal) {
        throw new ConflictException(
          `Hoá đơn ${receiptId} đã được tích điểm trước đó cho thành viên/số tiền khác.`,
        );
      }
      const cur = await this.prisma.user.findUniqueOrThrow({
        where: { id: member.id },
        select: { pointsBalance: true },
      });
      return this.posResult(member, cur.pointsBalance, prev, true);
    }

    this.logger.log(
      `POS credit receipt=${receiptId} staff=${staff.id} member=${member.id} total=${dto.orderTotal} points=${points}`,
    );
    return this.posResult(member, outcome.balance, outcome.credit, false);
  }

  /**
   * Sổ audit tích điểm tại quầy cho admin: ai cộng, cho ai, hoá đơn nào, bao nhiêu. Mới nhất trước,
   * tối đa POS_AUDIT_PAGE dòng; SĐT luôn che. Lọc theo ngày VN / nhân viên / thành viên.
   */
  async listPosCredits(q: { day?: string; staffUserId?: string; memberId?: string }) {
    const where: Prisma.PosPointCreditWhereInput = {};
    if (q.day) where.dayKey = q.day;
    if (q.staffUserId) where.staffUserId = q.staffUserId;
    if (q.memberId) where.memberId = q.memberId;
    const rows = await this.prisma.posPointCredit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: POS_AUDIT_PAGE,
      include: {
        staff: { select: { id: true, fullName: true, phone: true } },
        member: { select: { id: true, fullName: true, phone: true, referralCode: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      receiptId: r.receiptId,
      orderTotal: r.orderTotal,
      points: r.points,
      multiplier: Number(r.multiplier),
      note: r.note,
      dayKey: r.dayKey,
      createdAt: r.createdAt,
      staff: { id: r.staff.id, name: r.staff.fullName, phone: maskPhone(r.staff.phone) },
      member: {
        id: r.member.id,
        name: r.member.fullName,
        phone: maskPhone(r.member.phone),
        memberCode: memberCodeOf(r.member.referralCode),
      },
    }));
  }

  private posResult(
    member: Parameters<LoyaltyService['memberSummary']>[0],
    pointsBalance: number,
    credit: PosPointCredit,
    replayed: boolean,
  ) {
    return {
      replayed,
      member: { ...this.memberSummary(member), pointsBalance },
      posTransaction: {
        receiptId: credit.receiptId,
        orderTotal: credit.orderTotal,
        pointsEarned: credit.points,
        creditedAt: credit.createdAt,
      },
    };
  }
}

// ───────────────────────── Hằng số & helper thuần ─────────────────────────

const DAY_MS = 864e5;

/**
 * Bảng điểm danh 7 ngày MẶC ĐỊNH (ghi đè bằng SystemConfig `loyalty.checkin_points`).
 * Tổng 8 điểm/tuần ≈ 8.000đ/tuần (≈ 34.000đ/tháng) ở loyalty.vnd_per_point_redeem = 1.000đ —
 * tương đương điểm của ~80.000đ mua hàng/tuần. Bản WIP trả 10/15/20/25/30/40/50 = 190 điểm/tuần
 * ≈ 190.000đ/tuần (~9,9 triệu/năm) chỉ để bấm nút, gấp nhiều lần điểm từ mua hàng thật.
 * Điểm chỉ tiêu được khi mua (tối đa loyalty.max_redeem_pct giá trị đơn, voucher có minOrder).
 */
export const DEFAULT_CHECKIN_POINTS: readonly number[] = Object.freeze([1, 1, 1, 1, 1, 1, 2]);
/** Trần cứng cho 1 ô điểm danh dù admin cấu hình gì. */
const CHECKIN_MAX_POINTS_PER_DAY = 100;
const CHECKIN_ALREADY_MESSAGE = 'Hôm nay bạn đã điểm danh nhận điểm rồi 🌿';

/**
 * Điểm xét hạng = WHITELIST (xem LoyaltyService.tierPoints): dòng cộng điểm đơn đã giao
 * (creditOrderPoints) trừ dòng đảo điểm của chính đơn đó (reverseOrderPoints).
 */
const TIER_DELIVERED_PREFIX = 'ORDER_DELIVERED:';
const TIER_REVERSED_PREFIX = 'ORDER_REVERSED:';

/** Điểm Xanh chưa đổi quà được (xem LoyaltyService.lockedOrderPoints). */
export interface LockedPoints {
  /** Tổng điểm khoá. */
  locked: number;
  /** Phần khoá thuộc đơn có yêu cầu đổi/trả chờ duyệt / đã huỷ-trả chờ trừ điểm (không có ngày mở). */
  lockedReturn: number;
  /** Mốc muộn nhất phần khoá theo cửa sổ đổi/trả được mở; null nếu không có phần đó. */
  lockedUntil: Date | null;
}

/** dd/mm/yyyy theo giờ Việt Nam (UTC+7). */
function vnDateLabel(d: Date): string {
  const v = new Date(d.getTime() + 7 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
}

/** Trần mặc định cho tích điểm tại quầy (ghi đè bằng SystemConfig, xem creditPosPoints). */
const POS_DEFAULTS = {
  /** 5 triệu/hoá đơn → tối đa 500 điểm ×1 (1.000 điểm ở hạng ×2). */
  maxOrderTotal: 5_000_000,
  /** 3.000 điểm/nhân viên/ngày ≈ 30 triệu doanh thu quầy ở ×1. */
  staffDailyPoints: 3_000,
  /** 1.000 điểm/thành viên/ngày ≈ 10 triệu mua tại quầy ở ×1. */
  memberDailyPoints: 1_000,
};

/** Số dòng tối đa mỗi lần admin xem sổ audit POS. */
const POS_AUDIT_PAGE = 200;

const MEMBER_CODE_PREFIX = 'TUBU';
/** referralCode sinh 8 (hoặc 10) ký tự — mã ngắn hơn không thể là mã thật, từ chối trước khi chạm DB. */
const MIN_MEMBER_CODE_LEN = 8;

function memberCodeOf(referralCode: string): string {
  return `${MEMBER_CODE_PREFIX}${referralCode}`;
}

function maskPhone(phone: string | null | undefined): string | null {
  return phone ? `${phone.slice(0, 3)}****${phone.slice(-3)}` : null;
}

/** SĐT VN chuẩn hoá về 0xxxxxxxxx (cùng quy tắc zalo.service.ts normalizePhone); không phải SĐT → null. */
function normalizeVnPhone(s: string): string | null {
  const m = /^\+?(\d+)$/.exec(s);
  if (!m) return null;
  let digits = m[1]!;
  if (digits.startsWith('84') && digits.length === 11) digits = `0${digits.slice(2)}`;
  return /^0\d{9}$/.test(digits) ? digits : null;
}

/**
 * Tách chuỗi quét/gõ thành các ứng viên khớp CHÍNH XÁC. Bỏ khoảng trắng/gạch/chấm, viết hoa.
 * Ứng viên mã: chính chuỗi đó và phần sau tiền tố "TUBU" — mỗi ứng viên phải ≥ MIN_MEMBER_CODE_LEN.
 * Không có ứng viên nào hợp lệ → 400 (bản WIP: "", "TUBU" → endsWith("") → khớp mọi user).
 */
export function parseMemberCode(raw: string): { phone: string | null; codes: string[] } {
  const s = (raw ?? '').toUpperCase().replace(/[\s.-]/g, '');
  const phone = normalizeVnPhone(s);
  const codes = new Set<string>();
  if (/^[A-Z0-9]+$/.test(s)) {
    if (s.length >= MIN_MEMBER_CODE_LEN) codes.add(s);
    if (s.startsWith(MEMBER_CODE_PREFIX)) {
      const rest = s.slice(MEMBER_CODE_PREFIX.length);
      if (rest.length >= MIN_MEMBER_CODE_LEN) codes.add(rest);
    }
  }
  if (!phone && codes.size === 0) {
    throw new BadRequestException(
      'Mã thành viên không hợp lệ hoặc quá ngắn — quét mã QR trên thẻ, hoặc nhập mã TUBU… / SĐT đầy đủ.',
    );
  }
  return { phone, codes: [...codes] };
}

const COUPON_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Mã voucher đổi quà: REWARD-<LOẠI><GIÁ TRỊ>-<8 ký tự ngẫu nhiên crypto>. Bản WIP dùng 4 số
 * Math.random + 4 ký tự cuối userId → cùng user đổi nhiều lần dễ trùng (P2002 → 500).
 * 32^8 ≈ 10^12 tổ hợp: trùng gần như không thể; nếu có, unique coupons.code vẫn chặn (tx rollback, không mất điểm).
 */
function rewardCouponCode(reward: RewardCatalogItem): string {
  const bytes = randomBytes(8);
  let rand = '';
  for (const b of bytes) rand += COUPON_ALPHABET[b % COUPON_ALPHABET.length];
  const tag =
    reward.type === 'AMOUNT'
      ? `${Math.floor(reward.value / 1000)}K`
      : reward.type === 'PERCENT'
        ? `${reward.value}P`
        : 'SHIP';
  return `REWARD-${reward.type.slice(0, 3)}${tag}-${rand}`;
}

export interface RewardCatalogItem {
  id: string;
  title: string;
  description: string;
  pointsCost: number;
  type: 'FREESHIP' | 'AMOUNT' | 'PERCENT';
  value: number;
  minOrder?: number;
  maxDiscount?: number;
  badge?: string;
}

export const DEFAULT_REWARD_CATALOG: RewardCatalogItem[] = [
  {
    // FREESHIP ở checkout miễn TOÀN BỘ phí ship (coupons.service validateAndCompute bỏ qua value),
    // nên không ghi "tối đa 25k". Đơn ≥ shipping.free_threshold (200k) vốn đã freeship → minOrder
    // 99k để voucher có ích cho đúng khoảng đơn còn phải trả phí ship (~19k) — giá 20 điểm ≈ 20.000đ.
    id: 'reward-freeship',
    title: 'Voucher Miễn phí vận chuyển',
    description: 'Miễn phí vận chuyển cho 1 đơn từ 99.000đ — hữu ích khi đơn chưa đạt mức freeship của shop.',
    pointsCost: 20,
    type: 'FREESHIP',
    value: 0,
    minOrder: 99000,
    badge: 'Phổ biến',
  },
  {
    id: 'reward-discount-50k',
    title: 'Voucher Giảm 50.000đ',
    description: 'Giảm ngay 50.000đ cho đơn hàng từ 300.000đ',
    pointsCost: 50,
    type: 'AMOUNT',
    value: 50000,
    minOrder: 300000,
    badge: 'Tiết kiệm',
  },
  {
    id: 'reward-discount-100k',
    title: 'Voucher Giảm 100.000đ',
    description: 'Giảm ngay 100.000đ cho đơn hàng từ 600.000đ',
    pointsCost: 100,
    type: 'AMOUNT',
    value: 100000,
    minOrder: 600000,
    badge: 'HOT',
  },
  {
    id: 'reward-percent-15pct',
    title: 'Voucher Giảm 15%',
    description: 'Giảm 15% tối đa 80.000đ cho đơn hàng từ 250.000đ',
    pointsCost: 75,
    type: 'PERCENT',
    value: 15,
    minOrder: 250000,
    maxDiscount: 80000,
    badge: 'Đặc quyền',
  },
];
