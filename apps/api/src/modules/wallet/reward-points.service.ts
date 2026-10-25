import { Injectable, InternalServerErrorException, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { applyPointsDelta } from '../loyalty/points-ledger';
import { DEFAULT_POINT_EXPIRE_MONTHS, pointsExpiryFrom } from '../loyalty/points-expiry-date';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { sendReferralNotices, type ReferralNotice } from './referral-notify';
import {
  countReferralSuccesses,
  findReferralRewardedOrders,
  fullyReturnedOrderIds,
  hasReferralEntry,
  heldMilestoneGens,
  LEGACY_REFERRAL_CASHBACK_PREFIX,
  legacyXuToPoints,
  lockReferee,
  lockReferrer,
  milestoneGrantReason,
  nextMilestoneGen,
  readMilestoneState,
  REFERRAL_ORDER2_PREFIX,
  resolveMergedUserId,
  revokeReferralRewardForPriorReturns,
} from './referral-reward';

/**
 * Trần một lần cấp thưởng = thưởng hợp lệ lớn nhất (mốc CTV 80 triệu = 2.000 điểm). Khoá config còn
 * giá trị tính bằng xu (5.000, 20.000…) đọc dưới tên điểm sẽ vượt trần và bị từ chối thay vì cấp
 * 5–20 triệu đồng (PD-3 R1).
 */
export const POINTS_GRANT_HARD_MAX = 2_000_000;

/** Số đơn ứng viên đọc mỗi lần khi chọn cặp thưởng giới thiệu; dừng ngay khi đủ 2 đơn không bị loại. */
const REFERRAL_CANDIDATE_PAGE = 10;

export interface ReferralMilestone {
  count: number;
  bonusPoints: number;
}

/**
 * Chỉ nhận đúng dạng mới {count, bonusPoints}. Bản xu cũ {count, bonus} đọc nhầm ra bonusPoints
 * undefined nên bị bỏ, không cấp.
 */
function parseMilestones(raw: unknown): ReferralMilestone[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is ReferralMilestone =>
        typeof m === 'object' &&
        m !== null &&
        Number.isInteger((m as ReferralMilestone).count) &&
        (m as ReferralMilestone).count > 0 &&
        Number.isInteger((m as ReferralMilestone).bonusPoints) &&
        (m as ReferralMilestone).bonusPoints > 0,
    )
    .map((m) => ({ count: m.count, bonusPoints: m.bonusPoints }))
    .sort((a, b) => a.count - b.count);
}

/**
 * Khoá idempotency của thưởng cũ ở coin_transactions, cùng phạm vi với partial unique index cũ
 * (coin_transactions_referral_unique / _community_reason_key theo reason, _quest_unique theo
 * userId+reason). Thưởng đã cấp bằng xu trước gộp thì không cấp lại bằng điểm.
 */
const LEGACY_COIN_KEY_SCOPE: Record<string, 'reason' | 'user'> = {
  REFERRAL: 'reason',
  COMMUNITY: 'reason',
  QUEST: 'user',
};

/**
 * PD-3: nguồn cộng duy nhất cho thưởng (giới thiệu, cộng đồng, nhiệm vụ gian hàng, mốc CTV, Season
 * Pass). Thưởng mới là Điểm Xanh lô STANDARD có hạn loyalty.point_expire_months (OQ-1), thay cho
 * đường cộng xu cũ (đã gỡ ở PD-3).
 */
@Injectable()
export class RewardPointsService {
  private readonly logger = new Logger(RewardPointsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    // Optional: test dựng tay (prisma, config) vẫn chạy, chỉ không báo người mời.
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /** Báo người mời sau khi tx ghi sổ đã commit; không bao giờ ném. */
  private async notifyReferrer(notices: ReferralNotice[]): Promise<void> {
    await sendReferralNotices({ prisma: this.prisma, notifications: this.notifications, logger: this.logger }, notices);
  }

  /**
   * Cộng Điểm Xanh thưởng. Idempotent: dòng sổ ghi bằng INSERT ... ON CONFLICT DO NOTHING trên partial
   * unique index của refType (REFERRAL/COMMUNITY theo reason, QUEST theo userId+reason), và kiểm khoá
   * cũ ở coin_transactions. Trùng → false, không đổi số dư. Không bắt P2002: lỗi unique trong tx
   * Postgres huỷ cả tx của caller (25P02, C-061).
   *
   * Số điểm ngoài 1..POINTS_GRANT_HARD_MAX hoặc không nguyên là lỗi cấu hình/lập trình: log + 500,
   * không ghi gì (trong tx của caller thì rollback cả thao tác).
   *
   * `expiresAt`: caller đang giữ khoá dòng trong tx thì đọc hạn (this.expiresAt) TRƯỚC khi mở tx rồi truyền vào — cache cấu
   * hình hết hạn sẽ đọc qua this.prisma, tức xin kết nối pool thứ hai khi tx đang giữ một kết nối + khoá (cạn pool P2024).
   */
  async grant(
    userId: string,
    points: number,
    reason: string,
    refType: string,
    refId?: string | null,
    tx?: Prisma.TransactionClient,
    expiresAtOverride?: Date,
  ): Promise<boolean> {
    if (!Number.isInteger(points) || points <= 0 || points > POINTS_GRANT_HARD_MAX) {
      this.logger.error(
        `Từ chối cấp ${points} Điểm Xanh (user=${userId}, reason=${reason}): ngoài 1..${POINTS_GRANT_HARD_MAX}, ` +
          'nghi khoá config còn giá trị tính bằng xu.',
      );
      throw new InternalServerErrorException('Thưởng Điểm Xanh không hợp lệ, đã báo quản trị viên.');
    }
    if (tx && !expiresAtOverride) {
      throw new Error('RewardPointsService.grant(tx): thiếu expiresAtOverride — đọc hạn bằng expiresAt() TRƯỚC khi mở transaction.');
    }
    const expiresAt = expiresAtOverride ?? (await this.expiresAt());
    const run = async (db: Prisma.TransactionClient): Promise<boolean> => {
      if (await this.legacyCoinEntryExists(db, userId, reason, refType)) {
        this.logger.debug(`grant bỏ qua: đã thưởng bằng xu trước gộp reason=${reason}`);
        return false;
      }
      const res = await applyPointsDelta(db, {
        userId,
        delta: points,
        lot: 'STANDARD',
        reason,
        refType,
        refId: refId ?? null,
        expiresAt,
        skipDuplicates: true,
      });
      if (!res.applied) this.logger.debug(`grant idempotent skip reason=${reason}`);
      return res.applied;
    };
    if (tx) return run(tx);
    return this.prisma.$transaction((t) => run(t));
  }

  private async legacyCoinEntryExists(
    db: Prisma.TransactionClient,
    userId: string,
    reason: string,
    refType: string,
  ): Promise<boolean> {
    const scope = LEGACY_COIN_KEY_SCOPE[refType];
    if (!scope) return false;
    const where = scope === 'user' ? { userId, reason, refType } : { reason, refType };
    return Boolean(await db.coinTransaction.findFirst({ where, select: { id: true } }));
  }

  /** Hạn cho điểm thưởng mới — cùng quy tắc loyalty.point_expire_months như điểm danh / điểm đơn. */
  async expiresAt(): Promise<Date> {
    const months = await this.config.get<number>('loyalty.point_expire_months', DEFAULT_POINT_EXPIRE_MONTHS);
    return pointsExpiryFrom(new Date(), months);
  }

  private async referralMilestones(): Promise<ReferralMilestone[]> {
    return parseMilestones(await this.config.get<unknown>('referral.milestones_points', []));
  }

  /** Điều kiện đơn thứ hai; một nguồn cho cả thưởng và lời hứa hiển thị ở /me/referral. */
  private async referralOrderRules(): Promise<{ windowDays: number; minOrderAmount: number }> {
    const [windowDays, minOrderAmount] = await Promise.all([
      this.config.get<number>('referral.window_days', 30),
      this.config.get<number>('referral.min_order_amount', 200000),
    ]);
    return { windowDays, minOrderAmount };
  }

  /**
   * Thống kê giới thiệu cho khách (GET /me/referral): số bạn thành công còn hiệu lực, Điểm Xanh đã
   * nhận từ giới thiệu (thưởng xu cũ quy ra ceil(xu/1000)), mốc và mốc kế tiếp.
   */
  async getReferralOverview(userId: string) {
    const [user, pointsAgg, coinAgg, successCount, milestones, rules] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } }),
      this.prisma.pointsTransaction.aggregate({ where: { userId, refType: 'REFERRAL' }, _sum: { delta: true } }),
      this.prisma.coinTransaction.aggregate({ where: { userId, refType: 'REFERRAL' }, _sum: { delta: true } }),
      countReferralSuccesses(this.prisma, userId),
      this.referralMilestones(),
      this.referralOrderRules(),
    ]);
    return {
      referralCode: user.referralCode,
      successCount,
      earnedPoints: (pointsAgg._sum.delta ?? 0) + legacyXuToPoints(coinAgg._sum.delta ?? 0),
      milestones,
      nextMilestone: milestones.find((m) => m.count > successCount) ?? null,
      windowDays: rules.windowDays,
      minOrderAmount: rules.minOrderAmount,
    };
  }

  /**
   * Thưởng người mời khi người được mời (refereeId) có đơn thứ 2 giao thành công trong
   * referral.window_days ngày kể từ đơn đầu (Q-05). Gọi mỗi khi một đơn của người được mời sang
   * DELIVERED; tự xét lại từ DB nên gọi lặp/song song an toàn. Người mời là CTV thì không thưởng
   * (CTV chỉ hưởng hoa hồng). Người được mời không nhận thêm — họ đã có voucher chào mừng.
   */
  async grantReferralOrderReward(refereeId: string, retried = false): Promise<boolean> {
    const referee = await this.prisma.user.findUnique({
      where: { id: refereeId },
      select: { referredById: true, mergedIntoId: true },
    });
    // Chủ đơn đọc trước khi khoá (đường giao hàng) có thể là phiên khách vừa gộp: đơn đã sang tài khoản đích, xét ở đó.
    if (referee?.mergedIntoId) return this.grantForMergedReferee(refereeId, retried);
    // Người mời là khách đã gộp (người được mời tạo xen giữa lúc gộp) ⇒ thưởng cho tài khoản đích.
    const referrerId = referee?.referredById ? await resolveMergedUserId(this.prisma, referee.referredById) : null;
    if (!referrerId || referrerId === refereeId) return false;
    const referrer = await this.prisma.user.findUnique({ where: { id: referrerId }, select: { role: true, isBlocked: true } });
    // Người mời bị khoá (kể cả chủ gian hàng mẫu bị giữ lại sau khi gỡ mẫu) không nhận thưởng.
    if (!referrer || referrer.role === 'AFFILIATE' || referrer.isBlocked) return false;

    const [reward, { windowDays, minOrderAmount: minOrder }, expiresAt] = await Promise.all([
      this.config.get<number>('referral.referrer_reward_points', 5000),
      this.referralOrderRules(),
      this.expiresAt(),
    ]);
    if (!(reward > 0)) return false;

    let notices: ReferralNotice[] = [];
    const granted = await this.prisma.$transaction(async (tx): Promise<boolean | 'STALE' | 'ALREADY' | 'MERGED'> => {
      notices = [];
      await lockReferee(tx, refereeId);
      // Gộp khách đổi referredById của người được mời dưới khoá này: người mời đọc ở trên có thể là dòng khách vừa gộp.
      const fresh = await tx.user.findUnique({ where: { id: refereeId }, select: { referredById: true, mergedIntoId: true } });
      if (fresh?.mergedIntoId) return 'MERGED';
      if ((fresh?.referredById ? await resolveMergedUserId(tx, fresh.referredById) : null) !== referrerId) return 'STALE';
      if (await hasReferralEntry(tx, [`${REFERRAL_ORDER2_PREFIX}${refereeId}`, `${LEGACY_REFERRAL_CASHBACK_PREFIX}${refereeId}`])) {
        return 'ALREADY';
      }
      // Đơn nhận về từ một phiên khách đã gộp có thể đã dùng để thưởng dưới id khách. Cùng người mời
      // ⇒ đó là cùng một người được mời đã được thưởng; khác người mời thì chỉ bỏ các đơn đó ra.
      const rewardedOrders = await findReferralRewardedOrders(tx, refereeId);
      if (rewardedOrders.some((r) => r.referrerId === referrerId)) return 'ALREADY';
      // Hai đơn đầu tiên (createdAt, id) không bị loại; đọc theo trang (keyset) và dừng khi đủ hai, để chi phí trong lúc
      // giữ khoá người được mời không tăng theo số đơn của họ.
      const picked: { id: string; createdAt: Date }[] = [];
      let after: { id: string; createdAt: Date } | undefined;
      while (picked.length < 2) {
        const page = await tx.order.findMany({
          where: {
            id: { notIn: rewardedOrders.map((r) => r.orderId) },
            userId: refereeId,
            status: 'DELIVERED',
            type: 'RETAIL',
            placedForCustomer: false,
            total: { gte: Math.max(Number(minOrder) || 0, 0) },
            ...(after && {
              OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }],
            }),
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, createdAt: true },
          take: REFERRAL_CANDIDATE_PAGE,
        });
        // Đơn đã trả hết phần có tiền (chỉ còn dòng quà 0đ nên vẫn DELIVERED) không tính, như đơn đã RETURNED.
        const returnedAll = await fullyReturnedOrderIds(tx, page.map((o) => o.id));
        picked.push(...page.filter((o) => !returnedAll.has(o.id)).slice(0, 2 - picked.length));
        if (page.length < REFERRAL_CANDIDATE_PAGE) break;
        after = page[page.length - 1];
      }
      const [first, second] = picked;
      if (!first || !second) return false;
      if (second.createdAt.getTime() - first.createdAt.getTime() > windowDays * 864e5) return false;

      // Khoá người mời (FOR UPDATE) TRƯỚC khi ghi dòng thưởng, cùng thứ tự người được mời → người mời như mọi đường thu hồi.
      // Ghi trước rồi mới khoá (lúc thu hồi theo tỷ lệ ngay dưới) là nâng khoá: dòng sổ của lần cấp song song cho người được
      // mời khác giữ KEY SHARE trên người mời và chờ UPDATE của tx này ⇒ deadlock.
      await lockReferrer(tx, referrerId);
      const reason = `${REFERRAL_ORDER2_PREFIX}${refereeId}`;
      const ok = await this.grant(referrerId, reward, reason, 'REFERRAL', `${first.id}:${second.id}`, tx, expiresAt);
      if (ok) {
        notices.push({ kind: 'PAID', referrerId, refereeId, points: reward, key: reason });
        // Phần đơn đã duyệt trả một phần trước lúc cấp: thu theo tỷ lệ ngay trong tx này (revokeReferralRewardForPriorReturns).
        const prior = await revokeReferralRewardForPriorReturns(tx, [first.id, second.id]);
        if (prior) notices.push(...prior.notices);
      }
      return ok;
    });
    if (granted === true) await this.notifyReferrer(notices);
    if (granted === 'MERGED') return this.grantForMergedReferee(refereeId, retried);
    if (granted === 'STALE') return retried ? false : this.grantReferralOrderReward(refereeId, true);
    // Đã thưởng từ trước vẫn xét mốc: lần cấp trước có thể đã commit thưởng mà lỗi ở bước mốc (chạy riêng tx), và lần gọi lại
    // (cron chạy lại việc sau giao) là cơ hội duy nhất để cấp bù. Mốc idempotent theo reason từng đời.
    if (granted === true || granted === 'ALREADY') await this.awardReferralMilestones(referrerId);
    return granted === true;
  }

  /**
   * Người được mời là phiên khách đã gộp: xét lại một lần cho tài khoản đích (đơn của khách đã chuyển sang đó). Đích đã xoá
   * tài khoản (resolveMergedUserId trả null) thì không thưởng — như mọi đơn của tài khoản đã xoá.
   */
  private async grantForMergedReferee(guestId: string, retried: boolean): Promise<boolean> {
    if (retried) return false;
    const owner = await resolveMergedUserId(this.prisma, guestId);
    if (!owner || owner === guestId) return false;
    return this.grantReferralOrderReward(owner, true);
  }

  /**
   * Thưởng thêm khi số bạn giới thiệu thành công còn hiệu lực của referrer chạm mốc cấu hình
   * (referral.milestones_points). Mốc đã cấp có thể bị thu hồi khi lượt giới thiệu bị thu hồi
   * (revokeReferralRewardForOrder); đạt lại thì cấp đời mới. Đọc số đếm sau khoá dòng người mời để
   * không chạy chéo với lần thu hồi; reason duy nhất theo đời chặn cấp trùng.
   */
  private async awardReferralMilestones(referrerId: string): Promise<void> {
    const [milestones, expiresAt] = await Promise.all([this.referralMilestones(), this.expiresAt()]);
    if (!milestones.length) return;
    let notices: ReferralNotice[] = [];
    await this.prisma.$transaction(async (tx) => {
      notices = [];
      await lockReferrer(tx, referrerId);
      const successCount = await countReferralSuccesses(tx, referrerId);
      const state = await readMilestoneState(tx, referrerId);
      for (const m of milestones) {
        if (successCount < m.count) continue;
        const s = state.get(m.count);
        if (heldMilestoneGens(s).length > 0) continue;
        const reason = milestoneGrantReason(referrerId, m.count, nextMilestoneGen(s));
        if (await this.grant(referrerId, m.bonusPoints, reason, 'REFERRAL', referrerId, tx, expiresAt)) {
          notices.push({ kind: 'MILESTONE', referrerId, count: m.count, points: m.bonusPoints, key: reason });
        }
      }
    });
    await this.notifyReferrer(notices);
  }
}
