import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Order, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { PricingService } from '../pricing/pricing.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import { WalletLedgerService } from '../wallet/wallet-ledger.service';
import { reserveVariationStock } from '../catalog/variation-stock';
import { isPancakeFulfilledLine } from '../integrations/pancake/pancake-fulfilment';
import {
  assertVariationsSellable,
  isProductDiscontinuedError,
  isSellableVariation,
  productDiscontinuedError,
} from '../cart/sellable';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
import {
  DEFAULT_PENDING_PAYMENT_TTL_HOURS,
  MAX_TTL_HOURS,
  MIN_TTL_HOURS,
  PENDING_PAYMENT_TTL_KEY,
} from '../orders/pending-payment-expiry.cron';
import { CRON_TZ } from '../../common/cron-tz';
import { generateUniqueOrderCode } from '../../common/order-code';
import { formatVnDate, startOfVnDay, vnDateKey } from '../../common/vn-time';
import { isPartnerOwnedVariation, partnerGoodsError, partnerGoodsMessage } from '../cart/partner-goods';
import { overStockText } from '../cart/cart.stock-message';
import { TrackCron } from '../../common/cron-run/track-cron';
import { publicImage } from '../../common/public-image';
import { intervalCandidates, SMART_INTERVAL_ENABLED_KEY, SMART_INTERVAL_LOOKBACK_DAYS, SMART_INTERVAL_MAX } from './smart-interval';

/** Phương thức trả cho gói định kỳ (Q-13). Cổng ZaloPay/VNPAY cần khách thao tác mỗi kỳ nên không nhận. */
export const SUBSCRIPTION_PAYMENT_METHODS = ['COD', 'WALLET', 'BANK_TRANSFER'] as const;
export type SubscriptionPaymentMethod = (typeof SUBSCRIPTION_PAYMENT_METHODS)[number];

/** Chu kỳ giao hợp lệ (tuần), dùng chung cho tạo gói, sửa gói và DTO. */
export const SUBSCRIPTION_INTERVAL_WEEKS = [4, 6, 8, 10] as const;

/** Khách chỉ được hẹn ngày bắt đầu trong khoảng này (tính theo ngày giờ Việt Nam). */
export const MAX_START_DAYS_AHEAD = 60;

/** Dời ngày giao kỳ tới (`nextRunDate` của PATCH): từ ngày mai tới chừng này ngày tới, giờ Việt Nam. */
export const RESCHEDULE_MAX_DAYS_AHEAD = 90;

/** Cùng trần số lượng một dòng giỏ hàng (cart.dto). */
export const MAX_SUBSCRIPTION_QUANTITY = 999;

/**
 * Hạn mức đơn COD — bằng hằng số ở checkout.service (đơn kỳ không đi qua checkout nên phải tự chặn, không thì gói
 * số lượng lớn lách được hạn mức COD).
 */
export const SUBSCRIPTION_COD_MAX = 5_000_000;

/** Giờ VN cron processDue chạy mỗi ngày; setStatus dựa vào mốc này để biết bật lại có kịp đơn hôm nay không. */
const SUBSCRIPTION_CRON_HOUR_VN = 3;
/** Cron mỗi đêm quét tối đa PAGE gói/trang, tối đa MAX_PAGES trang (chặn vòng lặp vô hạn nếu dữ liệu bất thường). */
const DUE_PAGE_SIZE = 200;
const DUE_MAX_PAGES = 50;

/** Số đêm thử lại một kỳ vì hết hàng/lỗi tạm thời trước khi bỏ kỳ (subscribe.stock_retry_days; 0 = không thử lại). */
export const STOCK_RETRY_DAYS_KEY = 'subscribe.stock_retry_days';
export const DEFAULT_STOCK_RETRY_DAYS = 3;
const MAX_STOCK_RETRY_DAYS = 7;

interface CreateSubInput {
  variationId: string;
  quantity: number;
  intervalWeeks: number;
  addressId: string;
  /** YYYY-MM-DD giờ Việt Nam; bỏ trống hoặc hôm nay = tạo đơn đầu ngay. */
  startDate?: string;
  paymentMethod?: SubscriptionPaymentMethod;
}

interface UpdateSubInput {
  quantity?: number;
  intervalWeeks?: number;
  addressId?: string;
  paymentMethod?: SubscriptionPaymentMethod;
  /** YYYY-MM-DD giờ Việt Nam: ngày giao kỳ tới mới, thắng ngày do đổi chu kỳ tính ra. */
  nextRunDate?: string;
  /** ISO của `nextRunAt` khách đang thấy; bắt buộc khi có `nextRunDate`. */
  expectedNextRunAt?: string;
}

/**
 * Đánh dấu riêng lỗi hết hàng khi tạo đơn định kỳ (khác BadRequestException chung) để
 * runCycle phân biệt được và báo user — hết hàng CÓ THỂ là tạm thời nên KHÔNG pause
 * lịch như nhánh isActive=false/địa chỉ hỏng, chỉ báo rồi để cron thử lại chu kỳ sau.
 */
class SubscriptionOutOfStockError extends Error {}
/** Địa chỉ của gói đã mất/không còn thuộc khách lúc sinh đơn kỳ. */
class SubscriptionAddressError extends Error {}
/** Sản phẩm của gói đã thành hàng của gian hàng đối tác: không có giảm giá định kỳ, gói tạm dừng. */
class SubscriptionPartnerGoodsError extends Error {
  constructor(readonly productName: string) {
    super(partnerGoodsMessage('SUBSCRIPTION', productName));
  }
}
/** Ví Tubu không đủ trả đơn kỳ: không sinh đơn nợ, gói tạm dừng. */
class SubscriptionWalletShortError extends Error {}
/** Đơn kỳ trả COD vượt hạn mức COD: không sinh đơn, gói tạm dừng. */
class SubscriptionCodLimitError extends Error {}

const COD_LIMIT_TEXT = `${SUBSCRIPTION_COD_MAX.toLocaleString('vi-VN')}đ`;

const WALLET_SHORT_MESSAGE = 'Số dư Ví Tubu không đủ để thanh toán đơn định kỳ.';

const SCHEDULE_CHANGED_MESSAGE = 'Lịch giao vừa thay đổi, hãy tải lại rồi thử lại.';

const RUN_NOW_TODAY_MESSAGE = 'Gói này đã có đơn hôm nay, kỳ sau Tubu giao theo lịch nhé.';
const RUN_NOW_INACTIVE_MESSAGE = 'Chỉ đặt kỳ này ngay khi lịch đang chạy.';

/** Mã lỗi ổn định cho FE: đã có gói còn chạy cùng SP + địa chỉ (C-057, Q-13). */
export const SUBSCRIPTION_DUPLICATE = 'SUBSCRIPTION_DUPLICATE';

/** `pausedReason` khi khách tự bấm Tạm dừng; các mã hệ thống tự dừng là `SystemPauseCode`. Giao diện đọc cả hai qua app-core/subscription-pause-copy. */
const CUSTOMER_PAUSE_REASON = 'customer';
/** Khớp `SUBSCRIPTION_PAUSE_REASONS` (trừ 'customer') của app-core: subscription-pause-copy.spec.ts đọc dòng này để bắt lệch. */
type SystemPauseCode = 'inactive_product' | 'invalid_address' | 'partner_goods' | 'insufficient_wallet' | 'cod_limit';

/** Trạng thái nằm trong partial unique index subscriptions_user_variation_address_open_key. */
const OPEN_STATUSES = ['ACTIVE', 'PAUSED'];

// Gói ACTIVE chưa ra đơn nào chỉ tính vào bậc giảm khi kỳ kế tiếp nằm trong khoảng này.
const TIER_WINDOW_DAYS = 35;

function subscriptionDuplicateError(open: { id: string; status: string }, productName: string): ConflictException {
  const message =
    open.status === 'PAUSED'
      ? `Bạn đã có gói giao định kỳ "${productName}" tới địa chỉ này đang tạm dừng, hãy bật lại gói đó thay vì tạo gói mới.`
      : `Bạn đã có gói giao định kỳ "${productName}" tới địa chỉ này, hãy sửa gói đó hoặc chọn địa chỉ khác.`;
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: SUBSCRIPTION_DUPLICATE,
    message,
    subscriptionId: open.id,
  });
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2002';
}

/** P2002 trên khoá idempotency của đơn (một kỳ một đơn), không phải trùng mã đơn hay khoá khác. */
function isIdempotencyViolation(err: unknown): boolean {
  return isUniqueViolation(err) && JSON.stringify((err as { meta?: { target?: unknown } }).meta?.target ?? '').includes('idempotencyKey');
}

type DiscountTier = { minActive: number; pct: number };

/**
 * Bậc giảm kế tiếp của thang `subscribe.discount_tiers`: bậc có ngưỡng gói nhỏ nhất vượt số gói đang tính và % cao hơn % đang áp.
 * Cấu hình hỏng (không phải mảng, bậc thiếu số) thì bỏ qua bậc đó; không còn bậc nào cao hơn thì null.
 */
export function nextDiscountTier(tiers: unknown, activeCount: number, currentPct: number): { countNeeded: number; discountPct: number } | null {
  if (!Array.isArray(tiers)) return null;
  let best: DiscountTier | null = null;
  for (const t of tiers as Partial<DiscountTier>[]) {
    if (!t || !Number.isInteger(t.minActive) || typeof t.pct !== 'number' || !Number.isFinite(t.pct)) continue;
    const tier = t as DiscountTier;
    if (tier.minActive <= activeCount || tier.pct <= currentPct) continue;
    if (!best || tier.minActive < best.minActive || (tier.minActive === best.minActive && tier.pct > best.pct)) best = tier;
  }
  return best ? { countNeeded: best.minActive - activeCount, discountPct: best.pct } : null;
}

function isAddressFkViolation(err: unknown): boolean {
  const e = err as { code?: string; meta?: { field_name?: string } } | null;
  return e?.code === 'P2003' && String(e.meta?.field_name ?? '').includes('addressId');
}

/** Dòng gói đọc dưới khoá FOR UPDATE trong tx sinh đơn — nguồn duy nhất cho số lượng/địa chỉ/cách trả. */
interface LockedSubRow {
  id: string;
  userId: string;
  variationId: string;
  quantity: number;
  addressId: string;
  status: string;
  paymentMethod: SubscriptionPaymentMethod;
  intervalWeeks: number;
  nextRunAt: Date;
  lastOrderId: string | null;
  retryCount: number;
}

/**
 * Tiền hàng một kỳ định kỳ: phần giảm làm tròn xuống đồng, tiền hàng không âm. MỘT công thức cho cả đơn kỳ
 * (runCycle) lẫn thẻ lịch định kỳ ở miniapp, để số khách thấy khớp số bị tính.
 */
export function subscriptionCycleAmounts(unitPrice: number, quantity: number, discountPct: number) {
  const subtotal = unitPrice * quantity;
  const discount = Math.floor(subtotal * discountPct);
  return { subtotal, discount, goods: Math.max(0, subtotal - discount) };
}

function cycleAmountsView(unitPrice: number, quantity: number, discountPct: number) {
  const { subtotal, discount, goods } = subscriptionCycleAmounts(unitPrice, quantity, discountPct);
  return { cycleSubtotal: subtotal, cycleDiscount: discount, cycleGoods: goods };
}

/** Đơn kỳ vừa ghi xong, kèm phần việc chạy sau commit (Pancake, thông báo). */
interface PlacedCycleOrder {
  order: Order;
  userId: string;
}

/**
 * Subscribe & Save (Build Spec §6.14.4): đặt định kỳ 4/6/8/10 tuần.
 * Chiết khấu theo THANG BẬC (subscribe.discount_tiers, kiểu Amazon): càng nhiều
 * gói ACTIVE thật (đã ra đơn hoặc kỳ kế trong 35 ngày), % giảm càng cao (chọn bậc minActive cao nhất đạt được),
 * cap 15%. subscribe.discount_pct giữ lại làm fallback cho bậc cơ bản (minActive:1).
 * Đơn đầu giao ngay hoặc từ ngày khách chọn; cron tạo các đơn kỳ sau khi đến hạn, trả bằng
 * COD / Ví Tubu / chuyển khoản (Q-13) → user skip/pause/cancel/sửa bất kỳ lúc nào.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly pricing: PricingService,
    private readonly loyalty: LoyaltyService,
    private readonly notifications: NotificationsService,
    private readonly pancakeOrder: PancakeOrderService,
    private readonly analytics: AnalyticsEventsService,
    private readonly walletLedger: WalletLedgerService,
  ) {}

  async create(userId: string, dto: CreateSubInput) {
    this.assertIntervalWeeks(dto.intervalWeeks);
    const paymentMethod = this.parsePaymentMethod(dto.paymentMethod);
    this.assertQuantity(dto.quantity);
    const firstRunAt = this.parseStartDate(dto.startDate);
    const variation = await this.prisma.variation.findUnique({
      where: { id: dto.variationId },
      include: { product: { select: { name: true, isActive: true, approvalStatus: true, fulfilment: true, storefrontId: true } } },
    });
    if (!variation) throw new BadRequestException('Sản phẩm không khả dụng.');
    if (!isSellableVariation(variation)) throw productDiscontinuedError(variation.product.name);
    if (isPartnerOwnedVariation(variation)) throw partnerGoodsError('SUBSCRIPTION', variation.product.name);
    // Đơn định kỳ đẩy thẳng kho Tubu (Pancake); hàng đối tác tự giao không đăng ký định kỳ được (D4).
    if (!isPancakeFulfilledLine({ pancakeId: variation.pancakeId, fulfilment: variation.product.fulfilment })) {
      throw new BadRequestException('Sản phẩm do gian hàng đối tác tự giao, chưa hỗ trợ giao định kỳ.');
    }
    // Bộ chọn số lượng không kẹp theo tồn trên 20 (không lộ tồn), nên chặn ở đây: gói đòi nhiều hơn tồn hiện có thì kỳ nào cũng hụt hàng.
    // Hết hàng hẳn vẫn cho hẹn như trước.
    if (variation.stock > 0 && dto.quantity > variation.stock) throw new BadRequestException(overStockText(variation.stock, variation.product.name));
    const address = await this.prisma.address.findUnique({ where: { id: dto.addressId } });
    if (!address || address.userId !== userId) throw new BadRequestException('Địa chỉ không hợp lệ.');

    const quantity = Math.max(1, dto.quantity);
    const key = { userId, variationId: dto.variationId, addressId: dto.addressId };
    const asRequested = { quantity, intervalWeeks: dto.intervalWeeks, paymentMethod };
    // Giao ngay: gói + đơn đầu cùng một transaction — đơn đầu không đặt được (hết hàng, ví thiếu)
    // thì không để lại gói nào, khách thấy lỗi và chọn lại thay vì có gói "chạy" mà không có hàng.
    const startNow = firstRunAt === null;
    const code = startNow ? await generateUniqueOrderCode(this.prisma, 'SUBSCRIPTION') : null;
    let placed: PlacedCycleOrder | null = null;
    let created: Awaited<ReturnType<typeof this.insertSubscription>>;
    try {
      const res = await this.prisma.$transaction(async (tx) => {
        const open = await tx.subscription.findFirst({ where: { ...key, status: { in: OPEN_STATUSES } } });
        if (open) return { duplicate: this.resolveDuplicate(open, asRequested, variation.product.name) };
        const now = new Date();
        const sub = await this.insertSubscription(tx, userId, dto, quantity, paymentMethod, firstRunAt ?? now);
        if (!startNow || !code) return { sub, placed: null };
        const first = await this.placeFirstOrder(tx, sub.id, now, code);
        return { sub: { ...sub, ...first.subPatch }, placed: first.placed };
      });
      if ('duplicate' in res) return res.duplicate;
      created = res.sub;
      placed = res.placed;
    } catch (err) {
      // Request song song cùng lọt qua bước đọc ở trên: partial unique index chặn kẻ đến sau (P2002).
      if (!isUniqueViolation(err)) throw err;
      const open = await this.prisma.subscription.findFirst({ where: { ...key, status: { in: OPEN_STATUSES } } });
      if (!open) throw err;
      return this.resolveDuplicate(open, asRequested, variation.product.name);
    }
    if (placed) await this.afterOrderPlaced(placed);
    const o = placed?.order;
    return {
      ...created,
      firstOrder: o
        ? { id: o.id, code: o.code, status: o.status, paymentMethod: o.paymentMethod, total: o.total }
        : null,
    };
  }

  /**
   * Đơn đầu của gói giao ngay, trong tx tạo gói. Lỗi kỳ đầu đổi thành 400 tiếng Việt và rollback cả gói —
   * khác cron (kỳ sau), nơi cùng lỗi đó dẫn tới tạm dừng gói/thử lại kỳ sau.
   */
  private async placeFirstOrder(tx: Prisma.TransactionClient, subId: string, now: Date, code: string) {
    try {
      const placed = await this.placeCycleOrder(tx, subId, now, code);
      if (!placed) throw new BadRequestException('Không tạo được đơn đầu của gói định kỳ.');
      return { placed, subPatch: { lastOrderId: placed.order.id, nextRunAt: placed.nextRunAt } };
    } catch (err) {
      throw this.cycleRequestError(err, 'đơn đầu tiên');
    }
  }

  /**
   * Lỗi ghi đơn kỳ khi khách đang chờ (đơn đầu giao ngay, "Đặt kỳ này ngay"): đổi thành 400 tiếng Việt, tx đã rollback. Cron (kỳ sau) xử lý
   * cùng lỗi đó khác: tạm dừng gói hay thử lại đêm sau. `orderLabel` là đơn đang nói tới trong câu ví thiếu.
   */
  private cycleRequestError(err: unknown, orderLabel: string): unknown {
    if (err instanceof SubscriptionOutOfStockError) return new BadRequestException(err.message);
    if (err instanceof SubscriptionWalletShortError) {
      return new BadRequestException(`Số dư Ví Tubu không đủ để thanh toán ${orderLabel}, hãy nạp thêm hoặc chọn cách trả khác.`);
    }
    if (err instanceof SubscriptionAddressError) return new BadRequestException('Địa chỉ không hợp lệ.');
    if (err instanceof SubscriptionPartnerGoodsError) return partnerGoodsError('SUBSCRIPTION', err.productName);
    if (err instanceof SubscriptionCodLimitError) {
      return new BadRequestException(
        `Đơn vượt hạn mức thanh toán khi nhận hàng (${COD_LIMIT_TEXT}), bạn giảm số lượng hoặc chọn Ví Tubu/chuyển khoản nhé.`,
      );
    }
    return err;
  }

  /**
   * Đã có gói còn chạy cho cùng SP + địa chỉ (Q-13). Bấm đúp/retry gửi lại y hệt → trả lại gói đó
   * (idempotent, không kèm firstOrder). Khác số lượng/chu kỳ/cách trả hoặc gói đang tạm dừng → 409 để
   * khách sửa/bật lại gói cũ thay vì âm thầm có 2 lịch giao cùng chỗ hoặc mất cách trả vừa chọn.
   */
  private resolveDuplicate(
    open: { id: string; status: string; quantity: number; intervalWeeks: number; paymentMethod?: string | null },
    req: { quantity: number; intervalWeeks: number; paymentMethod: SubscriptionPaymentMethod },
    productName: string,
  ) {
    if (
      open.status === 'ACTIVE' &&
      open.quantity === req.quantity &&
      open.intervalWeeks === req.intervalWeeks &&
      (open.paymentMethod ?? 'COD') === req.paymentMethod
    ) {
      return open;
    }
    throw subscriptionDuplicateError(open, productName);
  }

  private async insertSubscription(
    tx: Prisma.TransactionClient,
    userId: string,
    dto: CreateSubInput,
    quantity: number,
    paymentMethod: SubscriptionPaymentMethod,
    nextRunAt: Date,
  ) {
    const sub = await tx.subscription
      .create({
        data: {
          userId,
          variationId: dto.variationId,
          quantity,
          intervalWeeks: dto.intervalWeeks,
          addressId: dto.addressId,
          paymentMethod,
          nextRunAt,
        },
      })
      .catch((err: unknown) => {
        // Địa chỉ bị xoá giữa lúc kiểm ở trên và lúc ghi gói: FK RESTRICT (C-014) báo P2003.
        if (isAddressFkViolation(err)) throw new BadRequestException('Địa chỉ không hợp lệ.');
        throw err;
      });
    await this.analytics.record(tx, {
      eventName: 'subscription_changed',
      userId,
      platform: 'miniapp',
      props: {
        subscriptionId: sub.id,
        action: 'created',
        variationId: dto.variationId,
        intervalWeeks: dto.intervalWeeks,
      },
    });
    return sub;
  }

  /**
   * Sửa số lượng / địa chỉ / cách trả / chu kỳ của gói đang chạy hoặc tạm dừng (Q-13, Q22). Khoá dòng gói như tx
   * sinh đơn kỳ: cron đang ghi đơn thì chờ, nên đơn kỳ luôn theo trọn bản cũ hoặc trọn bản mới.
   */
  async update(userId: string, id: string, dto: UpdateSubInput) {
    const paymentMethod = dto.paymentMethod === undefined ? undefined : this.parsePaymentMethod(dto.paymentMethod);
    if (dto.quantity !== undefined) this.assertQuantity(dto.quantity);
    if (dto.intervalWeeks !== undefined) this.assertIntervalWeeks(dto.intervalWeeks);
    const rescheduledAt = dto.nextRunDate === undefined ? undefined : this.parseRescheduleDate(dto.nextRunDate);
    const expectedNextRunAt = this.parseExpectedNextRunAt(dto.expectedNextRunAt, rescheduledAt !== undefined);
    let productName = 'Sản phẩm';
    let variationId: string | null = null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const sub = await this.lockSubscription(tx, id);
        if (!sub || sub.userId !== userId) throw new NotFoundException('Không tìm thấy lịch đặt định kỳ.');
        if (!OPEN_STATUSES.includes(sub.status)) {
          throw new BadRequestException('Gói định kỳ đã huỷ, không sửa được nữa.');
        }
        // Ngày khách chọn tính từ "Lần kế" trên màn hình. Cron đã ra đơn kỳ đó (nextRunAt sang kỳ sau) mà vẫn ghi thì kỳ đó giao
        // rồi lại thêm đơn ở ngày mới: hai đơn, gói trả Ví bị trừ hai lần. So dưới khoá dòng, cùng khoá tx sinh đơn kỳ giữ.
        if (expectedNextRunAt && sub.nextRunAt.getTime() !== expectedNextRunAt.getTime()) {
          throw new ConflictException(SCHEDULE_CHANGED_MESSAGE);
        }
        variationId = sub.variationId;
        const variation = await tx.variation.findUnique({
          where: { id: sub.variationId },
          include: { product: { select: { name: true, isActive: true, approvalStatus: true } } },
        });
        productName = variation?.product.name ?? productName;
        if (!variation || !isSellableVariation(variation)) throw productDiscontinuedError(variation?.product.name);
        if (dto.addressId !== undefined && dto.addressId !== sub.addressId) {
          const addr = await tx.address.findUnique({ where: { id: dto.addressId } });
          if (!addr || addr.userId !== userId) throw new BadRequestException('Địa chỉ không hợp lệ.');
          const open = await tx.subscription.findFirst({
            where: {
              userId,
              variationId: sub.variationId,
              addressId: dto.addressId,
              status: { in: OPEN_STATUSES },
              id: { not: id },
            },
          });
          if (open) throw subscriptionDuplicateError(open, productName);
        }
        const intervalPatch = await this.intervalPatch(tx, sub, dto.intervalWeeks);
        const updated = await tx.subscription
          .update({
            where: { id },
            data: {
              ...intervalPatch,
              // Ngày khách chọn thắng ngày do đổi chu kỳ tính ra; kỳ đang thử lại vì hết hàng thì đếm lại từ đầu như mọi lần dời lịch.
              ...(rescheduledAt ? { nextRunAt: rescheduledAt, retryCount: 0 } : {}),
              ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
              ...(dto.addressId !== undefined ? { addressId: dto.addressId } : {}),
              ...(paymentMethod !== undefined ? { paymentMethod } : {}),
            },
          })
          .catch((err: unknown) => {
            if (isAddressFkViolation(err)) throw new BadRequestException('Địa chỉ không hợp lệ.');
            throw err;
          });
        await this.analytics.record(tx, {
          eventName: 'subscription_changed',
          userId,
          platform: 'miniapp',
          props: {
            subscriptionId: id,
            action: 'updated',
            quantity: updated.quantity,
            intervalWeeks: updated.intervalWeeks,
            nextRunAt: updated.nextRunAt,
            addressChanged: updated.addressId !== sub.addressId,
            paymentMethod: updated.paymentMethod,
            rescheduled: rescheduledAt !== undefined,
          },
        });
        return updated;
      });
    } catch (err) {
      // Hai gói cùng SP đổi song song sang cùng một địa chỉ: partial unique index chặn kẻ đến sau.
      if (!isUniqueViolation(err) || !dto.addressId || !variationId) throw err;
      const open = await this.prisma.subscription.findFirst({
        where: { userId, variationId, addressId: dto.addressId, status: { in: OPEN_STATUSES }, id: { not: id } },
      });
      if (!open) throw err;
      throw subscriptionDuplicateError(open, productName);
    }
  }

  /**
   * Đổi chu kỳ: ngày giao kế = 0h VN của ngày đơn kỳ gần nhất + chu kỳ mới, không sớm hơn 0h ngày mai giờ VN (cùng mức
   * báo trước tối thiểu của ngày bắt đầu lúc tạo gói, để cron 3h sáng không giao ngay trong ngày khách bấm lưu).
   * Neo 0h chứ không neo giờ tạo đơn: createdAt của đơn cron luôn muộn hơn `now` lúc cron bắt đầu, neo thẳng thì đến
   * ngày hẹn cron 3h chạy sớm hơn nextRunAt và lỡ nhịp một ngày so với ngày đã báo khách.
   * Gói chưa ra đơn nào giữ nguyên ngày bắt đầu khách đã chọn: chu kỳ chỉ có nghĩa từ đơn thứ hai. Gói tạm dừng cũng
   * tính như gói đang chạy để bật lại giữ đúng ngày; setStatus chỉ dời khi ngày đó đã qua. Bậc giảm tính theo số gói
   * ACTIVE nên không bị đụng tới.
   */
  private async intervalPatch(tx: Prisma.TransactionClient, sub: LockedSubRow, intervalWeeks: number | undefined) {
    if (intervalWeeks === undefined || intervalWeeks === sub.intervalWeeks) return {};
    if (!sub.lastOrderId) return { intervalWeeks };
    const last = await tx.order.findUnique({ where: { id: sub.lastOrderId }, select: { createdAt: true } });
    if (!last) return { intervalWeeks };
    const earliest = new Date(startOfVnDay().getTime() + 864e5);
    const due = this.addWeeks(startOfVnDay(last.createdAt), intervalWeeks);
    return { intervalWeeks, nextRunAt: due < earliest ? earliest : due, retryCount: 0 };
  }

  /**
   * Gợi ý giao định kỳ theo nhịp mua của chính khách (cờ `subscriptions.smart_interval_enabled`). Phân loại khách đã nhận ở ≥ 2 đơn DELIVERED (trong
   * một năm), chu kỳ là trung vị khoảng cách làm tròn về 4/6/8/10 tuần (`smart-interval.ts`). Bỏ món đã có gói ACTIVE/PAUSED, món ngừng bán, hết hàng,
   * hàng gian hàng đối tác (tự giao hay giao hộ: không có giảm định kỳ). Tối đa 3, lần nhận gần nhất trước. Chỉ đọc; không đổi giá, không phát điểm.
   */
  async suggestions(userId: string, now: Date = new Date()) {
    if ((await this.config.get<boolean>(SMART_INTERVAL_ENABLED_KEY, false)) !== true) return { enabled: false, items: [] };
    const since = new Date(now.getTime() - SMART_INTERVAL_LOOKBACK_DAYS * 86_400_000);
    const rows = await this.prisma.orderItem.findMany({
      where: { order: { userId, status: 'DELIVERED', deliveredAt: { gte: since } } },
      select: { variationId: true, order: { select: { deliveredAt: true } } },
      orderBy: { order: { deliveredAt: 'desc' } },
      take: 500,
    });
    const candidates = intervalCandidates(
      rows.flatMap((r) => (r.order.deliveredAt ? [{ variationId: r.variationId, deliveredAt: r.order.deliveredAt }] : [])),
      SUBSCRIPTION_INTERVAL_WEEKS,
    );
    if (candidates.length === 0) return { enabled: true, items: [] };
    const ids = candidates.map((c) => c.variationId);
    const [open, variations] = await Promise.all([
      this.prisma.subscription.findMany({ where: { userId, status: { in: OPEN_STATUSES }, variationId: { in: ids } }, select: { variationId: true } }),
      this.prisma.variation.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          productId: true,
          isActive: true,
          stock: true,
          retailPrice: true,
          salePrice: true,
          pancakeId: true,
          product: { select: { name: true, slug: true, thumbnail: true, isActive: true, approvalStatus: true, fulfilment: true, storefrontId: true } },
        },
      }),
    ]);
    const subscribed = new Set(open.map((o) => o.variationId));
    const byId = new Map(variations.map((v) => [v.id, v]));
    const items = [];
    for (const c of candidates) {
      const v = byId.get(c.variationId);
      if (!v || subscribed.has(v.id) || !isSellableVariation(v) || v.stock <= 0) continue;
      // Đơn kỳ chỉ đi kho Tubu qua Pancake (`PANCAKE_FULFILLED_VARIATION_WHERE` ở lúc tạo gói): món không giao được kiểu đó thì không mời.
      if (!isPancakeFulfilledLine({ pancakeId: v.pancakeId, fulfilment: v.product.fulfilment }) || isPartnerOwnedVariation(v)) continue;
      items.push({
        variationId: v.id,
        productName: v.product.name,
        variationName: v.name,
        slug: v.product.slug,
        thumbnail: publicImage('product', v.productId, 'thumb', v.product.thumbnail),
        unitPrice: v.salePrice ?? v.retailPrice,
        intervalWeeks: c.intervalWeeks,
        lastDeliveredAt: c.lastDeliveredAt.toISOString(),
      });
      if (items.length >= SMART_INTERVAL_MAX) break;
    }
    return { enabled: true, items };
  }

  /** Mặc định 100 gói mới nhất (tối đa 200); cursor = id gói cuối của trang trước. */
  async list(userId: string, opts: { take?: number; cursor?: string } = {}) {
    const subs = await this.prisma.subscription.findMany({
      where: { userId, status: { not: 'CANCELLED' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(opts.take ?? 100, 1), 200),
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    if (subs.length === 0) return [];
    const lastOrderIds = subs.flatMap((s) => (s.lastOrderId ? [s.lastOrderId] : []));
    const hasActive = subs.some((s) => s.status === 'ACTIVE');
    const [variations, tier, lastOrders] = await Promise.all([
      this.prisma.variation.findMany({
        where: { id: { in: subs.map((s) => s.variationId) } },
        include: { product: { select: { name: true, thumbnail: true, slug: true } } },
      }),
      this.discountTierStatus(userId, this.prisma, { floorCount: hasActive ? 1 : 0 }),
      lastOrderIds.length > 0
        ? this.prisma.order.findMany({ where: { id: { in: lastOrderIds } }, select: { id: true, createdAt: true } })
        : Promise.resolve([]),
    ]);
    const vmap = new Map(variations.map((v) => [v.id, v]));
    const lastOrderAt = new Map(lastOrders.map((o) => [o.id, o.createdAt]));
    const effectiveDiscountPct = tier.pct;
    // Chỉ khi có gói đang chạy: khách chỉ còn gói tạm dừng thì bật lại một gói là có bậc, câu "thêm 1 gói" sẽ sai.
    const nextTier = hasActive ? nextDiscountTier(tier.tiers, tier.activeCount, tier.pct) : null;
    return subs.map((s) => {
      const v = vmap.get(s.variationId);
      return {
        id: s.id,
        quantity: s.quantity,
        intervalWeeks: s.intervalWeeks,
        status: s.status,
        // Chỉ nói lý do khi gói đang tạm dừng: gói đã bật lại hay còn chạy không mang lý do cũ.
        pausedReason: s.status === 'PAUSED' ? (s.pausedReason ?? null) : null,
        nextRunAt: s.nextRunAt,
        addressId: s.addressId,
        paymentMethod: s.paymentMethod ?? 'COD',
        lastOrderId: s.lastOrderId ?? null,
        // Mini App tính trước ngày giao kế khi khách chọn chu kỳ khác, cùng luật với intervalPatch.
        lastOrderAt: (s.lastOrderId && lastOrderAt.get(s.lastOrderId)) || null,
        productName: v?.product.name ?? 'Sản phẩm',
        variationName: v?.name ?? '',
        thumbnail: v ? publicImage('product', v.productId, 'thumb', v.product.thumbnail) : null,
        slug: v?.product.slug ?? null,
        unitPrice: v ? (v.salePrice ?? v.retailPrice) : 0,
        effectiveDiscountPct,
        /** Bậc giảm kế tiếp (cùng một giá trị trên mọi gói của khách): còn thiếu bao nhiêu gói đang chạy và % của bậc đó. */
        nextTier,
        ...cycleAmountsView(v ? (v.salePrice ?? v.retailPrice) : 0, s.quantity, effectiveDiscountPct),
      };
    });
  }

  /**
   * % giảm hiệu lực cho đơn Subscribe & Save của userId, theo THANG BẬC
   * subscribe.discount_tiers: chọn bậc minActive cao nhất mà số gói "thật" của user đạt được.
   * Gói thật = ACTIVE và (đã ra ít nhất một đơn HOẶC kỳ kế tiếp trong 35 ngày tới, kể cả quá hạn),
   * để khách không nâng bậc bằng cách tạo nhiều gói hẹn ngày rất xa.
   * - selfId: gói đang tạo đơn, luôn tự đếm (đơn đầu giao ngay chưa có lastOrderId, kỳ cron đã dời nextRunAt).
   * - floorCount: sàn số gói khi người gọi biết user có gói ACTIVE sắp ra đơn (danh sách hiện bậc thấp nhất
   *   thay vì 0%, đúng với bậc mà đơn kỳ đầu tiên của gói đó sẽ được áp).
   */
  async effectiveDiscountPct(
    userId: string,
    db: Pick<Prisma.TransactionClient, 'subscription'> = this.prisma,
    opts: { selfId?: string; floorCount?: number } = {},
  ): Promise<number> {
    return (await this.discountTierStatus(userId, db, opts)).pct;
  }

  /** Như `effectiveDiscountPct`, kèm số gói đang tính và thang bậc đọc được, để danh sách nói bậc kế tiếp bằng đúng số đó. */
  private async discountTierStatus(
    userId: string,
    db: Pick<Prisma.TransactionClient, 'subscription'>,
    opts: { selfId?: string; floorCount?: number },
  ): Promise<{ pct: number; activeCount: number; tiers: DiscountTier[] }> {
    const basePct = await this.config.get<number>('subscribe.discount_pct', 0.12);
    const tiers = await this.config.get<DiscountTier[]>('subscribe.discount_tiers', [{ minActive: 1, pct: basePct }]);
    const horizon = new Date(Date.now() + TIER_WINDOW_DAYS * 86_400_000);
    const counted = await db.subscription.count({
      where: {
        userId,
        status: 'ACTIVE',
        OR: [
          { lastOrderId: { not: null } },
          { nextRunAt: { lte: horizon } },
          ...(opts.selfId ? [{ id: opts.selfId }] : []),
        ],
      },
    });
    const activeCount = Math.max(counted, opts.floorCount ?? 0);
    const applicable = tiers.filter((t) => activeCount >= t.minActive).sort((a, b) => b.pct - a.pct);
    return { pct: applicable[0]?.pct ?? 0, activeCount, tiers };
  }

  async setStatus(userId: string, id: string, status: 'ACTIVE' | 'PAUSED' | 'CANCELLED') {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub || sub.userId !== userId) throw new NotFoundException('Không tìm thấy lịch đặt định kỳ.');
    if (status === 'ACTIVE') {
      const variation = await this.prisma.variation.findUnique({
        where: { id: sub.variationId },
        select: { product: { select: { name: true, storefrontId: true } } },
      });
      if (isPartnerOwnedVariation(variation)) throw partnerGoodsError('SUBSCRIPTION', variation?.product.name);
    }
    // Bật lại: cron 03:00 VN nhận mọi gói có nextRunAt trước 0h VN ngày mai, nên chỉ cần biết cron hôm nay còn chạy không.
    // - Ngày hẹn từ mai trở đi: giữ nguyên (giờ lẻ của ngày đó vẫn ra đúng ngày).
    // - Hẹn hôm nay và cron hôm nay chưa chạy: giữ nguyên, đơn ra sáng nay đúng ngày "Lần kế" khách thấy. Không so nextRunAt
    //   với giờ bấm: nextRunAt neo 0h VN nên luôn nhỏ hơn giờ bấm, so vậy thì gói chưa lỡ kỳ nào cũng bị dời cả một chu kỳ.
    // - Hẹn hôm nay mà cron đã chạy (gói đang tạm dừng nên bị bỏ qua): nextRunAt còn ở tương lai (giờ lẻ của dữ liệu cũ) thì
    //   dời sang 0h ngày mai; đã qua thì gói đã lỡ kỳ, dời một chu kỳ tính từ hôm nay để không ra đơn bù ngoài lịch.
    let nextRunAt = sub.nextRunAt;
    if (status === 'ACTIVE') {
      const resumeNow = new Date();
      const todayVn = startOfVnDay(resumeNow);
      const tomorrowVn = new Date(todayVn.getTime() + 864e5);
      const cronStillToRunToday = resumeNow.getTime() < todayVn.getTime() + SUBSCRIPTION_CRON_HOUR_VN * 3600e3;
      if (sub.nextRunAt >= tomorrowVn || (sub.nextRunAt >= todayVn && cronStillToRunToday)) {
        nextRunAt = sub.nextRunAt;
      } else if (sub.nextRunAt >= resumeNow) {
        nextRunAt = tomorrowVn;
      } else {
        const resumed = this.addWeeks(todayVn, sub.intervalWeeks);
        nextRunAt = resumed < tomorrowVn ? tomorrowVn : resumed;
      }
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Ghi có điều kiện theo bản vừa đọc: cron claim chen giữa (dời nextRunAt) mà ghi theo id thì trả nextRunAt cũ về, lịch lệch kỳ.
        const written = await tx.subscription.updateMany({
          where: { id, userId, status: sub.status, nextRunAt: sub.nextRunAt },
          data: { status, nextRunAt, retryCount: 0, pausedReason: status === 'PAUSED' ? CUSTOMER_PAUSE_REASON : null },
        });
        if (written.count === 0) throw new ConflictException(SCHEDULE_CHANGED_MESSAGE);
        const updated = await tx.subscription.findUniqueOrThrow({ where: { id } });
        await this.analytics.record(tx, {
          eventName: 'subscription_changed',
          userId,
          platform: 'miniapp',
          props: {
            subscriptionId: id,
            action: status === 'ACTIVE' ? 'resumed' : status === 'PAUSED' ? 'paused' : 'cancelled',
          },
        });
        return updated;
      });
    } catch (err) {
      // Bật lại gói đã huỷ trong khi khách đã tạo gói mới cùng SP + địa chỉ: partial unique chặn (P2002).
      if (!isUniqueViolation(err)) throw err;
      const open = await this.prisma.subscription.findFirst({
        where: {
          userId: sub.userId,
          variationId: sub.variationId,
          addressId: sub.addressId,
          status: { in: OPEN_STATUSES },
          id: { not: id },
        },
      });
      if (!open) throw err;
      const variation = await this.prisma.variation.findUnique({
        where: { id: sub.variationId },
        select: { product: { select: { name: true } } },
      });
      throw subscriptionDuplicateError(open, variation?.product.name ?? 'Sản phẩm');
    }
  }

  /**
   * Save-flow: bỏ qua 1 kỳ giao kế tiếp mà KHÔNG hủy/tạm dừng lịch — đẩy nextRunAt thêm 1 chu kỳ tính từ nextRunAt hiện tại, giữ ACTIVE.
   * `expectedNextRunAt` là "Lần kế" khách đang thấy, so dưới khoá dòng như dời ngày: cron 03:00 vừa ra đơn kỳ đó (nextRunAt đã sang kỳ sau)
   * thì 409, không lặng lẽ bỏ qua kỳ SAU trong khi khách tưởng đã bỏ kỳ vừa giao.
   * Thiếu trường thì bỏ kỳ đang có như trước: bản Mini App đã cài trên máy khách (ZMP cũ) và tab web mở trước lúc deploy gửi skip không thân,
   * bắt buộc ngay thì nút "Bỏ qua kỳ này" của họ hỏng hẳn tới khi có ZMP mới. Hai client hiện tại luôn gửi.
   */
  async skipCycle(userId: string, id: string, expectedNextRunAt: string | undefined) {
    const expected = this.parseExpectedNextRunAt(expectedNextRunAt, false);
    return this.prisma.$transaction(async (tx) => {
      const sub = await this.lockSubscription(tx, id);
      if (!sub || sub.userId !== userId) throw new NotFoundException('Không tìm thấy lịch đặt định kỳ.');
      if (sub.status !== 'ACTIVE') throw new BadRequestException('Chỉ bỏ qua kỳ khi lịch đang chạy.');
      if (expected && sub.nextRunAt.getTime() !== expected.getTime()) throw new ConflictException(SCHEDULE_CHANGED_MESSAGE);
      return tx.subscription.update({ where: { id }, data: { nextRunAt: this.addWeeks(sub.nextRunAt, sub.intervalWeeks), retryCount: 0 } });
    });
  }

  /**
   * "Đặt kỳ này ngay": ra đơn của kỳ tới ngay hôm nay rồi tính kỳ sau từ hôm nay, như đơn đầu giao ngay. Chỉ gói ACTIVE.
   * Một ngày một đơn cho mỗi gói: khoá dòng gói (FOR UPDATE) nên chạm đúp xếp hàng, lượt sau thấy đơn hôm nay và nhận 409.
   * Khoá idempotency của đơn là 0h VN hôm nay, trùng khoá cron dùng cho kỳ đến hạn hôm nay (nextRunAt neo 0h VN): cron vừa nhận kỳ
   * mà chưa kịp ghi đơn thì chỉ một bên ghi được, bên kia gặp P2002 (cron coi là đã ghi, khách nhận 409).
   */
  async runNow(userId: string, id: string) {
    const now = new Date();
    const cycleAt = startOfVnDay(now);
    const code = await generateUniqueOrderCode(this.prisma, 'SUBSCRIPTION');
    let placed: PlacedCycleOrder & { nextRunAt: Date };
    try {
      placed = await this.prisma.$transaction(async (tx) => {
        const sub = await this.lockSubscription(tx, id);
        if (!sub || sub.userId !== userId) throw new NotFoundException('Không tìm thấy lịch đặt định kỳ.');
        if (sub.status !== 'ACTIVE') throw new BadRequestException(RUN_NOW_INACTIVE_MESSAGE);
        const today = await tx.order.findFirst({ where: { subscriptionId: id, createdAt: { gte: cycleAt } }, select: { id: true } });
        if (today) throw new ConflictException(RUN_NOW_TODAY_MESSAGE);
        // nextRunAt không sau cycleAt thì placeCycleOrder tính kỳ kế = 0h VN hôm nay + chu kỳ (nhánh đơn đầu giao ngay).
        await tx.subscription.update({ where: { id }, data: { nextRunAt: cycleAt, retryCount: 0 } });
        const res = await this.placeCycleOrder(tx, id, cycleAt, code);
        if (!res) throw new BadRequestException(RUN_NOW_INACTIVE_MESSAGE);
        return res;
      });
    } catch (err) {
      if (isIdempotencyViolation(err)) throw new ConflictException(RUN_NOW_TODAY_MESSAGE);
      throw this.cycleRequestError(err, 'đơn kỳ này');
    }
    await this.afterOrderPlaced(placed);
    await this.analytics.recordBestEffort({
      eventName: 'subscription_changed',
      userId,
      platform: 'miniapp',
      props: { subscriptionId: id, action: 'run_now', orderId: placed.order.id },
    });
    const sub = await this.prisma.subscription.findUniqueOrThrow({ where: { id } });
    const o = placed.order;
    return { ...sub, order: { id: o.id, code: o.code, status: o.status, paymentMethod: o.paymentMethod, total: o.total } };
  }

  /**
   * Cron 3h sáng: xử lý các subscription đến hạn → tạo đơn kỳ + dời chu kỳ.
   *
   * Toàn thân bọc try/catch: @Cron không tự bắt lỗi — findMany/updateMany lỗi (DB blip...) ném ra
   * ngoài là unhandledRejection, Node 20 mặc định crash cả process. Lỗi tạo đơn từng subscription
   * đã được cô lập ở try/catch trong vòng lặp bên dưới.
   */
  @Cron(`0 ${SUBSCRIPTION_CRON_HOUR_VN} * * *`, { timeZone: CRON_TZ })
  @TrackCron()
  async processDue(): Promise<void> {
    try {
      const now = new Date();
      // Đến hạn theo NGÀY VN: cron 03:00 phải lấy cả gói hẹn 14:23 của cùng ngày (gói cũ còn lưu giờ lẻ), nên mốc cắt là 0h VN ngày mai.
      const dueBefore = new Date(startOfVnDay(now).getTime() + 864e5);
      const claimBase = startOfVnDay(now);
      let created = 0;
      // Cũ nhất trước và quét hết các trang: trước đây take 200 không orderBy nên phần dư dồn sang đêm sau, mà gói đã
      // claim thì rời tập "đến hạn" nên trang kế luôn là các gói chưa xử lý.
      for (let page = 0; page < DUE_MAX_PAGES; page++) {
        const due = await this.prisma.subscription.findMany({
          where: { status: 'ACTIVE', nextRunAt: { lt: dueBefore } },
          orderBy: [{ nextRunAt: 'asc' }, { id: 'asc' }],
          take: DUE_PAGE_SIZE,
        });
        for (const sub of due) {
          let claim: Awaited<ReturnType<typeof this.claimDue>>;
          try {
            claim = await this.claimDue(sub, claimBase);
          } catch (err) {
            // Chờ khoá quá hạn tx (khách đang giữ dòng gói), DB chập chờn: bỏ gói này đêm nay, các gói sau vẫn chạy.
            this.logger.error(`Subscription ${sub.id} claim lỗi: ${err instanceof Error ? err.message : err}`);
            continue;
          }
          if (!claim) continue; // instance khác đã claim, hoặc khách vừa đổi lịch/trạng thái
          try {
            if (await this.runCycle(claim.sub, sub.nextRunAt, claim.nextRunAt, claimBase)) created++;
          } catch (err) {
            this.logger.error(`Subscription ${sub.id} lỗi: ${err instanceof Error ? err.message : err}`);
          }
        }
        if (due.length < DUE_PAGE_SIZE) break;
      }
      if (created) this.logger.log(`Subscription orders created: ${created}`);
    } catch (err) {
      this.logger.error(`processDue lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * CLAIM một kỳ đến hạn: dời nextRunAt TRƯỚC khi tạo đơn, chỉ khi gói còn ACTIVE và nextRunAt vẫn là bản lúc quét, nên nhiều instance cron
   * không ra đơn trùng. Khoá dòng gói (FOR UPDATE) trước bước so-và-dời, cùng thứ tự khoá với sửa/bỏ qua/đặt ngay: chu kỳ và lượt thử lại
   * đọc từ bản đang khoá chứ không từ bản quét (trang 200 gói xử lý tuần tự, khách có thể đổi chu kỳ giữa lúc quét và lúc tới lượt).
   */
  private async claimDue(
    scanned: { id: string; nextRunAt: Date },
    claimBase: Date,
  ): Promise<{ sub: { id: string; userId: string; retryCount: number; intervalWeeks: number }; nextRunAt: Date } | null> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lockSubscription(tx, scanned.id);
      if (!row || row.status !== 'ACTIVE') return null;
      const nextRunAt = this.addWeeks(claimBase, row.intervalWeeks);
      const claimed = await tx.subscription.updateMany({
        where: { id: scanned.id, status: 'ACTIVE', nextRunAt: scanned.nextRunAt },
        data: { nextRunAt },
      });
      if (claimed.count === 0) return null;
      return { sub: { id: row.id, userId: row.userId, retryCount: row.retryCount, intervalWeeks: row.intervalWeeks }, nextRunAt };
    });
  }

  /**
   * Một kỳ đã claim: ghi đơn rồi xử lý hậu quả từng loại lỗi. Trả true nếu có đơn mới. `nextRunAt` = kỳ kế mà bước
   * claim đã ghi; bật lại lịch giữ nguyên ngày đó nên tin tạm dừng nói rõ kỳ này không giao và ngày kỳ kế tiếp.
   */
  private async runCycle(
    sub: { id: string; userId: string; retryCount?: number; intervalWeeks?: number },
    cycleAt: Date,
    nextRunAt: Date,
    orderedSince?: Date,
  ): Promise<boolean> {
    let placed: PlacedCycleOrder | null;
    const missed = ` (kỳ này không giao, kỳ kế tiếp ngày ${formatVnDate(nextRunAt)})`;
    try {
      // Sinh mã trong try: bước claim đã dời nextRunAt, nên lỗi ở đây (DB bận, hết lượt mã) phải đi nhánh thử lại bên dưới, không mất kỳ.
      const code = await generateUniqueOrderCode(this.prisma, 'SUBSCRIPTION');
      placed = await this.prisma.$transaction((tx) => this.placeCycleOrder(tx, sub.id, cycleAt, code, sub.intervalWeeks, orderedSince));
    } catch (err) {
      if (isProductDiscontinuedError(err)) {
        await this.pauseSubscription(sub, 'Sản phẩm đã ngừng bán', 'inactive_product');
        return false;
      }
      if (err instanceof SubscriptionAddressError) {
        await this.pauseSubscription(sub, `Địa chỉ giao hàng không còn hợp lệ${missed}`, 'invalid_address');
        return false;
      }
      if (err instanceof SubscriptionPartnerGoodsError) {
        await this.pauseSubscription(sub, err.message, 'partner_goods');
        return false;
      }
      if (err instanceof SubscriptionWalletShortError) {
        await this.pauseSubscription(sub, `Số dư Ví Tubu không đủ để thanh toán đơn kỳ này${missed}`, 'insufficient_wallet');
        return false;
      }
      if (err instanceof SubscriptionCodLimitError) {
        await this.pauseSubscription(
          sub,
          `Giá trị đơn kỳ vượt hạn mức thanh toán khi nhận hàng (${COD_LIMIT_TEXT}), hãy giảm số lượng hoặc đổi sang Ví Tubu/chuyển khoản${missed}`,
          'cod_limit',
        );
        return false;
      }
      if (err instanceof SubscriptionOutOfStockError) {
        // Hết hàng thường chỉ tạm thời: không pause lịch, cũng không bỏ cả chu kỳ 4-10 tuần — thử lại từng đêm.
        await this.retryOrSkipCycle(sub, nextRunAt, 'Hết hàng tạm thời', 'out_of_stock');
        return false;
      }
      // Lỗi còn lại (P2034, DB chập chờn...): tx đã rollback nên không có đơn dở — trừ khi đơn kỳ này đã ghi xong và lỗi
      // đến sau đó, khi đó không thử lại kẻo đẻ đơn thứ hai.
      this.logger.error(`Subscription ${sub.id} lỗi: ${err instanceof Error ? err.message : err}`);
      const written = await this.prisma.order.findUnique({
        where: { idempotencyKey: `subscription:${sub.id}:${cycleAt.toISOString()}` },
        select: { id: true },
      });
      if (!written) await this.retryOrSkipCycle(sub, nextRunAt, 'Hệ thống đang bận', 'transient_error');
      return false;
    }
    if (!placed) return false;
    await this.afterOrderPlaced(placed);
    return true;
  }

  /**
   * Kỳ không ra đơn vì lý do có thể tự hết: hẹn lại 0h ngày mai (giờ VN, trước cron 3h) tối đa
   * `subscribe.stock_retry_days` đêm, báo khách một lần ở lần đầu. Hết lượt thì bỏ kỳ — nextRunAt đã ở kỳ kế do bước
   * claim — và báo ngày kỳ kế tiếp.
   */
  private async retryOrSkipCycle(
    sub: { id: string; userId: string; retryCount?: number },
    nextCycleAt: Date,
    reason: string,
    reasonCode: string,
  ): Promise<void> {
    const attempt = sub.retryCount ?? 0;
    const maxRetries = await this.stockRetryDays();
    let retry: string | null;
    if (attempt < maxRetries) {
      const retryAt = new Date(`${vnDateKey(new Date(Date.now() + 864e5))}T00:00:00+07:00`);
      await this.prisma.subscription.updateMany({
        where: { id: sub.id, status: 'ACTIVE' },
        data: { nextRunAt: retryAt, retryCount: { increment: 1 } },
      });
      retry = attempt === 0 ? 'Lịch vẫn giữ, Tubu sẽ tự thử lại vào ngày mai.' : null;
    } else {
      if (attempt > 0) {
        await this.prisma.subscription.updateMany({ where: { id: sub.id, status: 'ACTIVE' }, data: { retryCount: 0 } });
      }
      retry = `Lịch vẫn giữ nhưng kỳ này không giao, kỳ kế tiếp ngày ${formatVnDate(nextCycleAt)}.`;
    }
    if (retry) await this.notifications.notifySafe(sub.userId, 'SUBSCRIPTION_ORDER_FAILED', { reason, retry }, undefined, `sub=${sub.id}`);
    await this.analytics.recordBestEffort({
      eventName: 'subscription_changed',
      userId: sub.userId,
      platform: 'system',
      props: { subscriptionId: sub.id, action: 'order_failed', reason: reasonCode },
    });
  }

  private async stockRetryDays(): Promise<number> {
    const raw = await this.config.get<unknown>(STOCK_RETRY_DAYS_KEY, DEFAULT_STOCK_RETRY_DAYS);
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= MAX_STOCK_RETRY_DAYS
      ? raw
      : DEFAULT_STOCK_RETRY_DAYS;
  }

  /**
   * Ghi đơn của một kỳ trong tx của caller. Số lượng, địa chỉ, cách trả đọc từ dòng gói dưới khoá
   * FOR UPDATE — không dùng bản đọc lúc quét — nên khách sửa/tạm dừng gói chen giữa thì đơn theo bản
   * mới nhất, hoặc không có đơn. Ví Tubu trừ trong cùng tx (thiếu → rollback cả đơn lẫn kho).
   * Khoá idempotencyKey theo (gói, kỳ) chặn ở DB việc một kỳ ra hai đơn; refId sổ ví = id đơn.
   * Trả null khi gói không còn ACTIVE.
   */
  private async placeCycleOrder(
    tx: Prisma.TransactionClient,
    subId: string,
    cycleAt: Date,
    code: string,
    scannedIntervalWeeks?: number,
    orderedSince?: Date,
  ): Promise<(PlacedCycleOrder & { nextRunAt: Date }) | null> {
    const sub = await this.lockSubscription(tx, subId);
    if (!sub || sub.status !== 'ACTIVE') return null;
    // Cron đã claim (dời nextRunAt) nhưng chưa khoá dòng thì khách bấm "Đặt kỳ này ngay" chen vào và ra đơn với khoá idempotency của
    // 0h hôm nay, khác khoá kỳ cron đang cầm: đơn của khách đã là đơn kỳ này, cron không ra đơn thứ hai (run-now cũng chặn chiều ngược lại).
    if (orderedSince && (await tx.order.findFirst({ where: { subscriptionId: subId, createdAt: { gte: orderedSince } }, select: { id: true } }))) return null;
    const variation = await tx.variation.findUnique({
      where: { id: sub.variationId },
      include: { product: { select: { name: true, slug: true, isActive: true, approvalStatus: true, storefrontId: true } } },
    });
    if (!variation || !isSellableVariation(variation)) throw productDiscontinuedError(variation?.product.name);
    if (isPartnerOwnedVariation(variation)) {
      throw new SubscriptionPartnerGoodsError(variation.product.name);
    }
    const addr = await tx.address.findUnique({ where: { id: sub.addressId } });
    if (!addr || addr.userId !== sub.userId) throw new SubscriptionAddressError('invalid address');
    const address: Prisma.InputJsonValue = {
      recipient: addr.recipient,
      phone: addr.phone,
      province: addr.province,
      district: addr.district,
      ward: addr.ward,
      street: addr.street,
      provinceCode: addr.provinceCode,
      districtCode: addr.districtCode,
      wardCode: addr.wardCode,
    };
    const user = await tx.user.findUniqueOrThrow({ where: { id: sub.userId } });

    const unitPrice = variation.salePrice ?? variation.retailPrice;
    const discountPct = await this.effectiveDiscountPct(sub.userId, tx, { selfId: sub.id });
    const { subtotal, discount, goods } = subscriptionCycleAmounts(unitPrice, sub.quantity, discountPct);
    const shippingFee = await this.pricing.calcShippingFee({ subtotal, tierId: user.tierId });
    const multiplier = await this.loyalty.getTierMultiplier(user.tierId);
    const pointsEarned = await this.pricing.calcPointsEarned(goods, multiplier);
    const total = goods + shippingFee;
    const method = sub.paymentMethod;
    const paid = method === 'WALLET';
    if (method === 'COD' && total > SUBSCRIPTION_COD_MAX) throw new SubscriptionCodLimitError('cod limit');

    // Trừ stock ATOMIC (mirror checkout.placeOrder/affiliate.processGroupOrder) TRONG cùng
    // transaction với tạo đơn — không đủ stock → throw, rollback; nextRunAt đã advance ở claim
    // nên không double-charge, chu kỳ sau sẽ thử lại.
    await assertVariationsSellable(tx, [{ variationId: variation.id, productName: variation.product.name }], {
      pancakeOnly: true,
    });
    const stockHit = await reserveVariationStock(tx, variation.id, sub.quantity);
    if (!stockHit) {
      throw new SubscriptionOutOfStockError(`Sản phẩm "${variation.product.name}" không đủ tồn kho cho đơn định kỳ.`);
    }
    const order = await tx.order.create({
      data: {
        code,
        idempotencyKey: `subscription:${sub.id}:${cycleAt.toISOString()}`,
        userId: sub.userId,
        type: 'RETAIL',
        // Chuyển khoản đi đúng luồng đơn trả trước: chờ tiền, quá hạn thì cron huỷ đơn tự hoàn kho.
        status: method === 'BANK_TRANSFER' ? 'PENDING_PAYMENT' : 'CONFIRMED',
        subtotal,
        discount,
        shippingFee,
        total,
        pointsEarned,
        paymentMethod: method,
        paymentStatus: paid ? 'PAID' : 'UNPAID',
        paidAt: paid ? new Date() : null,
        shippingAddress: address,
        // Kho/Pancake đọc chữ này, nên giữ nguyên giá trị lưu. App-core (SUBSCRIPTION_ORDER_NOTE) nhận ra đơn định kỳ bằng đúng chữ này
        // để hiện nhãn "Đơn định kỳ" thay vì ghi chú tiếng Anh; đổi chữ ở đây thì phải đổi cả bên đó.
        note: 'Đơn đặt định kỳ (Subscribe & Save)',
        source: 'subscription',
        platform: 'system',
        subscriptionId: sub.id,
        items: {
          create: [
            {
              variationId: variation.id,
              productName: variation.product.name,
              productSlug: variation.product.slug,
              variationName: variation.name,
              unitPrice,
              quantity: sub.quantity,
              total: subtotal,
            },
          ],
        },
      },
    });
    if (method === 'WALLET' && total > 0) {
      try {
        await this.walletLedger.applyDelta(tx, {
          userId: sub.userId,
          delta: -total,
          type: 'ORDER_PAY',
          refType: 'ORDER',
          refId: order.id,
          reason: `Thanh toán đơn định kỳ ${code}`,
          insufficientMessage: WALLET_SHORT_MESSAGE,
        });
      } catch (err) {
        if (err instanceof BadRequestException) throw new SubscriptionWalletShortError(WALLET_SHORT_MESSAGE);
        throw err;
      }
    }
    await this.analytics.record(tx, {
      eventName: 'order_placed',
      userId: sub.userId,
      platform: 'system',
      props: { orderId: order.id, orderSource: 'subscription', subscriptionId: sub.id, total, paymentMethod: method },
    });
    if (paid) {
      await this.analytics.record(tx, {
        eventName: 'order_paid',
        userId: sub.userId,
        platform: 'system',
        props: { orderId: order.id, method, amount: total, secsFromPlaced: 0 },
      });
    }
    await this.analytics.record(tx, {
      eventName: 'subscription_changed',
      userId: sub.userId,
      platform: 'system',
      props: { subscriptionId: sub.id, action: 'order_created', orderId: order.id },
    });
    const after = await tx.subscription.update({
      where: { id: sub.id },
      data: { lastOrderId: order.id, retryCount: 0 },
      select: { nextRunAt: true, intervalWeeks: true },
    });
    // Đơn đầu giao ngay ghi trong tx tạo gói: kỳ kế tính từ hôm nay (cron thì đã dời ở bước claim).
    let nextRunAt = after.nextRunAt;
    if (nextRunAt.getTime() <= cycleAt.getTime()) {
      nextRunAt = this.addWeeks(startOfVnDay(cycleAt), after.intervalWeeks);
      await tx.subscription.update({ where: { id: sub.id }, data: { nextRunAt } });
    } else if (scannedIntervalWeeks !== undefined && after.intervalWeeks !== scannedIntervalWeeks) {
      // Khách đổi chu kỳ chen giữa bước claim và khoá dòng: PATCH tính từ đơn kỳ trước nên ngày kế có thể sát hôm nay.
      // Đơn vừa ghi mới là đơn kỳ gần nhất, tính lại từ nó để không ra hai đơn hai ngày liền.
      nextRunAt = this.addWeeks(startOfVnDay(order.createdAt), after.intervalWeeks);
      await tx.subscription.update({ where: { id: sub.id }, data: { nextRunAt } });
    }
    return { order, userId: sub.userId, nextRunAt };
  }

  /**
   * Sau commit: đẩy Pancake như mọi đường tạo đơn khác. Thiếu bước này thì kho vật lý KHÔNG BAO GIỜ
   * thấy đơn định kỳ (P1-4, docs/2026-09-08-review-progress.md). Non-fatal: lỗi xếp hàng không được làm
   * hỏng chu kỳ cron — cron reconcile của Pancake quét lại đơn chưa có pancakeOrderId.
   */
  private async afterOrderPlaced({ order, userId }: PlacedCycleOrder): Promise<void> {
    await this.pancakeOrder
      .enqueuePush(order.id)
      .catch((err) =>
        this.logger.error(`Xếp hàng đẩy Pancake lỗi cho đơn ${order.code}: ${err instanceof Error ? err.message : err}`),
      );
    if (order.status === 'PENDING_PAYMENT') {
      const hours = await this.pendingPaymentTtlHours();
      await this.notifications
        .notifySafe(userId, 'SUBSCRIPTION_ORDER_AWAITING_PAYMENT', {
          order_code: order.code,
          amount: order.total.toLocaleString('vi-VN'),
          hours: String(hours),
        }, undefined, `order=${order.code}`);
      return;
    }
    await this.notifications.notifySafe(userId, 'SUBSCRIPTION_ORDER', { order_code: order.code }, undefined, `order=${order.code}`);
  }

  /** Không sinh đơn được vì lý do không tự hết (SP ngừng bán, địa chỉ hỏng, ví thiếu): tạm dừng + báo khách. */
  private async pauseSubscription(sub: { id: string; userId: string }, reason: string, reasonCode: SystemPauseCode): Promise<void> {
    // Chỉ lật gói còn ACTIVE: khách vừa huỷ thì giữ CANCELLED.
    await this.prisma.subscription.updateMany({ where: { id: sub.id, status: 'ACTIVE' }, data: { status: 'PAUSED', pausedReason: reasonCode } });
    await this.notifications.notifySafe(sub.userId, 'SUBSCRIPTION_PAUSED', { reason }, undefined, `sub=${sub.id}`);
    await this.analytics.recordBestEffort({
      eventName: 'subscription_changed',
      userId: sub.userId,
      platform: 'system',
      props: { subscriptionId: sub.id, action: 'order_failed', reason: reasonCode },
    });
  }

  private async lockSubscription(tx: Prisma.TransactionClient, id: string): Promise<LockedSubRow | null> {
    const rows = await tx.$queryRaw<LockedSubRow[]>`
      SELECT "id", "userId", "variationId", "quantity", "addressId", "status", "paymentMethod"::text AS "paymentMethod",
             "intervalWeeks", "nextRunAt", "lastOrderId", "retryCount"
      FROM "subscriptions" WHERE "id" = ${id} FOR UPDATE`;
    return rows[0] ?? null;
  }

  private assertIntervalWeeks(weeks: number): void {
    if (!(SUBSCRIPTION_INTERVAL_WEEKS as readonly number[]).includes(weeks)) {
      throw new BadRequestException('Chu kỳ chỉ nhận 4/6/8/10 tuần.');
    }
  }

  private assertQuantity(quantity: number): void {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_SUBSCRIPTION_QUANTITY) {
      throw new BadRequestException(`Số lượng không hợp lệ (1–${MAX_SUBSCRIPTION_QUANTITY}).`);
    }
  }

  private parsePaymentMethod(method: string | undefined): SubscriptionPaymentMethod {
    if (method === undefined) return 'COD';
    if ((SUBSCRIPTION_PAYMENT_METHODS as readonly string[]).includes(method)) return method as SubscriptionPaymentMethod;
    throw new BadRequestException('Gói định kỳ chỉ nhận thanh toán khi nhận hàng, Ví Tubu hoặc chuyển khoản.');
  }

  /**
   * null = giao ngay (bỏ trống hoặc chọn hôm nay). Ngày sau = kỳ đầu lúc 0h ngày đó giờ Việt Nam, để lượt
   * cron 3h sáng cùng ngày sinh đơn.
   */
  private parseStartDate(startDate: string | undefined): Date | null {
    if (startDate === undefined || startDate === '') return null;
    const invalid = () => new BadRequestException('Ngày bắt đầu giao không hợp lệ.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw invalid();
    const at = new Date(`${startDate}T00:00:00+07:00`);
    if (Number.isNaN(at.getTime()) || vnDateKey(at) !== startDate) throw invalid();
    const today = vnDateKey();
    if (startDate < today) throw new BadRequestException('Ngày bắt đầu giao đã qua, bạn chọn lại nhé.');
    if (startDate === today) return null;
    const last = vnDateKey(new Date(Date.now() + MAX_START_DAYS_AHEAD * 864e5));
    if (startDate > last) {
      throw new BadRequestException(`Chỉ chọn ngày bắt đầu giao trong vòng ${MAX_START_DAYS_AHEAD} ngày tới.`);
    }
    return at;
  }

  /** Ngày giao kỳ tới khách chọn (YYYY-MM-DD giờ VN) thành 0h VN ngày đó, để cron 3h sáng cùng ngày ra đơn. Từ ngày mai tới `RESCHEDULE_MAX_DAYS_AHEAD` ngày. */
  private parseExpectedNextRunAt(raw: string | undefined, required: boolean): Date | undefined {
    if (raw === undefined) {
      if (required) throw new BadRequestException(SCHEDULE_CHANGED_MESSAGE);
      return undefined;
    }
    const at = new Date(raw);
    if (Number.isNaN(at.getTime())) throw new BadRequestException(SCHEDULE_CHANGED_MESSAGE);
    return at;
  }

  private parseRescheduleDate(date: string): Date {
    const invalid = () => new BadRequestException('Ngày giao kỳ tới không hợp lệ.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw invalid();
    const at = new Date(`${date}T00:00:00+07:00`);
    if (Number.isNaN(at.getTime()) || vnDateKey(at) !== date) throw invalid();
    if (date <= vnDateKey()) throw new BadRequestException('Ngày giao kỳ tới phải từ ngày mai, muốn giao hôm nay thì chọn "Đặt kỳ này ngay".');
    if (date > vnDateKey(new Date(Date.now() + RESCHEDULE_MAX_DAYS_AHEAD * 864e5))) {
      throw new BadRequestException(`Chỉ dời ngày giao trong vòng ${RESCHEDULE_MAX_DAYS_AHEAD} ngày tới.`);
    }
    return at;
  }

  private async pendingPaymentTtlHours(): Promise<number> {
    const raw = await this.config.get<unknown>(PENDING_PAYMENT_TTL_KEY, DEFAULT_PENDING_PAYMENT_TTL_HOURS);
    const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_PENDING_PAYMENT_TTL_HOURS;
    return Math.min(MAX_TTL_HOURS, Math.max(MIN_TTL_HOURS, n));
  }

  private addWeeks(from: Date, weeks: number): Date {
    return new Date(from.getTime() + weeks * 7 * 864e5);
  }
}
