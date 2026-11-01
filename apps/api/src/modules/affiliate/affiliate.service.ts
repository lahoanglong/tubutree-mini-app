import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { CommissionStatus, Prisma, type PayoutStatus, type UserRole } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Env } from '../../config/env.validation';
import { hashIp } from '../../common/ip-hash';
import { notifyAdmins } from '../../common/notify-admins';
import { isRealUser } from '../../common/real-user';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { PricingService } from '../pricing/pricing.service';
import { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import { PlaceOrderForCustomerDto, QuoteOrderForCustomerDto } from './dto/place-order-for-customer.dto';
import {
  FlashQuotaLineError,
  FlashSaleService,
  type EffectivePrice,
  type FlashQuotaOutcome,
} from '../flash-sale/flash-sale.service';
import { isLockBusy, LOCK_BUSY_MESSAGE } from '../../common/lock-busy';
import { priceFlashLine } from '../flash-sale/flash-line-price';
import { COD_MAX_PER_ORDER, PAYMENT_METHOD_NOT_ALLOWED } from '../checkout/checkout-split';
import { lockVariationsInIdOrder, reserveVariationStock } from '../catalog/variation-stock';
import { assertVariationsSellable, isSellableVariation, productDiscontinuedError } from '../cart/sellable';
import { RewardPointsService } from '../wallet/reward-points.service';
import { applyWalletDelta } from '../wallet/wallet-ledger.service';
import {
  commissionHolding,
  debitCommissionFromWallet,
  type CommissionDebitNote,
  type CommissionManualNote,
} from '../wallet/commission-wallet-reversal';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CTV_NOTIFICATION } from './ctv-notification-codes';
import { generateUniqueOrderCode } from '../../common/order-code';
import { paginated, skipTake } from '../../common/pagination';
import { normalizeZaloPhone, parseTypedVnPhone, TYPED_VN_PHONE_MESSAGE } from '../../common/phone';
import {
  CONFIRMED_COMMISSION_STATUSES,
  CTV_MONTHLY_MILESTONES,
  CTV_TIERS,
  PENDING_COMMISSION_STATUSES,
  milestoneProgressPct,
  tierForRevenue,
  tiersWithRewards,
  vnDayStart,
  vnMonthBounds,
  type VnMonth,
} from './ctv-milestones';
import { CRON_TZ } from '../../common/cron-tz';
import { VN_OFFSET_MS, vnDateKey } from '../../common/vn-time';
import { paidLineTotals } from './commission-base';
import { consignmentLinkedSql } from '../merchant/consignment-link-sql';
import { forBuyer } from '../orders/buyer-order-fields';
import { totalChangedError, totalChangedMessage } from '../checkout/total-changed';

import { distributeByWeight, shareOf } from '../orders/refund-allocation';
import { storefrontSalesByStore } from './storefront-sales';
import { COMMISSION_ELIGIBLE_ROLES_KEY, DEFAULT_COMMISSION_ELIGIBLE_ROLES, sanitizeEligibleRoles } from './commission-eligibility';
import { loadDefaultRate, resolveVariationRate } from './commission-rate';
import { loadPublicVisibility } from '../storefront/public-visibility';
import type { PublicVisibilityOptions } from '../storefront/storefront-visibility';
import { APPROVE_COMMISSIONS_CRON, DAILY_WALLET_TRANSFER_HOUR_VN, DAILY_WALLET_TRANSFER_JOB, AFFILIATE_AUTO_WALLET_TRANSFER_KEY, DEFAULT_AFFILIATE_AUTO_WALLET_TRANSFER_ENABLED } from './affiliate-auto-transfer-config';
import { affiliateAccess, canPlaceOrderForCustomer, canRegisterAsAffiliate } from './affiliate-access';
import { markCronSkipped, TrackCron } from '../../common/cron-run/track-cron';
import { SessionStateService } from '../auth/session-state.service';
export { CTV_MONTHLY_MILESTONES, type CtvMilestone } from './ctv-milestones';

type Db = PrismaService | Prisma.TransactionClient;

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

/** Kết quả thu hồi một hoa hồng khi đơn bị trả/huỷ (reverseCommissionsForOrder). */
type CommissionReversal =
  | { kind: 'NONE' }
  | { kind: 'REJECTED'; affiliateUserId: string; amount: number }
  | ({ kind: 'DEBITED' } & CommissionDebitNote)
  | ({ kind: 'MANUAL' } & CommissionManualNote);

/**
 * Lý do đơn hộ không thu hộ (COD) được, null = được. Cùng trần mỗi đơn với checkout (COD_MAX_PER_ORDER); đơn hộ không trả bằng
 * Ví nên chỉ còn chuyển khoản. Báo giá trả câu này để form khoá COD trước, tạo đơn từ chối đúng câu đó.
 */
function ctvCodBlockReason(total: number): string | null {
  if (total <= COD_MAX_PER_ORDER) return null;
  return `Thanh toán khi nhận hàng (COD) chỉ nhận đơn tối đa ${vnd(COD_MAX_PER_ORDER)}, đơn này là ${vnd(total)}. Vui lòng chọn chuyển khoản.`;
}

/** Cùng dạng `blockedPaymentMethods` của báo giá checkout: phương thức → lý do, chỉ có các phương thức bị khoá. */
function blockedCtvPaymentMethods(total: number): Partial<Record<'COD' | 'BANK_TRANSFER', string>> {
  const cod = ctvCodBlockReason(total);
  return cod ? { COD: cod } : {};
}

/**
 * CTV nội bộ (Build Spec §6.x, §15 affiliate.*).
 * Commission: rate theo từng variation (variation.affiliateRate), chưa đặt thì mức mặc định `affiliate.default_rate_pct`. Vòng đời:
 * PENDING (đặt) → LOCKED (DELIVERED) → APPROVED (sau hold_days) → PAID (payout).
 */
export const DEFAULT_PIT_WITHHOLD_PCT = 0.1;
export const DEFAULT_PIT_WITHHOLD_THRESHOLD = 5_000_000;
/** Chính sách Zalo 4.5 cấm rút tiền/trả thưởng: hoa hồng chỉ đi một đường, vào Ví Tubu 1:1. */
export const WALLET_ONLY_MESSAGE = 'Hoa hồng chỉ chuyển vào Ví Tubu để mua hàng.';
/** Đăng ký CTV không phải ưu đãi: câu chung của real-user.ts nói "Ưu đãi", sẽ lạc ngữ cảnh ở màn đăng ký. */
export const AFFILIATE_REAL_USER_REQUIRED_MSG =
  'Cần liên kết Zalo hoặc số điện thoại để đăng ký CTV. Bạn bấm Đăng ký lại và cho phép dùng số điện thoại nhé.';
export const PIT_TAX_ID_REQUIRED = 'PIT_TAX_ID_REQUIRED';
const PIT_MONTH_LOCK = 'affiliate.pit_month';
/** MST cá nhân 10 số (hoặc 10-3 của MST phụ thuộc), hoặc số CCCD 12 số (dùng làm MST cá nhân từ 1/7/2025). */
export const PERSONAL_TAX_ID_PATTERN = /^(\d{10}|\d{10}-\d{3}|\d{12})$/;
export const PERSONAL_TAX_ID_FORMAT_MESSAGE = 'Mã số thuế cá nhân gồm 10 chữ số, hoặc số CCCD 12 chữ số.';

/** Chủ gian hàng mẫu (Storefront.isSample): không ghi công đơn, không sinh hoa hồng. */
const SAMPLE_STOREFRONT_SELECT = { where: { isSample: true }, select: { id: true }, take: 1 } as const;

/**
 * Khoảng thời gian đã trôi kể từ lúc khách bấm link, do client đo bằng cùng một đồng hồ máy (không gửi giờ tuyệt đối để đồng hồ
 * lệch không làm mất hay kéo dài ghi công). Âm, không phải số hoặc không hữu hạn thì coi như không gửi.
 */
function parseClickedAgo(raw: unknown, maxMs: number): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.min(raw, maxMs) : null;
}

@Injectable()
export class AffiliateService {
  private readonly logger = new Logger(AffiliateService.name);
  private approveRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly pricing: PricingService,
    private readonly pancakeOrder: PancakeOrderService,
    private readonly rewards: RewardPointsService,
    private readonly analytics: AnalyticsEventsService,
    // @Optional: test dựng service trực tiếp không truyền; AppModule luôn wiring (NotificationsModule là @Global).
    @Optional() private readonly notifications?: NotificationsService,
    // @Optional cùng lý do; AffiliateModule import FlashSaleModule (affiliate.module.spec.ts giữ việc nối này).
    @Optional() private readonly flashSale?: FlashSaleService,
    // @Optional: ConfigModule là global nên app thật luôn có; test dựng trực tiếp không truyền thì hashIp dùng khoá dev.
    @Optional() private readonly env?: ConfigService<Env, true>,
    // @Optional cùng lý do; SessionStateModule là @Global.
    @Optional() private readonly sessionState?: SessionStateService,
  ) {}

  async register(userId: string, termsVersion?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!canRegisterAsAffiliate(user.role)) {
      throw new BadRequestException('Tài khoản này không thể đăng ký CTV.');
    }
    // Khách theo deviceId tạo được vô hạn: hoa hồng và Ví chỉ dành cho tài khoản đã có Zalo thật hoặc SĐT.
    if (!isRealUser(user)) throw new BadRequestException(AFFILIATE_REAL_USER_REQUIRED_MSG);
    const data: Prisma.UserUpdateInput = {};
    if (user.role !== 'AFFILIATE') data.role = 'AFFILIATE';
    // Bằng chứng người dùng đã đồng ý điều khoản hoa hồng/thuế: ghi vào User.metadata (đã dùng cho
    // segments/dealerTierId, không cần migration). Chỉ ghi khi phiên bản đổi để giữ thời điểm đồng
    // ý đầu tiên của từng phiên bản; merge để không mất khoá metadata khác.
    const version = termsVersion?.trim();
    if (version) {
      const meta = (user.metadata as Record<string, unknown> | null) ?? {};
      const prev = meta.affiliateTerms as { version?: string } | undefined;
      if (prev?.version !== version) {
        data.metadata = {
          ...meta,
          affiliateTerms: { version, acceptedAt: new Date().toISOString() },
        } as Prisma.InputJsonValue;
      }
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({ where: { id: userId }, data });
    }
    // Vai trò vừa đổi: bỏ bản nhớ 5 giây của phiên, không thì các route CTV (Học viện...) còn thấy vai trò cũ và trả 403.
    if (data.role) this.sessionState?.invalidate(userId);
    return { ok: true, referralCode: user.referralCode };
  }

  async getMe(userId: string, now: Date = new Date()) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const monthRevenue = await this.confirmedRevenue(this.prisma, userId, vnMonthBounds(now));
    const access = await affiliateAccess(this.prisma, user);

    return {
      isAffiliate: access.hasAccess,
      canRegister: canRegisterAsAffiliate(user.role),
      canOrderForCustomer: canPlaceOrderForCustomer(user.role),
      canOpenStorefront: access.canOpenStorefront,
      referralCode: user.referralCode,
      walletBalance: user.walletBalance,
      personalTaxId: user.personalTaxId,
      monthRevenue,
      tier: this.monthlyTier(monthRevenue),
    };
  }

  /**
   * Ghi "chạm" giới thiệu (attribution last-touch persistent §quyết-định). Khi khách (đã đăng nhập)
   * mở link CTV/nhãn → lưu referrerUserId + slug, hạn = now + config(attribution_days, mặc định 7 — Q-31).
   * Mỗi lần mở làm mới hạn. Bỏ qua nếu thiếu code / code không tồn tại / trỏ chính mình / mã không phải của CTV-đại lý
   * (findEligibleReferrer): link chia sẻ của khách thường không được đè chạm CTV còn hạn.
   */
  async recordTouch(
    userId: string,
    dto: { referralCode?: string; storefrontSlug?: string; kind?: string; clickedAgoMs?: number },
    now: Date = new Date(),
    platform: 'miniapp' | 'web' = 'miniapp',
  ): Promise<{ ok: boolean }> {
    if (!dto.referralCode) return { ok: false };
    const referrerUserId = await this.findEligibleReferrer(dto.referralCode, userId);
    if (!referrerUserId) return { ok: false };
    const days = await this.config.get<number>('affiliate.attribution_days', 7);
    const dayMs = 24 * 60 * 60 * 1000;
    // Kẹp ở hạn + 1 ngày: giá trị lớn hơn vẫn là chạm quá hạn, nhưng không làm ngày vượt biên (Invalid Date → 500).
    const ago = parseClickedAgo(dto.clickedAgoMs, days * dayMs + dayMs);
    const clickedAt = new Date(now.getTime() - (ago ?? 0));
    const expiresAt = new Date(clickedAt.getTime() + days * dayMs);
    if (!Number.isFinite(expiresAt.getTime()) || (ago !== null && expiresAt <= now)) return { ok: false };
    const data = {
      referrerUserId,
      storefrontSlug: dto.storefrontSlug ?? null,
      kind: dto.kind ?? 'ctv',
      clickedAt,
      expiresAt,
    };
    let applied = true;
    if (ago !== null) {
      // Chạm bù mang khoảng thời gian từ lúc bấm: chỉ được thay chạm đang có khi lúc bấm mới hơn (so theo lúc bấm, không theo
      // hạn, vì admin đổi số ngày giữa chừng làm hạn không còn so được). Dòng cũ chưa có lúc bấm thì lấy hạn - số ngày hiện tại
      // làm mốc, tức so hạn. Dòng đã hết hạn (kể cả khi còn clickedAt, vd CTV xoá tài khoản đặt hạn = lúc đó) không chặn chạm hợp lệ.
      // Điều kiện nằm trong câu UPDATE nên hai chạm đồng thời cũng không ghi đè ngược.
      try {
        await this.prisma.referralTouch.create({ data: { userId, ...data } });
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
        const newer: Prisma.ReferralTouchWhereInput[] = [
          { clickedAt: { lt: clickedAt } },
          { clickedAt: null, expiresAt: { lt: expiresAt } },
          { expiresAt: { lte: now } },
        ];
        const r = await this.prisma.referralTouch.updateMany({ where: { userId, OR: newer }, data });
        applied = r.count > 0;
        // Cùng người giới thiệu mà dòng chưa có slug gian hàng (vd ?ref= rồi /s/<mã>): chỉ bổ sung slug và loại, không đụng lúc
        // bấm hay hạn, vì lúc bấm của hai lượt lệch nhau theo độ trễ mạng.
        if (!applied && dto.storefrontSlug) {
          await this.prisma.referralTouch.updateMany({
            where: { userId, referrerUserId, storefrontSlug: null },
            data: { storefrontSlug: dto.storefrontSlug, kind: dto.kind ?? 'ctv' },
          });
        }
      }
    } else {
      await this.prisma.referralTouch.upsert({
        where: { userId },
        update: data,
        create: { userId, ...data },
      });
    }
    if (!applied) return { ok: true };
    // Best-effort (không tx nào đang chạy ở đây) — mất 1 event referral_touched không đáng để
    // chặn/hủy việc ghi "chạm" giới thiệu thật (đường tiền).
    await this.analytics.recordBestEffort({
      eventName: 'referral_touched',
      userId,
      platform,
      // Không cần `?? null`: guard `if (!dto.referralCode) return` ở đầu hàm đã đảm bảo non-empty
      // string tới đây.
      refCode: dto.referralCode,
      storefrontSlug: dto.storefrontSlug ?? null,
      props: { kind: dto.kind ?? 'ctv' },
    });
    return { ok: true };
  }

  /**
   * Người được ghi công theo mã giới thiệu (chạm, đơn hàng): có tài khoản mang mã, khác người mua, và thuộc vai trò hưởng hoa
   * hồng. Mã khách thường (`?ref=` ở nút chia sẻ sản phẩm, mua chung) → null, để không đè chạm CTV còn hạn hay chủ gian hàng
   * CTV mà khách đang mua (checkout/attribution.ts). Chương trình "giới thiệu bạn bè" không đi qua đây: nó dùng
   * User.referredById gán lúc tạo tài khoản (auth.service.ts resolveReferrerId).
   *
   * P0 A5-01: User.referralCode luôn lưu HOA (auth.service.ts sinh bằng toUpperCase) mà gian hàng CTV mở trong Zalo gửi slug
   * viết thường làm mã (storefront.service.ts slug = referralCode.toLowerCase()); Postgres so khớp phân biệt hoa/thường nên
   * phải chuẩn hoá ngay tại lớp so khớp này, không dựa vào nơi gọi.
   */
  async findEligibleReferrer(referralCode: string, buyerId: string): Promise<string | null> {
    const ref = await this.prisma.user.findUnique({
      where: { referralCode: referralCode.toUpperCase() },
      select: { id: true, role: true, isBlocked: true, mergedIntoId: true, storefronts: SAMPLE_STOREFRONT_SELECT },
    });
    // Tài khoản bị khoá không ghi công đơn mới; hoa hồng đã tạo cho đơn cũ giữ nguyên. Chủ gian hàng mẫu không nhận hoa hồng.
    // Dòng khách đã gộp vào tài khoản khác (auth.service gộp bỏ lại vai trò CTV ở dòng cũ) không còn người dùng nên không ghi công.
    if (!ref || ref.id === buyerId || ref.isBlocked || ref.mergedIntoId || ref.storefronts.length > 0) return null;
    return (await this.commissionEligibleRoles()).has(ref.role) ? ref.id : null;
  }

  /** Người dùng (chủ gian hàng CTV, người của "chạm") có thuộc vai trò được ghi công đơn không — checkout/attribution.ts. */
  async isCommissionEligible(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, isBlocked: true, mergedIntoId: true, storefronts: SAMPLE_STOREFRONT_SELECT } });
    return !!u && !u.isBlocked && !u.mergedIntoId && u.storefronts.length === 0 && (await this.commissionEligibleRoles()).has(u.role);
  }

  /** Điều kiện khách thấy một gian hàng (storefront/storefront-visibility.ts) tính từ cấu hình hiện hành. */
  storefrontVisibility(): Promise<PublicVisibilityOptions> {
    return loadPublicVisibility(this.config);
  }

  /** Vai trò được ghi công đơn và hưởng hoa hồng (khoá `affiliate.commission_eligible_roles`, mặc định CTV + đại lý). */
  async commissionEligibleRoles(): Promise<ReadonlySet<UserRole>> {
    return sanitizeEligibleRoles(await this.config.get<unknown>(COMMISSION_ELIGIBLE_ROLES_KEY, DEFAULT_COMMISSION_ELIGIBLE_ROLES));
  }

  /** Lấy "chạm" còn hạn của khách (fallback attribution khi phiên đã mất). */
  async getActiveTouch(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ referrerUserId: string; storefrontSlug: string | null; kind: string } | null> {
    const t = await this.prisma.referralTouch.findUnique({ where: { userId } });
    if (!t || t.expiresAt <= now) return null;
    return { referrerUserId: t.referrerUserId, storefrontSlug: t.storefrontSlug, kind: t.kind };
  }

  async createLink(userId: string, targetType: string, targetId?: string) {
    const shortCode = randomBytes(5).toString('base64url');
    return this.prisma.affiliateLink.create({
      data: { userId, shortCode, targetType, targetId },
    });
  }

  /** Mới nhất trước; mặc định 100 (tối đa 200) — CTV tạo link vô hạn nên không thể trả hết một lần. */
  listLinks(userId: string, opts: { take?: number; cursor?: string } = {}) {
    return this.prisma.affiliateLink.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(opts.take ?? 100, 1), 200),
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
  }

  /** Track click (web redirect /r/:shortCode). Trả target để redirect. */
  async trackClick(shortCode: string, visitorId: string, ipHash: string, dedupeDay?: string) {
    const link = await this.prisma.affiliateLink.findUnique({ where: { shortCode } });
    if (!link) return null;
    await this.prisma.$transaction([
      this.prisma.affiliateLink.update({ where: { id: link.id }, data: { clicks: { increment: 1 } } }),
      this.prisma.affiliateClick.create({ data: { shortCode, visitorId, ipHash, ...(dedupeDay ? { dedupeDay } : {}) } }),
    ]);
    return { targetType: link.targetType, targetId: link.targetId };
  }

  /**
   * Lượt mở link CTV từ phía khách (route công khai, không có userId). Khách chưa biết là ai nên "người xem" là mã HMAC của IP
   * (khoá của máy chủ, xem common/ip-hash.ts); IP thô không lưu. Mỗi (mã link, IP băm, ngày giờ VN) đếm một lần: khoá duy nhất của affiliate_clicks chặn lần thứ hai, và
   * giao dịch hoàn tác luôn cả phần +1 clicks nên không cần đọc bảng (đang đánh dấu @deprecated, chỉ ghi).
   */
  async recordLinkClick(shortCode: string, ip: string, now: Date = new Date()): Promise<{ counted: boolean }> {
    const ipHash = hashIp(ip, this.env?.get('JWT_ACCESS_SECRET', { infer: true }), 'affiliate-click');
    try {
      const target = await this.trackClick(shortCode, ipHash, ipHash, vnDateKey(now));
      return { counted: target !== null };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { counted: false };
      throw err;
    }
  }

  async dashboard(userId: string, now: Date = new Date()) {
    // Mốc ngày/tháng theo giờ VN (máy chủ Docker chạy UTC → new Date(y, m, 1) lệch 7 tiếng).
    const month = vnMonthBounds(now);
    const startOfMonth = month.start;
    const startOfDay = vnDayStart(now);

    const [today, monthCommission, pending, approved, links, conversions, monthRevenue, withdrawing] = await Promise.all([
      this.sumCommission(userId, startOfDay),
      this.sumCommission(userId, startOfMonth),
      this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, status: { in: ['PENDING', 'LOCKED'] } },
        _sum: { amount: true },
      }),
      this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, status: 'APPROVED', payoutBatchId: null },
        _sum: { amount: true },
      }),
      this.prisma.affiliateLink.aggregate({
        where: { userId },
        _sum: { clicks: true },
      }),
      // Đơn và lượt chạm không lưu mã link nên cột affiliate_links.conversions không có chỗ tăng; "chuyển đổi" = số đơn đã ghi công.
      // Mỗi (đơn, CTV) tối đa một dòng hoa hồng (unique) nên webhook lặp không đếm đôi; đơn huỷ/trả (REJECTED) không tính.
      this.prisma.commission.count({ where: { affiliateUserId: userId, status: { not: 'REJECTED' } } }),
      // Doanh số tháng = doanh số ĐÃ CHỐT (cùng định nghĩa với bậc/mốc — xem ctv-milestones.ts).
      // Trước đây: orderTotal mọi commission khác REJECTED tạo trong tháng → gồm cả đơn còn huỷ
      // được, hàng bị chặn affiliate và phí ship.
      this.confirmedRevenue(this.prisma, userId, month),
      this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, status: 'APPROVED', payoutBatchId: { not: null } },
        _sum: { amount: true },
      }),
    ]);

    const withdrawable = approved._sum.amount ?? 0;
    const autoWalletTransfer =
      (await this.config.get<unknown>(AFFILIATE_AUTO_WALLET_TRANSFER_KEY, DEFAULT_AFFILIATE_AUTO_WALLET_TRANSFER_ENABLED)) === true;
    return {
      // Chữ trên trang CTV/Ví nói hoa hồng tự vào Ví hay phải bấm tay theo cờ này.
      autoWalletTransfer,
      // Thuế sẽ bị khấu trừ nếu rút hết số khả dụng ngay bây giờ (cộng dồn tháng VN); chỉ để hiển thị, lệnh rút tính lại dưới khoá.
      withdrawTaxPreview: withdrawable > 0 ? await this.personalIncomeTax(this.prisma, userId, withdrawable, now) : 0,
      withdrawingCommission: withdrawing._sum.amount ?? 0,
      todayCommission: today,
      monthCommission,
      pendingCommission: pending._sum.amount ?? 0,
      withdrawableCommission: withdrawable,
      totalClicks: links._sum.clicks ?? 0,
      totalConversions: conversions,
      monthRevenue,
      // bonusPct: 0 CHỈ để tương thích bản miniapp cũ còn trên Zalo (render "Bonus +{bonusPct}%" —
      // thiếu field sẽ hiện "+undefined%"). Luôn 0 vì không có luồng nào trả khoản này; bản mới không đọc.
      tier: { ...this.monthlyTier(monthRevenue), bonusPct: 0 },
    };
  }

  /**
   * Bậc CTV theo doanh số đã chốt tháng (Build Spec §6.8.2). Chỉ là danh hiệu — KHÔNG kèm
   * "+X% bonus": chưa có luồng nào trả khoản đó (xem ctv-milestones.ts).
   */
  private monthlyTier(revenue: number) {
    return tierForRevenue(revenue);
  }

  /**
   * Doanh số CTV ĐÃ CHỐT trong tháng VN `month`: commissionableTotal của commission APPROVED/PAID
   * có approvedAt trong tháng. Định nghĩa DUY NHẤT cho dashboard/getMe/bậc/mốc/claim — UI không
   * bao giờ hiện "nhận được" mà claim lại từ chối (hoặc ngược lại). Nhận `db` để claim đọc CÙNG tx.
   */
  private async confirmedRevenue(db: Db, userId: string, month: VnMonth): Promise<number> {
    const agg = await db.commission.aggregate({
      where: {
        affiliateUserId: userId,
        status: { in: [...CONFIRMED_COMMISSION_STATUSES] },
        approvedAt: { gte: month.start, lt: month.end },
      },
      _sum: { commissionableTotal: true },
    });
    return agg._sum.commissionableTotal ?? 0;
  }

  /**
   * Bậc CTV để hiện công khai trên trang gian hàng (storefront.service.ts getPublicBySlug) —
   * CHỈ trả tên+icon, KHÔNG trả doanh thu/bonusPct thật để tránh lộ doanh số CTV cho khách xem
   * gian hàng của họ.
   */
  async getPublicTier(userId: string, now: Date = new Date()): Promise<{ name: string; emoji: string; publicBadge: boolean }> {
    // Cùng định nghĩa doanh số ĐÃ CHỐT (tháng VN) với dashboard/bậc của chính CTV — huy hiệu công
    // khai không được "cao hơn" bậc CTV tự thấy.
    const revenue = await this.confirmedRevenue(this.prisma, userId, vnMonthBounds(now));
    const tier = this.monthlyTier(revenue);
    // publicBadge=false ở bậc thấp nhất: trang shop công khai chỉ khoe từ bậc 2 (huy hiệu "Tân binh" không thêm niềm tin cho khách).
    return { name: tier.name, emoji: tier.emoji, publicBadge: tier.name !== CTV_TIERS[0]!.name };
  }

  /** Mới nhất trước; mặc định 100 như trước khi có phân trang (client cũ không gửi tham số), tối đa 200 mỗi lần. */
  async listCommissions(userId: string, opts: { take?: number; cursor?: string } = {}) {
    const rows = await this.prisma.commission.findMany({
      where: { affiliateUserId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(opts.take ?? 100, 1), 200),
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      include: { order: { select: { code: true, status: true } } },
    });
    // SELLER-10: "Đang rút" = đã duyệt nhưng nằm trong lệnh rút ngân hàng chưa chuyển tiền (PAID chỉ khi admin xác nhận).
    return rows.map(({ order, ...c }) => ({
      ...c,
      orderCode: order?.code ?? null,
      orderStatus: order?.status ?? null,
      withdrawing: c.status === 'APPROVED' && c.payoutBatchId !== null,
    }));
  }

  /**
   * Lịch sử lệnh rút của CTV: trạng thái, lý do từ chối, mã giao dịch, thuế TNCN đã khấu trừ (SELLER-10, SELLER-11).
   * `taxWithheld` là thuế thực giữ (đã trừ phần hoàn về Ví, `taxRefunded`) để các màn cũ hiện đúng mà không phải sửa.
   */
  async listMyPayouts(userId: string, opts: { take?: number; cursor?: string } = {}) {
    const rows = await this.prisma.payout.findMany({
      where: { userId },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(opts.take ?? 50, 1), 200),
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        amount: true,
        grossAmount: true,
        taxWithheld: true,
        taxRefunded: true,
        fee: true,
        method: true,
        status: true,
        rejectionReason: true,
        bankRef: true,
        requestedAt: true,
        reviewedAt: true,
        paidAt: true,
      },
    });
    return rows.map((p) => ({ ...p, taxWithheld: p.taxWithheld - p.taxRefunded }));
  }

  /**
   * Lệnh rút hoa hồng (có grossAmount, khác rút Ví) đã chi trong [start, end). Báo cáo dùng thuế thực giữ (taxWithheld −
   * taxRefunded) và thực nhận gồm cả phần thuế đã hoàn về Ví, để thu nhập = thuế thực giữ + thực nhận.
   */
  private paidCommissionPayouts(where: Prisma.PayoutWhereInput, start: Date, end: Date) {
    return this.prisma.payout.findMany({
      where: { ...where, status: 'PAID', grossAmount: { not: null }, paidAt: { gte: start, lt: end } },
      orderBy: { paidAt: 'asc' },
      select: {
        id: true,
        userId: true,
        method: true,
        grossAmount: true,
        taxWithheld: true,
        taxRefunded: true,
        amount: true,
        taxId: true,
        paidAt: true,
        user: { select: { fullName: true, phone: true, personalTaxId: true } },
      },
    });
  }

  /**
   * Báo cáo khấu trừ thuế TNCN theo tháng (giờ VN) cho kế toán kê khai: mọi lần chi hoa hồng cho cá nhân trong tháng, gộp theo
   * người nhận. MST lấy theo số đã chụp vào lệnh rút (số đã kê khai), thiếu thì theo hồ sơ hiện tại.
   */
  async pitReport(month: string) {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
    if (!m) throw new BadRequestException('Tháng phải có dạng YYYY-MM.');
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const start = new Date(Date.UTC(y, mo, 1) - VN_OFFSET_MS);
    const end = new Date(Date.UTC(y, mo + 1, 1) - VN_OFFSET_MS);
    const payouts = await this.paidCommissionPayouts({}, start, end);
    const byUser = new Map<
      string,
      { userId: string; fullName: string | null; phone: string | null; taxId: string | null; payoutCount: number; grossAmount: number; taxWithheld: number; netAmount: number }
    >();
    for (const p of payouts) {
      const row = byUser.get(p.userId) ?? {
        userId: p.userId,
        fullName: p.user.fullName,
        phone: p.user.phone,
        taxId: null,
        payoutCount: 0,
        grossAmount: 0,
        taxWithheld: 0,
        netAmount: 0,
      };
      row.taxId = p.taxId ?? row.taxId ?? p.user.personalTaxId;
      row.payoutCount += 1;
      row.grossAmount += p.grossAmount ?? 0;
      row.taxWithheld += p.taxWithheld - p.taxRefunded;
      row.netAmount += p.amount + p.taxRefunded;
      byUser.set(p.userId, row);
    }
    const rows = [...byUser.values()].sort((a, b) => b.taxWithheld - a.taxWithheld || b.grossAmount - a.grossAmount);
    const sum = (k: 'grossAmount' | 'taxWithheld' | 'netAmount') => rows.reduce((s, r) => s + r[k], 0);
    return {
      month,
      rows,
      totals: {
        recipients: rows.length,
        withheldRecipients: rows.filter((r) => r.taxWithheld > 0).length,
        grossAmount: sum('grossAmount'),
        taxWithheld: sum('taxWithheld'),
        netAmount: sum('netAmount'),
      },
    };
  }

  /** Bảng kê thu nhập hoa hồng và thuế TNCN đã khấu trừ trong năm (giờ VN) của một CTV, kèm MST đang khai. */
  async taxStatement(userId: string, year: number) {
    if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new BadRequestException('Năm không hợp lệ.');
    const start = new Date(Date.UTC(year, 0, 1) - VN_OFFSET_MS);
    const end = new Date(Date.UTC(year + 1, 0, 1) - VN_OFFSET_MS);
    const [payouts, user] = await Promise.all([
      this.paidCommissionPayouts({ userId }, start, end),
      this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, personalTaxId: true } }),
    ]);
    const items = payouts.map((p) => ({
      id: p.id,
      paidAt: p.paidAt,
      method: p.method,
      grossAmount: p.grossAmount ?? 0,
      taxWithheld: p.taxWithheld - p.taxRefunded,
      amount: p.amount + p.taxRefunded,
      taxId: p.taxId,
    }));
    const sum = (k: 'grossAmount' | 'taxWithheld' | 'amount') => items.reduce((s, i) => s + i[k], 0);
    return {
      year,
      fullName: user?.fullName ?? null,
      taxId: user?.personalTaxId ?? null,
      items,
      totals: { grossAmount: sum('grossAmount'), taxWithheld: sum('taxWithheld'), netAmount: sum('amount') },
    };
  }

  /**
   * MST/CCCD chụp vào lệnh rút. CTV khai trong lần rút thì lưu vào hồ sơ; lần rút bị khấu trừ thuế TNCN mà chưa có số nào thì
   * từ chối: Tubu Tree phải kê khai khấu trừ theo MST người nhận và cấp chứng từ khấu trừ cho họ (SELLER-11).
   */
  private async taxIdForPayout(
    tx: Prisma.TransactionClient,
    userId: string,
    taxWithheld: number,
    input?: string,
  ): Promise<string | null> {
    const given = input?.trim();
    if (given) {
      if (!PERSONAL_TAX_ID_PATTERN.test(given)) throw new BadRequestException(PERSONAL_TAX_ID_FORMAT_MESSAGE);
      await tx.user.update({ where: { id: userId }, data: { personalTaxId: given } });
      return given;
    }
    if (taxWithheld <= 0) return null;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { personalTaxId: true } });
    if (user?.personalTaxId) return user.personalTaxId;
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      code: PIT_TAX_ID_REQUIRED,
      message: `Lần chuyển này được khấu trừ thuế TNCN ${vnd(taxWithheld)}. Nhập mã số thuế cá nhân hoặc số CCCD để Tubu Tree kê khai và cấp chứng từ khấu trừ thuế cho bạn.`,
    });
  }

  /**
   * Khoá theo (CTV, tháng VN) trong transaction rút tiền: hai lệnh rút cùng lúc của một CTV phải đọc tổng tháng nối tiếp nhau, nếu
   * không cả hai cùng thấy "chưa rút gì" và cùng thoát khấu trừ. Lấy TRƯỚC khi đọc hoa hồng khả dụng để lệnh đến sau đọc số mới.
   */
  async lockPitMonth(tx: Prisma.TransactionClient, userId: string, now: Date): Promise<void> {
    const month = vnMonthBounds(now).key;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PIT_MONTH_LOCK}), hashtext(${`${userId}:${month}`}))`;
  }

  private async pitConfig(): Promise<{ pct: number; threshold: number }> {
    const [pct, threshold] = await Promise.all([
      this.config.get<number>('affiliate.pit_withhold_pct', DEFAULT_PIT_WITHHOLD_PCT),
      this.config.get<number>('affiliate.pit_withhold_threshold', DEFAULT_PIT_WITHHOLD_THRESHOLD),
    ]);
    return { pct, threshold };
  }

  /** Thuế phải giữ cho cả tháng: pct × tổng thu nhập hoa hồng của tháng khi tổng từ ngưỡng trở lên, ngược lại 0. */
  private pitRequired(monthGross: number, cfg: { pct: number; threshold: number }): number {
    return cfg.pct > 0 && monthGross >= cfg.threshold ? Math.round(monthGross * Math.min(cfg.pct, 1)) : 0;
  }

  /**
   * Thuế TNCN khấu trừ khi trả hoa hồng cho cá nhân không ký hợp đồng lao động (`affiliate.pit_withhold_pct`, mặc định 10% từ
   * 5.000.000đ; 0% = tắt). Hoa hồng là thù lao bằng tiền nên chuyển vào Ví vẫn là thu nhập tiền công theo Luật Thuế TNCN 2025. LUẬT
   * (khoản 2 Điều 50 Nghị định 253/2026/NĐ-CP, hiệu lực 01/07/2026, thay ngưỡng 2.000.000đ của Thông tư 111/2013/TT-BTC): khấu trừ
   * 10% khi trả từ 5.000.000đ MỖI LẦN; dưới mức đó chỉ khấu trừ khi cá nhân yêu cầu. MÃ này cộng dồn theo tháng VN nên CHẶT HƠN luật,
   * cố ý để không chia nhỏ lần chuyển né thuế (lấy cùng con số 5.000.000đ làm ngưỡng cho TỔNG tháng). Ngưỡng xét trên TỔNG các lệnh
   * chuyển hoa hồng trong tháng VN, kể cả lần này:
   * từ ngưỡng trở lên thì khấu trừ pct × tổng tháng trừ phần thuế thực giữ ở các lệnh trước (taxWithheld − taxRefunded; truy thu
   * các lần nhỏ trước đó). Phần truy thu vượt số tiền lần này thì chỉ trừ tối đa bằng lần này, phần còn thiếu dồn sang lần sau.
   * Lệnh bị từ chối và lệnh rút Ví về ngân hàng cũ (không có grossAmount) không tính. Phải gọi sau `lockPitMonth` trong cùng transaction.
   */
  async personalIncomeTax(tx: Prisma.TransactionClient, userId: string, gross: number, now: Date = new Date()): Promise<number> {
    const cfg = await this.pitConfig();
    if (!(cfg.pct > 0)) return 0;
    const { start, end } = vnMonthBounds(now);
    const prior = await tx.payout.aggregate({
      where: { userId, grossAmount: { not: null }, status: { not: 'REJECTED' }, requestedAt: { gte: start, lt: end } },
      _sum: { grossAmount: true, taxWithheld: true, taxRefunded: true },
    });
    const monthGross = (prior._sum.grossAmount ?? 0) + gross;
    const heldBefore = (prior._sum.taxWithheld ?? 0) - (prior._sum.taxRefunded ?? 0);
    const owed = this.pitRequired(monthGross, cfg) - heldBefore;
    return Math.min(Math.max(owed, 0), gross);
  }

  /**
   * Sau khi một lệnh rút hoa hồng bị từ chối: tính lại thuế của tháng VN chứa lệnh đó và trả phần thuế đã giữ dư (đã cộng dồn
   * theo tổng tháng cũ). Chia cho lệnh mới nhất trước, mỗi lệnh tối đa số thuế thực giữ của nó. Lệnh còn "Yêu cầu" giảm thuế và
   * tăng số thực nhận ngay trên lệnh (chưa chi, còn có thể bị từ chối: cộng Ví lúc này thì lệnh đó bị từ chối sẽ trả CTV hai lần);
   * lệnh đã duyệt/đã chi (kể cả rút về Ví) không bị từ chối nữa nên cộng Ví Tubu và ghi vào taxRefunded. Thiếu thì để lần rút sau
   * trong tháng truy thu. Phải gọi sau `lockPitMonth` trong cùng transaction.
   */
  private async refundOverheldPit(tx: Prisma.TransactionClient, rejected: { id: string; userId: string; requestedAt: Date }) {
    const cfg = await this.pitConfig();
    const { start, end, key } = vnMonthBounds(rejected.requestedAt);
    const rows = await tx.payout.findMany({
      where: { userId: rejected.userId, grossAmount: { not: null }, status: { not: 'REJECTED' }, requestedAt: { gte: start, lt: end } },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, status: true, grossAmount: true, taxWithheld: true, taxRefunded: true },
    });
    const monthGross = rows.reduce((sum, r) => sum + (r.grossAmount ?? 0), 0);
    const held = rows.reduce((sum, r) => sum + r.taxWithheld - r.taxRefunded, 0);
    let over = held - this.pitRequired(monthGross, cfg);
    if (over <= 0) return;

    const vn = new Date(rejected.requestedAt.getTime() + VN_OFFSET_MS);
    const day = `${String(vn.getUTCDate()).padStart(2, '0')}/${String(vn.getUTCMonth() + 1).padStart(2, '0')}`;
    const month = `${key.slice(5)}/${key.slice(0, 4)}`;
    for (const r of rows) {
      if (over <= 0) break;
      const share = Math.min(r.taxWithheld - r.taxRefunded, over);
      if (share <= 0) continue;
      if (r.status === 'REQUESTED') {
        // Admin khác có thể vừa duyệt lệnh này giữa lúc đọc và lúc ghi (approvePayout không lấy khoá tháng): count 0 thì đã thành
        // lệnh không từ chối được, đi đường cộng Ví.
        const adjusted = await tx.payout.updateMany({
          where: { id: r.id, status: 'REQUESTED' },
          data: { taxWithheld: { decrement: share }, amount: { increment: share } },
        });
        if (adjusted.count > 0) {
          over -= share;
          continue;
        }
      }
      const credited = await applyWalletDelta(tx, {
        userId: rejected.userId,
        delta: share,
        type: 'PIT_REFUND',
        refType: 'PAYOUT',
        // Một lệnh có thể nhận hoàn từ nhiều lần từ chối khác nhau: khoá theo cặp (lệnh nhận, lệnh bị từ chối).
        refId: `${r.id}:${rejected.id}`,
        reason: `Hoàn thuế TNCN giữ dư tháng ${month} (lệnh rút ngày ${day} bị từ chối)`,
      });
      // Sổ đã có dòng hoàn cho cặp này (applied=false) nghĩa là Ví không nhận thêm: tăng taxRefunded lúc này thì báo cáo thuế ghi
      // đã hoàn mà CTV không có tiền, nên dừng cả giao dịch từ chối để người vận hành xem lại.
      if (!credited.applied) {
        throw new ConflictException('Sổ Ví đã có dòng hoàn thuế TNCN cho lệnh này, không ghi thêm được. Vui lòng báo kỹ thuật.');
      }
      await tx.payout.update({ where: { id: r.id }, data: { taxRefunded: { increment: share } } });
      over -= share;
    }
  }

  /** Chống tự-giao-dịch: chỉ CTV (AFFILIATE) hoặc ADMIN mới được lên đơn hộ hưởng hoa hồng (canPlaceOrderForCustomer). */
  private async customerOrderPlacer(ctvId: string) {
    const ctv = await this.prisma.user.findUniqueOrThrow({ where: { id: ctvId } });
    if (!canPlaceOrderForCustomer(ctv.role)) {
      throw new BadRequestException('Chỉ CTV mới có thể lên đơn hộ khách.');
    }
    return ctv;
  }

  /**
   * Giá đơn hộ, cùng luật giá với giỏ khách tự đặt (CartService.getCart → priceFlashLine): giá đang bán, hoặc giá giờ vàng khi
   * còn suất và số lượng nằm trong số suất người đặt còn mua được. Người đặt là tài khoản CTV (Order.userId) nên suất giữ và
   * hoàn khi huỷ theo tài khoản đó. Dòng trùng biến thể gộp lại để xét suất trên tổng số lượng. Phí giao như đơn của khách
   * chưa có hạng. Kiểm SP còn bán (biến thể và SP cha đang bán, đã duyệt).
   */
  private async priceCustomerOrder(ctvId: string, items: { variationId: string; quantity: number }[]) {
    const quantities = new Map<string, number>();
    for (const i of items) quantities.set(i.variationId, (quantities.get(i.variationId) ?? 0) + i.quantity);
    const variationIds = [...quantities.keys()];
    const variations = await this.prisma.variation.findMany({
      where: { id: { in: variationIds } },
      include: { product: { select: { name: true, slug: true, isActive: true, approvalStatus: true } } },
    });
    const vmap = new Map(variations.map((v) => [v.id, v]));
    const offers = this.flashSale
      ? await this.flashSale.resolveEffective(variationIds, new Date(), ctvId)
      : new Map<string, EffectivePrice>();
    const lines = [...quantities].map(([variationId, quantity]) => {
      const v = vmap.get(variationId);
      if (!v) throw new BadRequestException('Sản phẩm không còn khả dụng.');
      if (!isSellableVariation(v)) throw productDiscontinuedError(v.product.name);
      const price = priceFlashLine(v.salePrice ?? v.retailPrice, quantity, offers.get(v.id));
      return {
        variationId: v.id,
        productName: v.product.name,
        productSlug: v.product.slug,
        variationName: v.name,
        unitPrice: price.unitPrice,
        quantity,
        total: price.unitPrice * quantity,
        flashSaleItemId: price.flash?.itemId ?? null,
        flashLimitNotice: price.flashLimitNotice,
      };
    });
    const goods = lines.reduce((s, l) => s + l.total, 0);
    const shippingFee = await this.pricing.calcShippingFee({ subtotal: goods, tierId: null });
    return { lines, goods, shippingFee, total: goods + shippingFee };
  }

  /**
   * Báo giá cho form lên đơn hộ: đúng số tiền placeOrderForCustomer sẽ tính, không giữ kho hay suất giờ vàng. Từ chối đúng những
   * dòng bước tạo đơn từ chối (hàng gian hàng đối tác tự giao) để CTV biết trước khi báo giá cho khách.
   */
  async quoteOrderForCustomer(ctvId: string, dto: QuoteOrderForCustomerDto) {
    if (!dto.items || dto.items.length === 0) throw new BadRequestException('Chưa chọn sản phẩm để lên đơn.');
    await this.customerOrderPlacer(ctvId);
    const priced = await this.priceCustomerOrder(ctvId, dto.items);
    await assertVariationsSellable(this.prisma, priced.lines, { pancakeOnly: true });
    return {
      items: priced.lines.map((l) => ({
        variationId: l.variationId,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        total: l.total,
        isFlash: l.flashSaleItemId !== null,
        flashLimitNotice: l.flashLimitNotice,
      })),
      goods: priced.goods,
      shippingFee: priced.shippingFee,
      total: priced.total,
      blockedPaymentMethods: blockedCtvPaymentMethods(priced.total),
    };
  }

  /**
   * Giữ suất giờ vàng của các dòng trong transaction đơn hộ (như checkout, khoá theo pha: xem FlashSaleService.consumeQuotas).
   * Ném lỗi của dòng hỏng đầu tiên theo thứ tự dòng: vượt giới hạn mua báo FLASH_LIMIT kèm giới hạn của suất đó; hết suất hoặc hết giờ giữa lúc tính giá
   * và lúc ghi đơn thì báo PRICE_CHANGED để CTV xem giá mới, không âm thầm tính giá giờ vàng đã hết. Thua tranh khoá → 503 thử
   * lại, không báo hết suất cho một lỗi không liên quan tới suất.
   */
  private async consumeFlashQuotas(
    tx: Prisma.TransactionClient,
    lines: { flashSaleItemId: string | null; productName: string; quantity: number }[],
    ctvId: string,
    code: string,
  ): Promise<void> {
    if (!this.flashSale) return;
    const flash = lines.flatMap((l) =>
      l.flashSaleItemId ? [{ flashSaleItemId: l.flashSaleItemId, quantity: l.quantity, productName: l.productName }] : [],
    );
    if (flash.length === 0) return;
    const priceChanged = (productName: string) =>
      new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'PRICE_CHANGED',
        message: `Giá giờ vàng của "${productName}" vừa hết suất hoặc hết giờ. Vui lòng xem lại giá rồi tạo đơn lại.`,
      });
    let outcomes: FlashQuotaOutcome[];
    try {
      outcomes = await this.flashSale.consumeQuotas(tx, ctvId, flash, new Date());
    } catch (e) {
      const original = e instanceof FlashQuotaLineError ? e.original : e;
      const line = flash[e instanceof FlashQuotaLineError ? e.lineIndex : 0]!;
      const detail = `đơn hộ ${code}, flashSaleItemId=${line.flashSaleItemId}: ${original instanceof Error ? original.message : original}`;
      if (isLockBusy(original)) {
        this.logger.warn(`consumeQuotas thua tranh khoá cho ${detail}`);
        throw new ServiceUnavailableException(LOCK_BUSY_MESSAGE);
      }
      this.logger.error(`consumeQuotas lỗi cho ${detail}`);
      throw priceChanged(line.productName);
    }
    const failed = outcomes.findIndex((o) => o !== 'OK');
    if (failed < 0) return;
    if (outcomes[failed] === 'OVER_LIMIT') throw await this.flashSale.overLimitError(tx, flash[failed]!.flashSaleItemId);
    this.logger.error(`consumeQuotas hết suất cho đơn hộ ${code}, flashSaleItemId=${flash[failed]!.flashSaleItemId}`);
    throw priceChanged(flash[failed]!.productName);
  }

  /**
   * CTV "lên đơn hộ khách": CTV đặt đơn giao cho khách cuối, CTV hưởng hoa hồng.
   * MONEY-CRITICAL — trừ stock ATOMIC (mirror checkout.placeOrder) + tạo hoa hồng cho CTV.
   * KHÔNG coupon/điểm, chỉ COD/chuyển khoản. Đơn đánh dấu placedForCustomer=true để
   * createCommissionForOrder cho phép self-referral (userId==referrerUserId==CTV).
   * Giá như khách tự đặt (priceCustomerOrder), kể cả giờ vàng: suất giữ trong cùng transaction với đơn.
   */
  async placeOrderForCustomer(ctvId: string, dto: PlaceOrderForCustomerDto, idempotencyKey?: string) {
    // Chuẩn hoá key rỗng/khoảng trắng → undefined (mirror wallet.withdraw / checkout.placeOrder):
    // tránh ghi '' vào Order.idempotencyKey (unique) rồi lần đặt hộ tiếp theo cũng '' đụng P2002.
    const key = idempotencyKey?.trim() || undefined;
    // Double-tap/retry cùng key → trả lại đơn đã tạo, KHÔNG trừ kho / tạo commission lần 2
    // (trước đây endpoint này — khác placeOrder thường — không có bảo vệ double-submit).
    if (key) {
      const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: key } });
      if (existing && existing.userId === ctvId) return this.orderForCtv(existing.id);
      if (existing) throw new BadRequestException('Idempotency-Key đã được sử dụng, vui lòng thử lại.');
    }
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Chưa chọn sản phẩm để lên đơn.');
    }
    const ctv = await this.customerOrderPlacer(ctvId);
    // Kiểm lại ở đây chứ không chỉ ở DTO: so với SĐT của CTV và khoá gộp khách đều cần đúng một dạng 0xxxxxxxxx.
    const customerPhone = parseTypedVnPhone(dto.customer.phone);
    if (!customerPhone) throw new BadRequestException(TYPED_VN_PHONE_MESSAGE);
    // Đơn hộ được phép tự-giới-thiệu (referrer == userId) vì người nhận là khách khác; nếu người
    // nhận chính là CTV thì đó là mua cho mình mà vẫn ăn hoa hồng, và tiền hoàn (theo SĐT người
    // nhận) cũng chảy về CTV.
    const ctvPhone = ctv.phone ? normalizeZaloPhone(ctv.phone) : null;
    if (ctvPhone && ctvPhone === customerPhone) {
      throw new BadRequestException(
        'Không thể lên đơn hộ với SĐT của chính bạn. Hãy đặt hàng như khách thường cho đơn của mình.',
      );
    }

    const { lines, goods, shippingFee, total } = await this.priceCustomerOrder(ctvId, dto.items);
    // CTV đã báo khách tổng ở bước báo giá: giờ vàng hết hoặc phí đổi trong lúc đó thì không âm thầm ghi đơn đắt hơn (rẻ hơn thì
    // được), như đặt hàng thường.
    if (dto.expectedTotal != null && total > dto.expectedTotal) {
      throw totalChangedError(totalChangedMessage(dto.expectedTotal, total));
    }
    const codBlocked = dto.paymentMethod === 'COD' ? ctvCodBlockReason(total) : null;
    if (codBlocked) {
      throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: PAYMENT_METHOD_NOT_ALLOWED, message: codBlocked });
    }

    // Gian hàng của CTV (nếu có) → gắn slug để analytics theo gian hàng.
    const store = await this.prisma.storefront.findFirst({
      where: { ownerUserId: ctvId },
      select: { slug: true },
    });
    const storefrontSlug = store?.slug ?? null;

    const status = dto.paymentMethod === 'COD' ? 'CONFIRMED' : 'PENDING_PAYMENT';
    const code = await generateUniqueOrderCode(this.prisma, 'RETAIL');
    const shippingAddress = this.customerSnapshot({ ...dto.customer, phone: customerPhone });

    let order: { id: string };
    try {
      order = await this.prisma.$transaction(async (tx) => {
        // SP có thể bị gỡ giữa lúc dựng giá và lúc ghi đơn — kiểm lại trong tx.
        await assertVariationsSellable(tx, lines, { pancakeOnly: true });
        await lockVariationsInIdOrder(tx, lines.map((l) => l.variationId));
        // Giữ chỗ tồn kho ATOMIC từng line — chống oversell; 0 dòng bị sửa → throw rollback. Tới dòng thiếu hàng đầu tiên thì
        // dừng, trừ suất giờ vàng của các dòng trước nó một lượt: lỗi báo CTV vẫn là lỗi của dòng hỏng sớm nhất.
        let short = lines.length;
        for (const [i, line] of lines.entries()) {
          if (!(await reserveVariationStock(tx, line.variationId, line.quantity))) {
            short = i;
            break;
          }
        }
        await this.consumeFlashQuotas(tx, lines.slice(0, short), ctvId, code);
        if (short < lines.length) {
          throw new BadRequestException(`Sản phẩm "${lines[short]!.productName}" không đủ tồn kho.`);
        }
        const created = await tx.order.create({
          data: {
            code,
            userId: ctvId,
            type: 'RETAIL',
            status,
            subtotal: goods,
            discount: 0,
            shippingFee,
            total,
            pointsEarned: 0,
            pointsUsed: 0,
            paymentMethod: dto.paymentMethod,
            paymentStatus: 'UNPAID',
            shippingAddress,
            referrerUserId: ctvId,
            storefrontSlug,
            placedForCustomer: true,
            source: 'ctv_assisted',
            platform: 'miniapp',
            // KHÔNG PHẢI hash mật mã — SĐT người nhận chuẩn hoá về DẠNG NỘI ĐỊA 0xxxxxxxxx (xem
            // parseTypedVnPhone ở common/phone.ts), CÙNG dạng User.phone luôn lưu, để 2 giá trị so khớp
            // trực tiếp được nếu người nhận sau này cũng là 1 tài khoản thật. Đơn CTV lên hộ tạo
            // Order qua nhánh RIÊNG này (không qua checkout.service.ts) nên đây là nơi DUY NHẤT
            // set 3 cột này cho loại đơn "lên đơn hộ" — thiếu bước này (hoặc chuẩn hoá sai dạng)
            // thì quyết định "tính doanh số cho khách nhận hàng qua endCustomerKey" lặng lẽ không
            // có hiệu lực / gộp sai người.
            endCustomerKey: customerPhone,
            note: dto.note,
            idempotencyKey: key ?? null,
            items: {
              create: lines.map((l) => ({
                variationId: l.variationId,
                productName: l.productName,
                productSlug: l.productSlug,
                variationName: l.variationName,
                unitPrice: l.unitPrice,
                quantity: l.quantity,
                total: l.total,
                flashSaleItemId: l.flashSaleItemId,
              })),
            },
          },
        });
        // order_placed atomic với đơn (cùng tx) — mirror checkout.service.ts (Task 4), nhưng bắt
        // buộc phát RIÊNG ở đây vì placeOrderForCustomer tạo Order qua nhánh hoàn toàn khác, không
        // đi qua checkout.service.ts. Không phát order_paid: đơn CTV chỉ COD (không PAID lúc tạo)
        // hoặc chuyển khoản (phủ bởi Pancake reconcile chung cho mọi đơn, Task 5).
        await this.analytics.record(tx, {
          eventName: 'order_placed',
          userId: ctvId,
          platform: 'miniapp',
          storefrontSlug,
          props: {
            orderId: created.id,
            total,
            subtotal: goods,
            discount: 0,
            shippingFee,
            itemCount: lines.length,
            paymentMethod: dto.paymentMethod,
            orderSource: 'ctv_assisted',
          },
        });
        await this.createCommissionForOrder(created.id, tx);
        return created;
      });
    } catch (err) {
      // Race idempotency: lần gửi lại cùng key chạy chồng lên lần đầu (CTV bấm lại sau khi quá thời gian) chờ khoá dòng kho của
      // lần đầu, rồi ăn unique-violation (P2002) trên idempotencyKey, hoặc báo hết hàng / hết suất giờ vàng vì chính lần đầu vừa
      // giữ. Đơn của key đó đã có thì trả lại đơn đó thay vì báo lỗi cho một đơn đã tạo.
      if (key) {
        const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: key } });
        if (existing && existing.userId === ctvId) return this.orderForCtv(existing.id);
      }
      throw err;
    }

    // Ngoài tx: xếp hàng đẩy Pancake (retry+backoff qua PancakePushProcessor, mirror
    // checkout.placeOrder — xem P0-2 trong docs/2026-09-08-review-progress.md). Non-fatal —
    // Pancake lỗi/chưa cấu hình không được chặn đơn CTV đã tạo; cron reconcile quét lại sau.
    try {
      await this.pancakeOrder.enqueuePush(order.id);
    } catch (err) {
      this.logger.error(`Xếp hàng đẩy Pancake lỗi cho đơn ${code}: ${err instanceof Error ? err.message : err}`);
    }
    return this.orderForCtv(order.id);
  }

  private async orderForCtv(id: string) {
    return forBuyer(await this.prisma.order.findUniqueOrThrow({ where: { id }, include: { items: true } }));
  }

  /** Snapshot địa chỉ người nhận (khách của CTV) → lưu Order.shippingAddress. */
  private customerSnapshot(c: PlaceOrderForCustomerDto['customer']): Prisma.InputJsonValue {
    return {
      recipient: c.recipient.trim(),
      phone: c.phone,
      province: c.province,
      district: c.district ?? '',
      ward: c.ward,
      street: c.street,
      provinceCode: c.provinceCode,
      districtCode: c.districtCode ?? '',
      wardCode: c.wardCode,
    };
  }

  /**
   * Biến thể của đơn mà người giới thiệu là chủ gian hàng có liên kết ký gửi còn hiệu lực với đúng điều kiện bảng kê trả tiền
   * (consignmentLinkedSql confirmedOnly, tại thời điểm đặt đơn): các dòng này đại lý đã hưởng qua bảng kê nên không hưởng thêm CTV.
   */
  private async ownConsignmentVariationIds(orderId: string, referrerUserId: string, db: Prisma.TransactionClient): Promise<Set<string>> {
    const rows = await db.$queryRaw<{ variationId: string }[]>`
      SELECT DISTINCT oi."variationId"
        FROM "order_items" oi
        JOIN "orders" o ON o."id" = oi."orderId"
        JOIN "storefronts" s ON s."ownerUserId" = ${referrerUserId}
       WHERE oi."orderId" = ${orderId}
         AND ${consignmentLinkedSql(Prisma.sql`s."id"`, true)}`;
    return new Set(rows.map((r) => r.variationId));
  }

  /**
   * Tạo commission PENDING cho đơn có người giới thiệu. Caller tạo đơn truyền `tx` của chính
   * transaction tạo đơn: hoa hồng commit/rollback cùng đơn, lỗi nổi lên thay vì đơn tồn tại mà CTV
   * mất hoa hồng vĩnh viễn (C-002). Gọi lại / gọi song song an toàn: unique (orderId,
   * affiliateUserId) + ON CONFLICT DO NOTHING — không dùng create rồi bắt P2002 vì trong tx của
   * caller lỗi đó làm abort cả transaction đơn.
   */
  async createCommissionForOrder(orderId: string, db: Prisma.TransactionClient = this.prisma): Promise<void> {
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    // Chặn tự-giới-thiệu (referrer == buyer) TRỪ đơn CTV "lên đơn hộ khách"
    // (placedForCustomer=true) — đó là nghiệp vụ hợp lệ: CTV hưởng hoa hồng cho đơn hộ.
    if (!order.referrerUserId || (order.referrerUserId === order.userId && !order.placedForCustomer)) return;
    // Chỉ CTV/đại lý (affiliate.commission_eligible_roles) hưởng hoa hồng: khách thường chia sẻ link chỉ được thưởng điểm giới
    // thiệu (theo User.referredById, không theo đơn). Xét vai trò lúc đặt đơn — CTV lên đại lý (D3-03) vẫn hưởng. Đơn lên hộ
    // khách cũng xét: route lên đơn hộ cho cả ADMIN dùng, admin lên hộ không ăn hoa hồng.
    const referrer = await db.user.findUnique({ where: { id: order.referrerUserId }, select: { role: true, storefronts: SAMPLE_STOREFRONT_SELECT } });
    if (!referrer || referrer.storefronts.length > 0 || !(await this.commissionEligibleRoles()).has(referrer.role)) return;

    const variationIds = order.items.map((i) => i.variationId);
    const variations = await db.variation.findMany({
      where: { id: { in: variationIds } },
      select: { id: true, affiliateRate: true, product: { select: { affiliateBlocked: true, storefrontId: true } } },
    });
    const defaultPct = await loadDefaultRate(this.config);
    const ownConsignment = await this.ownConsignmentVariationIds(order.id, order.referrerUserId, db);
    // Sản phẩm bị chặn affiliate (product.affiliateBlocked) → rate=0, KHÔNG tính hoa hồng cho
    // dòng hàng đó, dù link/CTV nào đã trót chia sẻ trước khi bị chặn (mirror storefront/brand
    // đã lọc affiliateBlocked ở bước hiển thị — chỗ này chặn ở chính điểm phát sinh tiền thật).
    // Hàng ký gửi "Tubu giao hộ" của chính người giới thiệu (đại lý mua qua kênh riêng) cũng rate=0 theo từng dòng, nhưng chỉ khi
    // bảng kê đối tác SẼ trả tiền cho đại lý dòng đó (xem ownConsignmentVariationIds): đơn con Tubu có thể trộn hàng Tubu và
    // hàng của đại lý nên không loại được ở mức đơn. Takeover chưa xác nhận, liên kết đã gỡ, hàng không liên kết: hưởng như thường.
    const rateMap = new Map(
      variations.map((v) => [
        v.id,
        resolveVariationRate({
          explicit: v.affiliateRate,
          blocked: !!v.product?.affiliateBlocked,
          partnerProduct: !!v.product?.storefrontId,
          ownConsignment: ownConsignment.has(v.id),
          defaultPct,
        }),
      ]),
    );

    let amount = 0;
    let weightedRate = 0;
    // Nền doanh số bậc/mốc: chỉ dòng CÓ hưởng hoa hồng (loại hàng bị chặn/rate 0 + phí ship).
    let commissionableTotal = 0;
    // Trả một phần cắt hoa hồng và nền doanh số theo đúng dòng trả (order-reversal.reversePartialReturn) — giữ phần của từng
    // dòng có hoa hồng, kể cả dòng nhỏ tới mức hoa hồng làm tròn về 0 (nền của nó vẫn nằm trong commissionableTotal).
    const lineAmounts: Record<string, number> = {};
    const paid = paidLineTotals(order, order.items);
    order.items.forEach((item, idx) => {
      const rate = rateMap.get(item.variationId) ?? 0;
      const base = paid[idx] ?? 0;
      const lineAmount = Math.floor((base * rate) / 100);
      amount += lineAmount;
      if (rate > 0) lineAmounts[item.id] = (lineAmounts[item.id] ?? 0) + lineAmount;
      weightedRate += rate;
      if (rate > 0) commissionableTotal += base;
    });
    if (amount <= 0) return;

    await db.commission.createMany({
      skipDuplicates: true,
      data: {
        affiliateUserId: order.referrerUserId,
        orderId: order.id,
        orderTotal: order.total,
        commissionableTotal,
        rate: weightedRate / order.items.length,
        amount,
        lineAmounts,
        status: 'PENDING',
      },
    });
  }

  /** Đơn DELIVERED → khóa commission, bắt đầu đếm hold. Trả số dòng vừa khoá (0 khi đã khoá/đã đảo từ trước). */
  async lockCommissionsForOrder(orderId: string): Promise<number> {
    const res = await this.prisma.commission.updateMany({
      where: { orderId, status: 'PENDING' },
      data: { status: 'LOCKED', lockedAt: new Date() },
    });
    return res.count;
  }

  /**
   * Đơn DELIVERED → xét thưởng giới thiệu cho người mời của chủ đơn (Q-05: một chương trình duy
   * nhất, thưởng Điểm Xanh khi người được mời có đơn thứ 2 trong cửa sổ). Không còn voucher REFER/REFERRED
   * 50k+50k: voucher đó cộng thêm cho CTV ngoài hoa hồng và không bị thu hồi khi đơn bị trả. Voucher
   * đã cấp trước đây giữ nguyên.
   */
  async grantReferralReward(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { userId: true, type: true, placedForCustomer: true },
    });
    if (order.type !== 'RETAIL' || order.placedForCustomer) return;
    await this.rewards.grantReferralOrderReward(order.userId);
  }

  /**
   * Đơn hoàn/hủy → thu hồi hoa hồng của đơn. Chưa có đồng nào chuyển (PENDING/LOCKED, hoặc APPROVED chưa vào Ví): đổi REJECTED.
   * Đã vào Ví CTV (PAID qua requestPayout): trừ Ví đúng số hoa hồng bằng dòng COMMISSION_REVERSAL (số dư có thể âm) cùng transaction
   * với việc đổi REJECTED. Nằm trong lệnh rút ngân hàng cũ (đã gán payoutBatchId) hoặc CTV đã xoá tài khoản: không tự trừ, báo
   * kế toán. Mỗi hoa hồng một transaction, khoá dòng hoa hồng trước khi đọc nên cron chuyển vào Ví chạy chen vào chỉ xếp hàng.
   */
  async reverseCommissionsForOrder(orderId: string): Promise<void> {
    // Guard ĐỐI XỨNG với createCommissionForOrder: chỉ đảo khi đơn CÓ hoa hồng hợp lệ.
    // Tự-giới-thiệu organic (referrer==buyer, placedForCustomer=false) không sinh hoa hồng
    // → bỏ qua; đơn CTV lên-đơn-hộ (placedForCustomer=true) VẪN đảo bình thường.
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { code: true, status: true, referrerUserId: true, userId: true, placedForCustomer: true },
    });
    if (!order.referrerUserId || (order.referrerUserId === order.userId && !order.placedForCustomer)) return;
    const cause = order.status === 'CANCELLED' ? 'huỷ đơn' : 'trả hàng';

    const open = await this.prisma.commission.findMany({
      where: { orderId, status: { in: ['PENDING', 'LOCKED', 'APPROVED', 'PAID'] } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const outcomes: CommissionReversal[] = [];
    for (const { id } of open) outcomes.push(await this.reverseCommission(id, order.code, cause));

    // SELLER-10: CTV thấy khoản hoa hồng biến mất mà không ai báo. Báo theo từng CTV (đơn chỉ có một người giới thiệu).
    const byUser = new Map<string, number>();
    for (const o of outcomes) {
      if (o.kind === 'REJECTED' || o.kind === 'DEBITED') byUser.set(o.affiliateUserId, (byUser.get(o.affiliateUserId) ?? 0) + o.amount);
    }
    for (const [uid, amount] of byUser) {
      if (amount <= 0 || !this.notifications) continue;
      await this.notifications
        .notify(uid, CTV_NOTIFICATION.REVERSED, { amount: vnd(amount) })
        .catch((e: unknown) => this.logger.warn(`Báo thu hồi hoa hồng đơn ${orderId} lỗi: ${(e as Error).message}`));
    }
    await this.alertPaidCommissionOfReversedOrder(orderId, order.code, {
      debited: outcomes.flatMap(({ kind, ...note }) => (kind === 'DEBITED' ? [note as CommissionDebitNote] : [])),
      manual: outcomes.flatMap((o) => (o.kind === 'MANUAL' ? [{ affiliateUserId: o.affiliateUserId, amount: o.amount, reason: o.reason }] : [])),
    });
  }

  private reverseCommission(commissionId: string, orderCode: string, cause: 'huỷ đơn' | 'trả hàng'): Promise<CommissionReversal> {
    return this.prisma.$transaction(async (tx): Promise<CommissionReversal> => {
      // Khoá dòng hoa hồng trước khi đọc trạng thái: requestPayout (cron/bấm tay) cũng khoá dòng này trước khi đụng Ví CTV, nên hai
      // bên tuần tự: hoặc ta thấy APPROVED chưa chuyển (đổi REJECTED, requestPayout sau đó báo "dữ liệu đã thay đổi" và thử lại),
      // hoặc ta thấy PAID đã kèm dòng cộng Ví.
      const [row] = await tx.$queryRaw<
        { affiliateUserId: string; amount: number; status: CommissionStatus; payoutBatchId: string | null; walletPayoutId: string | null; paidAt: Date | null }[]
      >`
        SELECT "affiliateUserId", "amount", "status", "payoutBatchId", "walletPayoutId", "paidAt" FROM "commissions" WHERE "id" = ${commissionId} FOR NO KEY UPDATE`;
      if (!row) return { kind: 'NONE' };
      const holding = commissionHolding(row);
      if (holding === 'REJECTED') return { kind: 'NONE' };
      if (holding === 'LEGACY') return { kind: 'MANUAL', affiliateUserId: row.affiliateUserId, amount: row.amount, reason: 'LEGACY_PAYOUT' };
      if (holding === 'WALLET' && row.amount > 0) {
        const debit = await debitCommissionFromWallet(tx, {
          commission: { id: commissionId, ...row },
          amount: row.amount,
          refId: commissionId,
          reason: `Thu hồi hoa hồng đơn ${orderCode} (${cause})`,
        });
        if (!debit.debited) return { kind: 'MANUAL', affiliateUserId: row.affiliateUserId, amount: row.amount, reason: debit.reason };
        await tx.commission.update({ where: { id: commissionId }, data: { status: 'REJECTED' } });
        return { kind: 'DEBITED', ...debit.note };
      }
      await tx.commission.update({ where: { id: commissionId }, data: { status: 'REJECTED' } });
      return { kind: 'REJECTED', affiliateUserId: row.affiliateUserId, amount: row.amount };
    });
  }

  /**
   * Báo quản trị về hoa hồng của đơn bị trả mà Ví CTV đã bị trừ hoặc không tự trừ được. Gửi OPS_REFUND_ALERT khi có việc cho kế toán:
   * - phần không tự trừ được (`manual`: lệnh rút ngân hàng cũ, tài khoản CTV đã xoá, không rõ lệnh chuyển gốc);
   * - khoản đã thu hồi mà lệnh chuyển gốc có grossAmount: báo cáo thuế (pitReport, taxStatement) vẫn kê nó là thu nhập của tháng chi,
   *   và personalIncomeTax cộng nó vào tổng tháng nên lệnh sau trong tháng có thể bị giữ thuế thừa. Payout không tự đổi, kế toán quyết
   *   cách điều chỉnh: tin nêu số gộp đã thu hồi, tháng kê khai, số đã trừ Ví và phần thuế tương ứng;
   * - Ví CTV sau khi trừ đang âm (công nợ cần theo dõi).
   * Lệnh cũ không có grossAmount mà Ví không âm thì chỉ ghi log. Đường trả cả đơn gọi qua reverseCommissionsForOrder (dedupeKey theo
   * đơn vì setStatus được gọi lại khi một bước đảo khác lỗi); đường trả một phần gọi thẳng sau commit, truyền `returnRequestId` để mỗi
   * yêu cầu trả được báo một lần.
   */
  async alertPaidCommissionOfReversedOrder(
    orderId: string,
    orderCode: string,
    opts: { returnRequestId?: string; debited?: CommissionDebitNote[]; manual?: CommissionManualNote[] } = {},
  ): Promise<void> {
    try {
      const debited = opts.debited ?? [];
      const manual = opts.manual ?? [];
      const partial = !!opts.returnRequestId;
      for (const d of debited) {
        this.logger.log(
          `Đơn ${orderCode} bị ${partial ? 'trả một phần' : 'trả/huỷ'}: thu hồi hoa hồng CTV ${d.affiliateUserId} ${vnd(d.amount)}, đã trừ Ví ${vnd(d.walletDebit)} (lệnh ${d.payoutId}, Ví còn ${vnd(d.balanceAfter)}).`,
        );
      }
      const noteworthy = debited.filter((d) => d.incomeDeclared || d.balanceAfter < 0);
      const declared = debited.some((d) => d.incomeDeclared);
      if (manual.length === 0 && noteworthy.length === 0) return;
      const users = await this.prisma.user.findMany({
        where: { id: { in: [...new Set([...noteworthy, ...manual].map((x) => x.affiliateUserId))] } },
        select: { id: true, fullName: true, referralCode: true },
      });
      const nameOf = (id: string) => {
        const u = users.find((x) => x.id === id);
        return u ? (u.fullName ?? u.referralCode) : id;
      };
      const manualText: Record<CommissionManualNote['reason'], string> = {
        ANONYMIZED: 'đã chuyển vào Ví của tài khoản đã xoá',
        LEGACY_PAYOUT: 'nằm trong lệnh rút ngân hàng cũ',
        PAYOUT_UNKNOWN: 'đã vào Ví nhưng không xác định được lệnh chuyển gốc để biết phần đã nhận sau thuế',
      };
      const monthLabel = (key: string) => `${key.slice(5, 7)}/${key.slice(0, 4)}`;
      const pieces = [
        ...noteworthy.map((d) => {
          const parts = [`thu hồi hoa hồng CTV ${nameOf(d.affiliateUserId)} ${vnd(d.amount)}`];
          if (d.incomeDeclared) parts.push(`khoản này đã kê là thu nhập tháng ${monthLabel(d.incomeMonth)}${d.taxShare > 0 ? '' : ` (lệnh ${d.payoutId})`}`);
          if (d.walletDebit > 0) parts.push(`đã trừ Ví ${vnd(d.walletDebit)}`);
          if (d.taxShare > 0) parts.push(`phần thuế TNCN tương ứng ${vnd(d.taxShare)} (lệnh ${d.payoutId} giữ tổng ${vnd(d.payoutTax)})`);
          if (d.balanceAfter < 0) parts.push(`Ví đang âm ${vnd(-d.balanceAfter)}`);
          return parts.join(', ');
        }),
        ...manual.map((m) => `hoa hồng CTV ${nameOf(m.affiliateUserId)} ${vnd(m.amount)} ${manualText[m.reason]} (không tự trừ được)`),
      ];
      const message = pieces.join('; ');
      const needsAccounting = manual.length > 0 || declared;
      this.logger.warn(`Đơn ${orderCode} bị ${partial ? 'trả một phần' : 'trả/huỷ'}: ${message}${needsAccounting ? ': cần kế toán xử lý.' : '.'}`);
      const dedupeKey = `commission-paid-order-reversed:${orderId}${opts.returnRequestId ? `:${opts.returnRequestId}` : ''}`;
      const alertMessage = `${partial ? 'đơn trả một phần, ' : ''}${message}${needsAccounting ? ', cần kế toán xử lý' : ''}`;
      const notifications = this.notifications;
      // notifyAdmins không có tuỳ chọn chống gửi lặp; bọc lại để mỗi quản trị viên chỉ nhận một tin cho mỗi đơn (hoặc mỗi yêu cầu trả).
      await notifyAdmins(
        {
          prisma: this.prisma,
          notifications: notifications && { notify: (userId) => notifications.notify(userId, 'OPS_REFUND_ALERT', { order_code: orderCode, message: alertMessage }, { dedupeKey }) },
          logger: this.logger,
        },
        { template: 'OPS_REFUND_ALERT', subject: `hoa hồng của đơn ${orderCode} bị trả cần theo dõi`, data: () => ({ order_code: orderCode, message: alertMessage }) },
      );
    } catch (e) {
      this.logger.warn(`Báo kế toán hoa hồng đơn ${orderCode} lỗi: ${(e as Error).message}`);
    }
  }

  async requestPayout(
    userId: string,
    amount: number,
    method: string,
    _bankInfo?: object,
    idempotencyKey?: string,
    taxIdInput?: string,
  ) {
    if (method !== 'WALLET_BALANCE') throw new BadRequestException(WALLET_ONLY_MESSAGE);
    // Không đọc `affiliate.tubu_wallet_multiplier` ở đây: walletBalance là VND thật (Ví dùng trả tiền hàng), nên nhân hệ
    // số ở đường chuyển hoa hồng vào Ví là in tiền thật (1.000.000đ hoa hồng thành 1.497.000đ ở hệ số cũ 1.5). Chuyển
    // vào Ví luôn 1:1 (credited = total), bất kể SystemConfig còn giá trị gì cho key này. Key vẫn được `system-config`
    // (public config) đọc. Nếu cần một khoản "bonus" khi chuyển hoa hồng sang Ví, khoản đó PHẢI trả bằng Điểm Xanh,
    // KHÔNG BAO GIỜ cộng thẳng vào walletBalance bằng hệ số nhân > 1.

    // Chuẩn hoá '' / khoảng trắng → undefined (mirror wallet.withdraw / checkout.placeOrder /
    // placeOrderForCustomer ở trên) — tránh ghi '' vào payouts.idempotencyKey (unique) rồi lần
    // rút tiếp theo cũng '' đụng P2002.
    const key = idempotencyKey?.trim() || undefined;
    // Double-tap/retry cùng key → trả lại Payout đã tạo, KHÔNG rút/cộng tiền lần 2. Payout đã có
    // sẵn cột idempotencyKey (unique) trong schema (payouts.idempotencyKey) — dùng lại, KHÔNG
    // cần thêm cột mới.
    if (key) {
      const existing = await this.prisma.payout.findUnique({ where: { idempotencyKey: key } });
      if (existing && existing.userId === userId) {
        return existing.method === 'WALLET_BALANCE'
          ? {
              ok: true,
              method: existing.method,
              credited: existing.amount,
              note: `Đã cộng ${existing.amount}đ vào Ví Tubu.`,
            }
          : { ok: true, payoutId: existing.id, status: existing.status };
      }
      // idempotencyKey unique toàn cục (không compound theo userId) — nếu key trùng nhưng thuộc
      // user khác thì KHÔNG trả payout của người khác ra ngoài; bắt buộc client thử lại key mới.
      if (existing) throw new BadRequestException('Idempotency-Key đã được sử dụng, vui lòng thử lại.');
    }

    // "Khả dụng" = APPROVED và CHƯA thuộc batch payout nào (payoutBatchId null).
    const approved = await this.prisma.commission.aggregate({
      where: { affiliateUserId: userId, status: 'APPROVED', payoutBatchId: null },
      _sum: { amount: true },
    });
    const available = approved._sum.amount ?? 0;
    if (available <= 0) throw new BadRequestException('Không có hoa hồng khả dụng để chuyển vào Ví.');
    if (amount > available) throw new BadRequestException('Số dư hoa hồng khả dụng không đủ.');
    // Bug đã sửa: trước đây 'amount' chỉ được VALIDATE (amount > available → throw ở trên) nhưng
    // KHÔNG ĐƯỢC DÙNG để giới hạn số tiền rút thực — code luôn rút/cộng HẾT toàn bộ available bất
    // kể amount truyền vào là bao nhiêu. Phương án sửa ĐÃ CHỌN: BẮT BUỘC rút toàn bộ (amount phải
    // === available), throw rõ ràng nếu ít hơn — KHÔNG chọn phương án "chọn subset commission row
    // sao cho tổng khớp đúng amount tuỳ ý", vì đó là bài toán subset-sum trên các bản ghi rời rạc:
    // phức tạp hơn nhiều và rủi ro chọn sai/không tìm được tổ hợp khớp cao hơn hẳn so với việc yêu
    // cầu client xác nhận rút đúng số dư khả dụng (đã trả về sẵn ở GET /affiliate/dashboard qua
    // withdrawableCommission). Với tiền thật, throw rõ ràng an toàn hơn cả 2: rút "hết bất kể
    // amount" (bug cũ) lẫn 1 thuật toán chọn row phức tạp khó review.
    if (amount < available) {
      throw new BadRequestException(
        `Chỉ chuyển được toàn bộ hoa hồng khả dụng (${available.toLocaleString('vi-VN')}đ) vào Ví, không chuyển một phần.`,
      );
    }

    // Rút = cash-out TOÀN BỘ hoa hồng khả dụng (commission là bản ghi rời rạc, không
    // tách lẻ theo số tiền tùy ý). credited tính theo tổng THỰC trong transaction →
    // không mất tiền; gate theo updateMany.count → không double-spend khi chạy đồng thời.
    let result: { credited: number; count: number };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        // Một mốc giờ cho khoá, khung tháng cộng dồn và requestedAt: lệch nhau quanh nửa đêm cuối tháng thì lệnh rơi sang tháng khác.
        const now = new Date();
        await this.lockPitMonth(tx, userId, now);
        // Khoá dòng khi đọc: lần trả một phần cắt amount của hoa hồng APPROVED giữ khoá tới lúc commit. Đọc không khoá thì thấy amount
        // cũ, updateMany đợi khoá rồi vẫn khớp (điều kiện WHERE không có amount) và Ví nhận nhiều hơn hoa hồng còn lại. Thứ tự khoá
        // hoa hồng rồi tới Ví CTV trùng với đường thu hồi nên không deadlock.
        const rows = await tx.$queryRaw<{ id: string; amount: number }[]>`
          SELECT "id", "amount" FROM "commissions"
          WHERE "affiliateUserId" = ${userId} AND "status" = 'APPROVED' AND "payoutBatchId" IS NULL
          ORDER BY "id" FOR NO KEY UPDATE`;
        const total = rows.reduce((s, c) => s + c.amount, 0);
        // P0 FIX (A5-07): quy đổi 1:1, KHÔNG nhân hệ số — xem giải thích ở đầu hàm. Trừ thuế TNCN khấu trừ (SELLER-11).
        const taxWithheld = await this.personalIncomeTax(tx, userId, total, now);
        const taxId = await this.taxIdForPayout(tx, userId, taxWithheld, taxIdInput);
        // Đơn bị trả sau này chỉ trừ Ví phần thực nhận của hoa hồng (sau thuế của lệnh này): hoa hồng ghi luôn id lệnh chuyển ngay lúc
        // đánh dấu PAID (một câu UPDATE, id sinh trước khi tạo lệnh); hai câu UPDATE liên tiếp trên cùng dòng làm lần trả một phần
        // đang xếp hàng đợi khoá dòng đó bị deadlock với chính transaction này.
        const payoutId = randomUUID();
        const marked = await tx.commission.updateMany({
          where: { id: { in: rows.map((r) => r.id) }, status: 'APPROVED', payoutBatchId: null },
          data: { status: 'PAID', paidAt: new Date(), walletPayoutId: payoutId },
        });
        if (marked.count === 0 || total <= 0) throw new BadRequestException('Hoa hồng đã được xử lý.');
        // marked.count !== rows.length nghĩa là 1 phần row đã bị thay đổi (status/payoutBatchId)
        // GIỮA lúc đọc (rows/total) và lúc updateMany — total tính từ rows cũ không còn khớp với
        // số row thực sự vừa bị đánh dấu PAID. Trước đây chỉ check marked.count===0 nên vẫn coi
        // là thành công với total có thể SAI (thừa/thiếu tiền cộng vào ví) — throw rõ ràng để
        // client thử lại thay vì tiếp tục với số liệu không nhất quán.
        if (marked.count !== rows.length) {
          throw new ConflictException('Dữ liệu hoa hồng đã thay đổi, vui lòng thử lại.');
        }
        const credited = total - taxWithheld;
        const payout = await tx.payout.create({
          data: {
            id: payoutId,
            userId,
            amount: credited,
            grossAmount: total,
            taxWithheld,
            taxId,
            method,
            status: 'PAID',
            requestedAt: now,
            paidAt: new Date(),
            idempotencyKey: key,
          },
        });
        // Phần truy thu có thể ăn hết số tiền lần này (net 0): sổ ví không nhận dòng 0đ.
        if (credited > 0) {
          await applyWalletDelta(tx, {
            userId,
            delta: credited,
            type: 'COMMISSION_PAYOUT',
            refType: 'PAYOUT',
            refId: payout.id,
            reason: taxWithheld
              ? `Chuyển ${rows.length} khoản hoa hồng vào Ví (đã khấu trừ thuế TNCN ${vnd(taxWithheld)})`
              : `Chuyển ${rows.length} khoản hoa hồng vào Ví`,
          });
        }
        return { credited, count: rows.length };
      });
    } catch (err) {
      // Race idempotency: 2 request cùng key chạy đồng thời — request thua ăn P2002 trên
      // idempotencyKey khi payout.create (toàn bộ transaction rollback, KHÔNG double-credit).
      // Trả lại kết quả của request thắng (mirror wallet.withdraw).
      if (key && typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        const existing = await this.prisma.payout.findUnique({ where: { idempotencyKey: key } });
        if (existing && existing.userId === userId) {
          return {
            ok: true,
            method: existing.method,
            credited: existing.amount,
            note: `Đã cộng ${existing.amount}đ vào Ví Tubu.`,
          };
        }
      }
      throw err;
    }
    return {
      ok: true,
      method,
      credited: result.credited,
      count: result.count,
      note:
        result.credited > 0
          ? `Đã cộng ${result.credited}đ vào Ví Tubu.`
          : 'Toàn bộ số chuyển lần này được khấu trừ thuế TNCN (truy thu các lần chuyển trước trong tháng), chưa có tiền cộng vào Ví.',
    };
  }

  /**
   * Cron mỗi giờ: LOCKED quá hold_days → APPROVED (không gửi tin: approvedAt là mốc doanh số tháng nên duyệt không được dời giờ).
   * Từ 8:00 giờ VN, nếu hôm nay (ngày VN) chưa có lượt ngày nào xong thì chạy lượt ngày: tự chuyển vào Ví và gửi tin tổng
   * (lượt 8:00 bị lỡ vì deploy/khởi động lại/DB lỗi được chạy bù ở giờ sau).
   * try/catch BẮT BUỘC: đây là job Nest @Cron chạy NGAY TRONG process API chính, không ai await
   * Promise nó trả về — một lỗi Prisma tạm thời (mất kết nối DB, timeout pool, deadlock...) văng
   * ra ngoài sẽ thành unhandledRejection; Node 20 mặc định (--unhandled-rejections=throw) CRASH
   * toàn bộ process mỗi khi cron này lỗi, tức sập API cho MỌI user mỗi giờ vì một lỗi có thể chỉ
   * là nhất thời. Bắt lỗi + log để cron thử lại lượt sau thay vì sập process.
   */
  @Cron(APPROVE_COMMISSIONS_CRON, { timeZone: CRON_TZ })
  @TrackCron()
  async approveDueCommissions(at?: Date): Promise<void> {
    const now = at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date();
    if (this.approveRunning) {
      markCronSkipped('RUNNING');
      return;
    }
    this.approveRunning = true;
    try {
      // Khoá advisory theo transaction giữ suốt lượt: hai tiến trình cùng chạy thì bên thua bỏ qua. Việc ghi chạy trên kết nối khác.
      await this.prisma.$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext('cron:affiliate.approve_due')) AS "locked"`;
          if (!row?.locked) {
            markCronSkipped('LOCKED');
            return;
          }
          await this.approveDueAndMaybeTransfer(now);
        },
        { maxWait: 10_000, timeout: 15 * 60_000 },
      );
    } catch (err) {
      this.logger.error(`approveDueCommissions lỗi: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.approveRunning = false;
    }
  }

  private async approveDueAndMaybeTransfer(now: Date): Promise<void> {
    const holdDays = await this.effectiveHoldDays();
    const threshold = new Date(now.getTime() - holdDays * 24 * 3600 * 1000);
    // Đơn còn yêu cầu đổi/trả CHỜ DUYỆT (khách gửi trong cửa sổ, admin chưa xử lý) → chưa chốt:
    // APPROVED là điểm chốt: hoa hồng đã chuyển vào Ví chỉ thu hồi được bằng cách trừ Ví CTV (có thể âm), và APPROVED là
    // nền doanh số mốc thưởng. Chốt sớm thì admin duyệt trả hàng sau đó phải trừ tiền CTV đã nhận.
    // Yêu cầu mới không lọt giữa 2 câu lệnh: hold hiệu lực ≥ cửa sổ đổi/trả (effectiveHoldDays)
    // nên lúc đủ hold khách đã hết hạn gửi; bị từ chối thì lượt cron sau chốt tiếp.
    const openReturns = await this.prisma.returnRequest.findMany({
      where: { status: 'REQUESTED' },
      select: { orderId: true },
    });
    const heldOrderIds = [...new Set(openReturns.map((r) => r.orderId))];
    const res = await this.prisma.commission.updateMany({
      where: {
        status: 'LOCKED',
        lockedAt: { lte: threshold },
        // Đơn phải CÒN DELIVERED ngay trong câu UPDATE: duyệt trả hàng lật đơn → RETURNED trước,
        // reverseCommissionsForOrder chạy sau (ngoài tx) — lượt cron rơi vào khe đó mà không có
        // điều kiện này sẽ chốt APPROVED hoa hồng của đơn đã trả hàng; cron chuyển nó vào Ví nên lần thu hồi phải trừ Ví CTV.
        order: { status: 'DELIVERED' },
        ...(heldOrderIds.length > 0 ? { orderId: { notIn: heldOrderIds } } : {}),
      },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });
    if (res.count > 0) this.logger.log(`Duyệt ${res.count} commission hết hold.`);
    await this.runDailyWalletTransferIfDue(now, new Date(Math.max(now.getTime(), Date.now()))).catch((err: unknown) => {
      this.logger.error(`Lượt chuyển hoa hồng vào Ví lỗi: ${err instanceof Error ? err.message : err}`);
    });
  }

  /**
   * Lượt ngày: tự chuyển vào Ví rồi gửi tin tổng. Chưa tới 8:00 giờ VN, hoặc hôm nay đã có lượt xong thì không làm gì.
   * Mốc xong (cron_runs.lastSuccessAt = `until`, mốc chặn trên của cửa sổ tin đã duyệt) ghi ngay khi vòng chuyển không hỏng cả vòng;
   * lỗi gửi tin chỉ log. Vòng chuyển hỏng thì giờ sau chạy lại, và chạy lại không chuyển đôi (khoá idempotency theo tập khoản).
   */
  async runDailyWalletTransferIfDue(now: Date = new Date(), until: Date = now): Promise<boolean> {
    const vnHour = new Date(now.getTime() + VN_OFFSET_MS).getUTCHours();
    if (vnHour < DAILY_WALLET_TRANSFER_HOUR_VN) return false;
    const run = await this.prisma.cronRun.findUnique({ where: { job: DAILY_WALLET_TRANSFER_JOB }, select: { lastSuccessAt: true } });
    const last = run?.lastSuccessAt ?? undefined;
    if (last && vnDateKey(last) === vnDateKey(now)) return false;
    const since = last ?? new Date(now.getTime() - 24 * 3600 * 1000);
    const transfer = await this.transferApproved();
    if (!transfer.ok) return false;
    // Mốc ghi ngay khi chuyển xong: chạy lại trong ngày sẽ chuyển lần hai cho CTV có khoản mới và báo lần hai. Tin hỏng chỉ log.
    await this.markDailyTransferDone(now, until);
    await this.notifyCommissionsApproved(since, until);
    return true;
  }

  private async markDailyTransferDone(now: Date, until: Date): Promise<void> {
    const finished = new Date();
    const timing = { lastStartedAt: now, lastFinishedAt: finished, lastDurationMs: Math.max(0, finished.getTime() - now.getTime()) };
    await this.prisma.cronRun.upsert({
      where: { job: DAILY_WALLET_TRANSFER_JOB },
      create: { job: DAILY_WALLET_TRANSFER_JOB, ...timing, lastOutcome: 'OK', lastSuccessAt: until, consecutiveFailures: 0 },
      update: { ...timing, lastOutcome: 'OK', lastErrorCount: 0, lastSuccessAt: until, consecutiveFailures: 0 },
    });
  }

  /**
   * Tự chuyển hoa hồng APPROVED chưa gắn batch vào Ví Tubu cho từng CTV (cờ `affiliate.auto_wallet_transfer_enabled`, mặc định bật).
   * KHÔNG có đường ghi tiền riêng: mỗi CTV đi qua đúng `requestPayout` như khi bấm tay (cùng khoá tháng, khấu trừ TNCN, bút toán
   * Ví, giới hạn), nên cron và bấm tay đồng thời chỉ cộng một lần (người đến sau không còn dòng APPROVED nào để đánh dấu PAID).
   * Khoá idempotency xác định theo tập id commission: chạy lại hay hai lượt cron chồng nhau cùng tập thì cùng khoá. CTV lỗi (chưa có
   * MST khi bị khấu trừ, đã bị bấm tay trước, lỗi tạm) thì để đó cho nút "Chuyển vào Ví" và lượt cron sau, không chặn người khác.
   * Trả về các CTV đã được xử lý (payout tạo xong, kể cả khi thuế truy thu ăn hết số tiền). Không ném lỗi.
   */
  async autoTransferApprovedToWallet(): Promise<Set<string>> {
    return (await this.transferApproved()).credited;
  }

  /** `ok` false khi cả vòng hỏng (không đọc được cờ hay danh sách); lỗi riêng từng CTV không tính. */
  private async transferApproved(): Promise<{ credited: Set<string>; ok: boolean }> {
    const credited = new Set<string>();
    let candidates = 0;
    let realErrors = 0;
    try {
      const enabled = await this.config.get<unknown>(AFFILIATE_AUTO_WALLET_TRANSFER_KEY, DEFAULT_AFFILIATE_AUTO_WALLET_TRANSFER_ENABLED);
      if (enabled !== true) return { credited, ok: true };
      const rows = await this.prisma.commission.findMany({
        // CTV bị khoá giữ nguyên tiền ở APPROVED: chuyển vào Ví sẽ ghi thu nhập chịu thuế và cộng tiền cho tài khoản đang bị xem xét.
        where: { status: 'APPROVED', payoutBatchId: null, user: { isBlocked: false } },
        select: { id: true, affiliateUserId: true, amount: true },
        orderBy: { id: 'asc' },
      });
      const byUser = new Map<string, { ids: string[]; total: number }>();
      for (const r of rows) {
        const cur = byUser.get(r.affiliateUserId) ?? { ids: [], total: 0 };
        cur.ids.push(r.id);
        cur.total += r.amount;
        byUser.set(r.affiliateUserId, cur);
      }
      for (const [userId, { ids, total }] of byUser) {
        if (total <= 0) continue;
        candidates++;
        const key = `auto-wallet:${userId}:${createHash('sha1').update([...ids].sort().join(',')).digest('hex')}`;
        try {
          const result = await this.requestPayout(userId, total, 'WALLET_BALANCE', undefined, key);
          const net = ('credited' in result ? result.credited : undefined) ?? 0;
          credited.add(userId);
          await this.notifyAutoWalletCredited(userId, net, total, ('count' in result ? result.count : undefined) ?? ids.length, key);
        } catch (err) {
          const code = (err as { response?: { code?: string } }).response?.code;
          const msg = err instanceof Error ? err.message : String(err);
          if (code === PIT_TAX_ID_REQUIRED) this.logger.log(`Chưa tự chuyển hoa hồng của ${userId} vào Ví: cần mã số thuế, chờ CTV bấm Chuyển vào Ví.`);
          else {
            // Từ chối nghiệp vụ (đã bị bấm tay trước, dữ liệu vừa đổi) là ca bỏ qua có chủ ý; còn lại (DB chập...) là lỗi thật.
            // Log error chỉ cho lỗi thật: CronAwareLogger đếm log error để báo admin, nên từ chối nghiệp vụ chỉ warn.
            if (err instanceof HttpException) this.logger.warn(`Tự chuyển hoa hồng của ${userId} vào Ví bị từ chối: ${msg}`);
            else {
              realErrors++;
              this.logger.error(`Tự chuyển hoa hồng của ${userId} vào Ví lỗi: ${msg}`);
            }
          }
        }
      }
      // Có ứng viên mà không ai chuyển được vì lỗi thật: không ghi mốc ngày để giờ sau chạy lại, và log error để TrackCron báo admin.
      if (candidates > 0 && credited.size === 0 && realErrors > 0) {
        this.logger.error(`Tự chuyển hoa hồng vào Ví: ${candidates} CTV có khoản chờ nhưng không ai chuyển được (${realErrors} lỗi).`);
        return { credited, ok: false };
      }
    } catch (err) {
      this.logger.error(`autoTransferApprovedToWallet lỗi: ${err instanceof Error ? err.message : err}`);
      return { credited, ok: false };
    }
    return { credited, ok: true };
  }

  /** Tiền đã vào Ví xong: thông báo hỏng không được làm hỏng vòng chuyển của CTV khác (chỉ log). */
  private async notifyAutoWalletCredited(userId: string, credited: number, gross: number, count: number, key: string): Promise<void> {
    if (!this.notifications) return;
    try {
      const payout = await this.prisma.payout.findUnique({ where: { idempotencyKey: key }, select: { taxWithheld: true } });
      const tax = payout?.taxWithheld ?? 0;
      if (credited <= 0) {
        await this.notifications.notify(userId, CTV_NOTIFICATION.AUTO_WALLET_TAX_ONLY, { amount: vnd(gross), tax: vnd(tax) }, { dedupeKey: key });
        return;
      }
      await this.notifications.notify(
        userId,
        CTV_NOTIFICATION.AUTO_WALLET,
        { amount: vnd(credited), count: String(count), tax_note: tax > 0 ? ` (đã khấu trừ thuế TNCN ${vnd(tax)})` : '' },
        { dedupeKey: key },
      );
    } catch (err) {
      this.logger.error(`Gửi thông báo tự cộng hoa hồng vào Ví cho ${userId} lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Tin tổng "đã duyệt" cho khoản APPROVED có `approvedAt` trong (since, until]: gộp theo CTV, mỗi CTV tối đa một tin mỗi ngày VN
   * (dedupeKey theo CTV + ngày, nên lượt chạy lại không báo đôi). Chạy SAU lượt tự chuyển: khoản đã vào Ví đã PAID nên không còn dòng
   * APPROVED để báo (CTV nhận tin "đã chuyển vào Ví" thay thế). Trả false khi có lỗi để lượt ngày chạy lại ở giờ sau.
   */
  private async notifyCommissionsApproved(since: Date, until: Date): Promise<boolean> {
    if (!this.notifications) return true;
    let ok = true;
    try {
      const rows = await this.prisma.commission.findMany({
        where: { status: 'APPROVED', approvedAt: { gt: since, lte: until } },
        select: { affiliateUserId: true, amount: true },
      });
      const perUser = new Map<string, { count: number; amount: number }>();
      for (const r of rows) {
        const cur = perUser.get(r.affiliateUserId) ?? { count: 0, amount: 0 };
        perUser.set(r.affiliateUserId, { count: cur.count + 1, amount: cur.amount + r.amount });
      }
      for (const [userId, sum] of perUser) {
        try {
          await this.notifications.notify(
            userId,
            CTV_NOTIFICATION.APPROVED,
            { count: String(sum.count), amount: vnd(sum.amount) },
            { dedupeKey: `commission-approved:${userId}:${vnDateKey(until)}` },
          );
        } catch (err) {
          ok = false;
          this.logger.error(`Gửi thông báo hoa hồng được duyệt cho ${userId} lỗi: ${err instanceof Error ? err.message : err}`);
        }
      }
    } catch (err) {
      ok = false;
      this.logger.error(`notifyCommissionsApproved lỗi: ${err instanceof Error ? err.message : err}`);
    }
    return ok;
  }

  /**
   * Báo CTV có đơn mới từ link/mã của mình kèm hoa hồng dự kiến. Gọi SAU KHI đơn đã commit (hoa
   * hồng được tạo trong transaction của đơn nên không báo từ trong đó: tx rollback thì CTV nhận tin
   * về khoản không tồn tại). Không báo đơn CTV tự lên hộ (chính họ vừa tạo) và không kèm mã đơn:
   * đó là đơn của KHÁCH, app sẽ hiện nút "Xem đơn" dẫn tới trang CTV không có quyền xem. Không bao
   * giờ ném lỗi — thông báo hỏng không được làm hỏng đơn vừa đặt.
   */
  async notifyCommissionCreated(orderId: string): Promise<void> {
    if (!this.notifications) return;
    try {
      const commission = await this.prisma.commission.findFirst({
        where: { orderId },
        select: { affiliateUserId: true, amount: true, order: { select: { placedForCustomer: true } } },
      });
      if (!commission || commission.order.placedForCustomer) return;
      await this.notifications.notify(commission.affiliateUserId, CTV_NOTIFICATION.NEW, {
        amount: vnd(commission.amount),
      });
    } catch (err) {
      this.logger.error(`Gửi thông báo hoa hồng mới cho đơn ${orderId} lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Số ngày giữ THỰC trước khi chốt commission = max(affiliate.hold_days, returns.window_days).
   * Chốt (APPROVED) mở đường cho cron chuyển hoa hồng vào Ví, sau đó thu hồi chỉ còn cách trừ Ví CTV (có thể âm)
   * → không được chốt khi khách còn trong cửa sổ gửi đổi/trả
   * (key + mặc định mirror OrdersService.requestReturn), dù admin cấu hình hold ngắn hơn cửa sổ.
   */
  private async effectiveHoldDays(): Promise<number> {
    const [holdDays, returnWindowDays] = await Promise.all([
      this.config.get<number>('affiliate.hold_days', 10),
      this.config.get<number>('returns.window_days', 7),
    ]);
    return Math.max(Number(holdDays) || 0, Number(returnWindowDays) || 0);
  }

  /**
   * Thống kê theo từng gian hàng của CTV (đơn có storefrontSlug thuộc tôi + referrer là tôi, hoặc gian hàng tôi tự giao — xem
   * storefront-sales.ts). `orders` và `revenue` cùng bộ lọc đơn bán thật, cùng định nghĩa báo cáo doanh thu nhãn
   * (BrandService.getOwnedSales): loại đơn chờ thanh toán/huỷ/trả (PENDING_PAYMENT, CANCELLED, RETURNED) và đơn đã hoàn tiền/
   * thanh toán lỗi (REFUNDED, FAILED); tổng `Order.total` của các đơn còn lại trừ tiền hàng + phí ship đã hoàn của các yêu cầu
   * trả MỘT PHẦN đã duyệt (APPROVED, fullReturn = false — cùng bộ lọc partialReturnTotals), kẹp ≥ 0. Số hoa hồng không đổi.
   */
  async storefrontAnalytics(userId: string) {
    const myStores = await this.prisma.storefront.findMany({
      where: { ownerUserId: userId }, select: { slug: true, title: true },
    });
    const out = [] as Array<{ slug: string; title?: string; orders: number; revenue: number; commission: number }>;
    const revenueOf = await storefrontSalesByStore(this.prisma, userId, myStores.map((s) => s.slug));
    for (const s of myStores) {
      // P0 A5-11 (cùng họ lỗi với dashboard()): loại commission đã REJECTED (đơn huỷ/trả) —
      // trước đây cộng cả REJECTED nên hoa hồng theo gian hàng không giảm khi đơn bị huỷ.
      const commAgg = await this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, order: { storefrontSlug: s.slug }, status: { not: CommissionStatus.REJECTED } },
        _sum: { amount: true },
      });
      out.push({
        slug: s.slug, title: s.title,
        orders: revenueOf.get(s.slug)?.orders ?? 0, revenue: Math.max(0, revenueOf.get(s.slug)?.revenue ?? 0),
        commission: commAgg._sum.amount ?? 0,
      });
    }
    return { storefronts: out };
  }

  /** Phân rã hoa hồng theo sản phẩm (join Commission→Order.items, tính theo affiliateRate). */
  async productCommissionBreakdown(userId: string) {
    const commissions = await this.prisma.commission.findMany({
      where: { affiliateUserId: userId, status: { not: CommissionStatus.REJECTED } },
      include: { order: { include: { items: true } } },
      orderBy: { createdAt: 'desc' }, // cửa sổ 500 commission gần nhất (deterministic)
      take: 500,
    });
    const variationIds = [
      ...new Set(commissions.flatMap((c) => c.order?.items.map((i) => i.variationId) ?? [])),
    ];
    const variations = await this.prisma.variation.findMany({
      where: { id: { in: variationIds } }, select: { id: true, affiliateRate: true, product: { select: { affiliateBlocked: true } } },
    });
    const rate = new Map(variations.map((v) => [v.id, v.product?.affiliateBlocked ? 0 : v.affiliateRate ? Number(v.affiliateRate) : 0]));
    // reversePartialReturn từng chỉ cắt Commission.amount khi hoa hồng còn PENDING/LOCKED (nay cắt cả APPROVED/PAID chưa nằm trong lệnh
    // rút ngân hàng cũ), nên hoa hồng cũ có lần trả duyệt sau khi đã chốt mà amount không bị cắt. Trạng thái hiện tại vì vậy không cho
    // biết lần trả nào đã cắt: dựng lại phần cắt theo công thức của reversePartialReturn rồi phân bổ theo thứ tự duyệt, tối đa bằng
    // (tổng gốc − amount) — tổng các dòng luôn khớp Commission.amount (hoa hồng cũ thiếu lineAmounts được chia lại đúng bằng amount).
    const orderIds = [...new Set(commissions.map((c) => c.orderId))];
    const returnRows = orderIds.length
      ? await this.prisma.returnRequestItem.findMany({
          where: { returnRequest: { orderId: { in: orderIds }, status: 'APPROVED', fullReturn: false } },
          select: { orderItemId: true, quantity: true, returnRequest: { select: { id: true, orderId: true, reviewedAt: true, createdAt: true } } },
        })
      : [];
    const returnsByOrder = new Map<string, typeof returnRows>();
    for (const r of returnRows) {
      const list = returnsByOrder.get(r.returnRequest.orderId) ?? [];
      list.push(r);
      returnsByOrder.set(r.returnRequest.orderId, list);
    }
    const storedLines = (c: (typeof commissions)[number]) =>
      c.lineAmounts && typeof c.lineAmounts === 'object' && !Array.isArray(c.lineAmounts) ? (c.lineAmounts as Record<string, unknown>) : null;
    // Đếm đơn theo orderId riêng biệt (Set) — 1 đơn có 2 item cùng SP vẫn tính 1 đơn.
    const acc = new Map<string, { productName: string; commission: number; orderIds: Set<string> }>();
    for (const c of commissions) {
      const items = c.order?.items ?? [];
      const paid = c.order ? paidLineTotals(c.order, items) : [];
      const originals = new Map<string, number>();
      // lineAmounts lưu lúc đặt là nguồn duy nhất (dòng không có khoá = không có hoa hồng, như order-reversal.commissionableLineIds);
      // chỉ hoa hồng cũ chưa có cột này mới tính lại theo mức % hiện tại.
      const stored = storedLines(c);
      if (stored) {
        for (const it of items) {
          const v = Number(stored[it.id]);
          if (stored[it.id] != null && Number.isFinite(v)) originals.set(it.id, Math.max(0, Math.floor(v)));
        }
      } else {
        for (const [idx, it] of items.entries()) {
          const r = rate.get(it.variationId) ?? 0;
          if (r > 0) originals.set(it.id, Math.floor(((paid[idx] ?? 0) * r) / 100));
        }
        // Mọi dòng hiện có mức 0 (gỡ mức % hoặc SP bị chặn sau khi đặt): hoa hồng đã phát sinh không được biến mất, chia theo số đã trả
        // như order-reversal.commissionByLine.
        if (originals.size === 0 && items.length > 0) {
          const split = distributeByWeight(c.amount, paid);
          items.forEach((it, idx) => originals.set(it.id, split[idx] ?? 0));
        }
      }
      let budget = Math.max(0, [...originals.values()].reduce((a, v) => a + v, 0) - c.amount);
      const cutOf = new Map<string, number>();
      const qtyOf = new Map<string, number>();
      const reqs = new Map<string, { at: number; rows: { orderItemId: string; quantity: number }[] }>();
      for (const r of returnsByOrder.get(c.orderId) ?? []) {
        const q = reqs.get(r.returnRequest.id) ?? { at: (r.returnRequest.reviewedAt ?? r.returnRequest.createdAt).getTime(), rows: [] };
        q.rows.push(r);
        reqs.set(r.returnRequest.id, q);
      }
      const ordered = [...reqs.entries()].sort((x, y) => x[1].at - y[1].at || (x[0] < y[0] ? -1 : 1));
      for (const [, req] of ordered) {
        for (const row of req.rows) {
          const it = items.find((i) => i.id === row.orderItemId);
          const original = originals.get(row.orderItemId);
          if (!it || it.quantity <= 0 || !original) continue;
          const before = Math.min(it.quantity, qtyOf.get(it.id) ?? 0);
          const after = Math.min(it.quantity, before + row.quantity);
          qtyOf.set(it.id, after);
          const take = Math.min(budget, Math.max(0, shareOf(original, after / it.quantity) - shareOf(original, before / it.quantity)));
          budget -= take;
          cutOf.set(it.id, (cutOf.get(it.id) ?? 0) + take);
        }
      }
      const lines = items.flatMap((it) => {
        const original = originals.get(it.id);
        return original === undefined ? [] : [{ it, amount: Math.max(0, original - Math.min(original, cutOf.get(it.id) ?? 0)) }];
      });
      // Hoa hồng cũ không có lineAmounts: mức % hiện tại có thể khác lúc đặt nên tổng tính lại lệch Commission.amount; chia lại
      // đúng bằng amount theo tỷ lệ (không bao giờ hiện nhiều hay ít hơn số hoa hồng thật).
      if (!stored && lines.length > 0 && lines.reduce((a, l) => a + l.amount, 0) !== c.amount) {
        const split = distributeByWeight(c.amount, lines.map((l) => l.amount));
        lines.forEach((l, i) => {
          l.amount = split[i] ?? 0;
        });
      }
      for (const { it, amount } of lines) {
        if ((qtyOf.get(it.id) ?? 0) >= it.quantity && amount === 0) continue;
        const cur =
          acc.get(it.productName) ?? { productName: it.productName, commission: 0, orderIds: new Set<string>() };
        cur.commission += amount;
        cur.orderIds.add(c.orderId);
        acc.set(it.productName, cur);
      }
    }
    return [...acc.values()]
      .map((x) => ({ productName: x.productName, commission: x.commission, orders: x.orderIds.size }))
      .sort((a, b) => b.commission - a.commission);
  }

  // ── Helpers ──
  /**
   * A5-11 (audit 2026-09): "Hoa hồng tháng này/Hôm nay" trên dashboard CTV — trước đây cộng CẢ
   * commission đã REJECTED (đơn huỷ/trả), nên con số lớn nhất màn hình không bao giờ giảm khi đơn
   * bị huỷ dù "Đang chờ"/"Có thể chuyển vào Ví" vẫn giảm đúng, gây lệch không giải thích được. Loại REJECTED
   * — nhưng KHÔNG chỉ còn APPROVED/PAID như confirmedRevenue() (đó là "đã chốt" dùng cho bậc/mốc):
   * ở đây PENDING/LOCKED vẫn phải cộng như cũ, vì CTV cần thấy hoa hồng mới phát sinh ngay cả khi
   * đơn chưa giao xong. Mirror filter đã dùng ở productCommissionBreakdown() — định nghĩa DUY NHẤT
   * cho "còn sống" (đối lập REJECTED) trong file này.
   */
  private async sumCommission(userId: string, since: Date): Promise<number> {
    const agg = await this.prisma.commission.aggregate({
      where: { affiliateUserId: userId, createdAt: { gte: since }, status: { not: CommissionStatus.REJECTED } },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  /** Chi tiết cấp bậc CTV và tiến độ doanh số (đã chốt) tháng VN. */
  async getCtvTiers(userId: string, now: Date = new Date()) {
    const revenue = await this.confirmedRevenue(this.prisma, userId, vnMonthBounds(now));
    return {
      revenue,
      tier: this.monthlyTier(revenue),
      // Mỗi bậc kèm thưởng mốc Điểm Xanh cùng ngưỡng — phần thưởng THẬT của bậc.
      allTiers: tiersWithRewards(),
    };
  }

  /**
   * Mốc thưởng doanh số tháng của CTV (tháng VN hiện tại) + mốc tháng trước còn nhận được.
   * Doanh số = doanh số ĐÃ CHỐT (confirmedRevenue); pendingRevenue chỉ để hiển thị "đang chờ chốt".
   */
  async getMilestones(userId: string, now: Date = new Date()) {
    const cur = vnMonthBounds(now);
    const prev = vnMonthBounds(now, -1);

    const [currentRevenue, previousRevenue, pendingAgg, claims, holdDays] = await Promise.all([
      this.confirmedRevenue(this.prisma, userId, cur),
      this.confirmedRevenue(this.prisma, userId, prev),
      this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, status: { in: [...PENDING_COMMISSION_STATUSES] } },
        _sum: { commissionableTotal: true },
      }),
      this.prisma.ctvMilestoneClaim.findMany({
        where: { userId, monthKey: { in: [cur.key, prev.key] } },
        select: { milestoneId: true, monthKey: true },
      }),
      this.effectiveHoldDays(),
    ]);

    const claimed = new Set(claims.map((c) => `${c.milestoneId}:${c.monthKey}`));
    const build = (monthKey: string, revenue: number) =>
      CTV_MONTHLY_MILESTONES.map((m) => {
        const achieved = revenue >= m.threshold;
        const isClaimed = claimed.has(`${m.id}:${monthKey}`);
        return {
          ...m,
          achieved,
          claimed: isClaimed,
          canClaim: achieved && !isClaimed,
          progressPct: milestoneProgressPct(revenue, m.threshold),
        };
      });

    // Tháng trước: chỉ trả khi còn mốc đạt mà chưa nhận (commission chốt sát cuối tháng — cron
    // duyệt chạy mỗi giờ — không làm CTV mất thưởng chỉ vì chưa mở app trước 00:00 ngày 1).
    const previousClaimable = build(prev.key, previousRevenue).filter((m) => m.canClaim);

    return {
      monthKey: cur.key,
      currentRevenue,
      pendingRevenue: pendingAgg._sum.commissionableTotal ?? 0,
      holdDays,
      milestones: build(cur.key, currentRevenue),
      previousMonth:
        previousClaimable.length > 0
          ? { monthKey: prev.key, revenue: previousRevenue, milestones: previousClaimable }
          : null,
    };
  }

  /**
   * Nhận thưởng mốc doanh số tháng → cộng Điểm Xanh lô STANDARD (không phải tiền, PD-3).
   * MONEY-CRITICAL:
   *  - Điều kiện đọc doanh số ĐÃ CHỐT trong CÙNG tx (không đếm đơn còn huỷ/trả được).
   *  - Idempotent dưới đồng thời: insert ctv_milestone_claims (unique userId+milestoneId+monthKey)
   *    TRƯỚC khi cấp điểm; request thua ăn P2002 → rollback cả tx → không cộng 2 lần.
   *  - Cấp qua RewardPointsService.grant(tx) — dòng sổ điểm + pointsBalance cùng tx (giữ bất biến
   *    pointsBalance == SUM(delta) lô STANDARD). Không bao giờ cộng walletBalance (tiền VND thật).
   *  - `monthKey` chỉ nhận tháng này hoặc tháng trước (VN).
   */
  async claimMilestone(userId: string, milestoneId: string, monthKey?: string, now: Date = new Date()) {
    const milestone = CTV_MONTHLY_MILESTONES.find((m) => m.id === milestoneId);
    if (!milestone) {
      throw new NotFoundException(`Mốc thưởng "${milestoneId}" không tồn tại.`);
    }

    const cur = vnMonthBounds(now);
    const prev = vnMonthBounds(now, -1);
    const month = !monthKey || monthKey === cur.key ? cur : monthKey === prev.key ? prev : null;
    if (!month) {
      throw new BadRequestException('Chỉ nhận được thưởng mốc của tháng này hoặc tháng trước.');
    }
    const reason = `CTV_MILESTONE:${milestone.id}:${month.key}`;
    const expiresAt = await this.rewards.expiresAt();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const revenue = await this.confirmedRevenue(tx, userId, month);
        if (revenue < milestone.threshold) {
          throw new BadRequestException(
            `Doanh số đã chốt tháng ${month.key} (${revenue.toLocaleString('vi-VN')}đ) chưa đạt ngưỡng ${milestone.threshold.toLocaleString('vi-VN')}đ.`,
          );
        }

        // Insert claim TRƯỚC khi cấp điểm: grant nuốt trùng khoá của chính nó (trả false) nên không
        // thể làm khoá idempotency ở đây — khoá thật là unique của ctv_milestone_claims.
        const claim = await tx.ctvMilestoneClaim.create({
          data: {
            userId,
            milestoneId: milestone.id,
            monthKey: month.key,
            rewardXu: 0,
            rewardPoints: milestone.rewardPoints,
            revenue,
          },
        });
        await this.rewards.grant(userId, milestone.rewardPoints, reason, 'AFFILIATE_MILESTONE', claim.id, tx, expiresAt);

        return {
          success: true,
          message: `Chúc mừng bạn đã nhận ${milestone.rewardPoints.toLocaleString('vi-VN')} Điểm Xanh từ ${milestone.title}!`,
          rewardPoints: milestone.rewardPoints,
          monthKey: month.key,
        };
      });
    } catch (err) {
      // Unique (userId, milestoneId, monthKey): đã nhận trước đó HOẶC thua race double-tap —
      // tx đã rollback, điểm KHÔNG bị cộng lần 2.
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        throw new BadRequestException('Bạn đã nhận thưởng mốc này rồi.');
      }
      throw err;
    }
  }

  // ── Admin: hàng đợi Payout (P0 A5-08 = A6-05) ──
  //
  // Payout method=BANK REQUESTED có 2 NGUỒN khác nhau, hoàn tiền phải xử lý đúng nguồn:
  //  1) wallet.service.ts:withdraw() — trừ THẲNG user.walletBalance (gross = amount + fee, vì
  //     Payout.amount lưu NET đã trừ phí). KHÔNG đụng gì tới Commission.
  //  2) requestPayout() nhánh BANK ở trên — KHÔNG đụng walletBalance; thay vào đó đánh dấu các
  //     dòng Commission APPROVED liên quan là PAID + gán payoutBatchId = payout.id.
  // Phân biệt 2 nguồn dựa trên DỮ LIỆU THẬT (có Commission nào đang payoutBatchId=payout.id
  // không) — KHÔNG thêm cột "nguồn" mới, để không phải sửa wallet.service.ts (ngoài phạm vi).

  private static readonly PAYOUT_STATUSES: readonly PayoutStatus[] = ['REQUESTED', 'APPROVED', 'PAID', 'REJECTED'];

  /** Danh sách Payout cho admin xử lý, lọc theo trạng thái + phân trang (mirror dealer-admin). */
  async listPayouts(status: string | undefined, page: number, limit: number) {
    if (status && !AffiliateService.PAYOUT_STATUSES.includes(status as PayoutStatus)) {
      throw new BadRequestException('Trạng thái lệnh rút không hợp lệ.');
    }
    const where: Prisma.PayoutWhereInput = status ? { status: status as PayoutStatus } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payout.findMany({ where, orderBy: { requestedAt: 'desc' }, ...skipTake(page, limit) }),
      this.prisma.payout.count({ where }),
    ]);
    const userIds = [...new Set(items.map((p) => p.userId))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true, phone: true, referralCode: true },
        })
      : [];
    const userOf = new Map(users.map((u) => [u.id, u]));
    return paginated(
      items.map((p) => ({ ...p, user: userOf.get(p.userId) ?? null })),
      page,
      limit,
      total,
    );
  }

  /**
   * Báo số thực nhận của lệnh đã đổi so với số admin đang thấy trên màn: lệnh REQUESTED tăng amount khi một lệnh khác cùng tháng
   * bị từ chối và thuế giữ dư được hoàn ngay trên lệnh. Duyệt/chi theo số cũ thì CTV nhận thiếu tiền thật.
   */
  private async staleAmountError(id: string, status: 'REQUESTED' | 'APPROVED', expected: number, verb: 'duyệt' | 'chi') {
    const now = await this.prisma.payout.findUnique({ where: { id }, select: { status: true, amount: true } });
    if (!now || now.status !== status || now.amount === expected) return null;
    return new ConflictException(
      `Số thực nhận của lệnh đã đổi từ ${vnd(expected)} thành ${vnd(now.amount)} (thuế giữ dư vừa được hoàn), vui lòng tải lại trước khi ${verb}.`,
    );
  }

  /**
   * Duyệt lệnh rút NH: REQUESTED → APPROVED. Chưa chuyển tiền — chỉ xác nhận sẽ xử lý thủ công. `expectedAmount` (số đang hiện
   * trên màn admin) nằm trong cùng điều kiện updateMany nên khớp-rồi-ghi là một bước nguyên tử; lệch thì 409. `null` coi như không gửi (@IsOptional cho null lọt qua, `amount: null` trong where làm Prisma lỗi).
   */
  async approvePayout(adminId: string, id: string, note?: string, expectedAmount?: number) {
    const res = await this.prisma.payout.updateMany({
      where: { id, status: 'REQUESTED', ...(expectedAmount != null ? { amount: expectedAmount } : {}) },
      data: {
        status: 'APPROVED',
        reviewedBy: adminId,
        reviewedAt: new Date(),
        ...(note?.trim() ? { adminNote: note.trim() } : {}),
      },
    });
    if (res.count === 0) {
      const stale = expectedAmount != null ? await this.staleAmountError(id, 'REQUESTED', expectedAmount, 'duyệt') : null;
      if (stale) throw stale;
      throw new BadRequestException(
        'Lệnh rút không ở trạng thái "Yêu cầu" hoặc vừa được xử lý bởi người khác — vui lòng tải lại.',
      );
    }
    this.logger.log(`Admin ${adminId} duyệt lệnh rút ${id}.`);
    const payout = await this.prisma.payout.findUniqueOrThrow({ where: { id } });
    await this.notifications
      ?.notify(payout.userId, CTV_NOTIFICATION.PAYOUT_APPROVED, { amount: vnd(payout.amount) })
      .catch((e: unknown) => this.logger.warn(`Báo duyệt lệnh rút ${id} lỗi: ${(e as Error).message}`));
    return payout;
  }

  /**
   * Từ chối lệnh rút NH: REQUESTED → REJECTED (bắt buộc lý do) + HOÀN tiền/commission đã bị khoá.
   * MONEY-CRITICAL: atomic updateMany(status-guard) TRƯỚC, rồi đọc lại + hoàn tiền TRONG CÙNG
   * transaction — count=0 (đã được admin khác xử lý) thì throw ngay, không hoàn gì cả.
   */
  async rejectPayout(adminId: string, id: string, reason: string) {
    const why = reason?.trim();
    if (!why) throw new BadRequestException('Vui lòng nhập lý do từ chối.');

    let revoked: { id: string; affiliateUserId: string; amount: number }[] = [];
    const rejected = await this.prisma.$transaction(async (tx) => {
      // userId/requestedAt không đổi sau khi tạo lệnh nên đọc trước được. Lệnh rút hoa hồng lấy khoá (CTV, tháng) TRƯỚC khi ghi
      // gì, cùng thứ tự với requestPayout, để từ chối và rút mới cùng tháng không giành khoá ngược nhau.
      const head = await tx.payout.findUnique({ where: { id }, select: { userId: true, requestedAt: true, grossAmount: true } });
      const commissionPayout = head !== null && head.grossAmount !== null;
      if (head && commissionPayout) await this.lockPitMonth(tx, head.userId, head.requestedAt);
      const marked = await tx.payout.updateMany({
        where: { id, status: 'REQUESTED' },
        data: { status: 'REJECTED', reviewedBy: adminId, reviewedAt: new Date(), rejectionReason: why },
      });
      if (marked.count === 0) {
        throw new BadRequestException(
          'Lệnh rút không ở trạng thái "Yêu cầu" hoặc vừa được xử lý bởi người khác — vui lòng tải lại.',
        );
      }
      const payout = await tx.payout.findUniqueOrThrow({ where: { id } });

      const linkedCommissions = await tx.commission.findMany({
        where: { payoutBatchId: id, status: { in: ['APPROVED', 'PAID'] } },
        select: { id: true, orderId: true, affiliateUserId: true, amount: true },
      });
      if (linkedCommissions.length > 0) {
        // Nguồn 2 (requestPayout nhánh BANK): trả các commission liên quan về APPROVED, gỡ batch
        // → CTV rút lại được. KHÔNG đụng walletBalance (chưa từng cộng/trừ gì ở đó cho payout này).
        // Trừ hoa hồng của đơn đã huỷ/trả (cả đơn): lúc thu hồi, hoa hồng còn nằm trong lệnh rút nên chỉ báo kế toán; trả về APPROVED
        // thì cron chuyển nó vào Ví. Đổi REJECTED. Khoá dòng hoa hồng (cùng thứ tự với reverseCommission) rồi mới đọc trạng thái đơn,
        // nên lần thu hồi đang chạy hoặc đã xong luôn được thấy.
        const ids = linkedCommissions.map((c) => c.id);
        await tx.$queryRaw`SELECT "id" FROM "commissions" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR NO KEY UPDATE`;
        const closedOrders = await tx.order.findMany({
          where: { id: { in: [...new Set(linkedCommissions.map((c) => c.orderId))] }, status: { in: ['CANCELLED', 'RETURNED'] } },
          select: { id: true },
        });
        const closed = new Set(closedOrders.map((o) => o.id));
        const reopened = linkedCommissions.filter((c) => !closed.has(c.orderId));
        revoked = linkedCommissions.filter((c) => closed.has(c.orderId));
        if (reopened.length > 0) {
          await tx.commission.updateMany({
            where: { id: { in: reopened.map((c) => c.id) }, payoutBatchId: id, status: { in: ['APPROVED', 'PAID'] } },
            data: { status: 'APPROVED', payoutBatchId: null, paidAt: null },
          });
        }
        if (revoked.length > 0) {
          await tx.commission.updateMany({
            where: { id: { in: revoked.map((c) => c.id) }, payoutBatchId: id, status: { in: ['APPROVED', 'PAID'] } },
            data: { status: 'REJECTED', payoutBatchId: null, paidAt: null },
          });
        }
      } else {
        // Nguồn 1 (wallet.service.ts:withdraw): hoàn GROSS đã bị trừ — Payout.amount lưu NET
        // (amount = gross - fee), nên gross = amount + fee (xem wallet.service.ts:withdraw).
        await applyWalletDelta(tx, {
          userId: payout.userId,
          delta: payout.amount + payout.fee,
          type: 'WITHDRAW_REFUND',
          refType: 'PAYOUT',
          refId: payout.id,
          reason: `Hoàn lệnh rút bị từ chối: ${why}`,
        });
      }
      if (commissionPayout) await this.refundOverheldPit(tx, payout);
      this.logger.log(`Admin ${adminId} từ chối lệnh rút ${id}: ${why}`);
      return tx.payout.findUniqueOrThrow({ where: { id } });
    });
    await this.notifications
      ?.notify(rejected.userId, CTV_NOTIFICATION.PAYOUT_REJECTED, { amount: vnd(rejected.grossAmount ?? rejected.amount), reason: why })
      .catch((e: unknown) => this.logger.warn(`Báo từ chối lệnh rút ${id} lỗi: ${(e as Error).message}`));
    // Phần hoa hồng của đơn đã huỷ/trả không về số dư khả dụng: báo CTV như mọi lần thu hồi.
    const revokedTotal = revoked.reduce((sum, c) => sum + c.amount, 0);
    if (revokedTotal > 0) {
      this.logger.warn(`Từ chối lệnh rút ${id}: ${revoked.length} hoa hồng của đơn đã huỷ/trả (${vnd(revokedTotal)}) đổi REJECTED, không trả về số dư khả dụng.`);
      await this.notifications
        ?.notify(rejected.userId, CTV_NOTIFICATION.REVERSED, { amount: vnd(revokedTotal) })
        .catch((e: unknown) => this.logger.warn(`Báo thu hồi hoa hồng của lệnh rút ${id} lỗi: ${(e as Error).message}`));
    }
    return rejected;
  }

  /** Xác nhận đã chuyển khoản: APPROVED → PAID (ghi mã giao dịch NH / ghi chú). */
  async markPayoutPaid(
    adminId: string,
    id: string,
    opts: { bankRef?: string; note?: string; byStaff?: boolean; expectedAmount?: number } = {},
  ) {
    if (opts.byStaff) {
      const own = await this.prisma.payout.findUnique({ where: { id }, select: { userId: true } });
      if (!own) throw new NotFoundException('Không tìm thấy lệnh rút.');
      if (own.userId === adminId) throw new ForbiddenException('Không xác nhận chi lệnh rút của chính mình — nhờ quản trị viên.');
    }
    const paidAt = new Date();
    const res = await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.payout.updateMany({
        where: { id, status: 'APPROVED', ...(opts.expectedAmount != null ? { amount: opts.expectedAmount } : {}) },
        data: {
          status: 'PAID',
          paidBy: adminId,
          paidAt,
          ...(opts.bankRef?.trim() ? { bankRef: opts.bankRef.trim() } : {}),
          ...(opts.note?.trim() ? { adminNote: opts.note.trim() } : {}),
        },
      });
      // Hoa hồng trong lệnh rút ngân hàng chỉ thành "Đã trả" khi tiền thật sự đã chuyển (SELLER-10).
      if (flipped.count > 0) {
        await tx.commission.updateMany({ where: { payoutBatchId: id, status: 'APPROVED' }, data: { status: 'PAID', paidAt } });
      }
      return flipped;
    });
    if (res.count === 0) {
      const stale = opts.expectedAmount != null ? await this.staleAmountError(id, 'APPROVED', opts.expectedAmount, 'chi') : null;
      if (stale) throw stale;
      throw new BadRequestException(
        'Lệnh rút không ở trạng thái "Đã duyệt" hoặc vừa được xử lý bởi người khác — vui lòng tải lại.',
      );
    }
    this.logger.log(`Admin ${adminId} xác nhận đã chuyển khoản lệnh rút ${id}.`);
    const payout = await this.prisma.payout.findUniqueOrThrow({ where: { id } });
    if (this.notifications) {
      try {
        // Payout.amount là số tiền THỰC chuyển (đã trừ phí), đúng con số CTV sẽ thấy trong tài khoản.
        await this.notifications.notify(payout.userId, CTV_NOTIFICATION.PAYOUT_PAID, {
          amount: vnd(payout.amount),
          ref: payout.bankRef ? ` (mã giao dịch ${payout.bankRef})` : '',
        });
      } catch (err) {
        this.logger.error(`Gửi thông báo đã chuyển khoản lệnh rút ${id} lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
    return payout;
  }
}
