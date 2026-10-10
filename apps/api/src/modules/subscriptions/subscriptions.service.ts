import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomInt } from 'node:crypto';
import type { Order, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { PricingService } from '../pricing/pricing.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import { WalletLedgerService } from '../wallet/wallet-ledger.service';
import { reserveVariationStock } from '../catalog/variation-stock';
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

/** Phương thức trả cho gói định kỳ (Q-13). Cổng ZaloPay/VNPAY cần khách thao tác mỗi kỳ nên không nhận. */
export const SUBSCRIPTION_PAYMENT_METHODS = ['COD', 'WALLET', 'BANK_TRANSFER'] as const;
export type SubscriptionPaymentMethod = (typeof SUBSCRIPTION_PAYMENT_METHODS)[number];

/** Khách chỉ được hẹn ngày bắt đầu trong khoảng này (tính theo ngày giờ Việt Nam). */
export const MAX_START_DAYS_AHEAD = 60;

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
  addressId?: string;
  paymentMethod?: SubscriptionPaymentMethod;
}

/**
 * Đánh dấu riêng lỗi hết hàng khi tạo đơn định kỳ (khác BadRequestException chung) để
 * runCycle phân biệt được và báo user — hết hàng CÓ THỂ là tạm thời nên KHÔNG pause
 * lịch như nhánh isActive=false/địa chỉ hỏng, chỉ báo rồi để cron thử lại chu kỳ sau.
 */
class SubscriptionOutOfStockError extends Error {}
/** Địa chỉ của gói đã mất/không còn thuộc khách lúc sinh đơn kỳ. */
class SubscriptionAddressError extends Error {}
/** Ví Tubu không đủ trả đơn kỳ: không sinh đơn nợ, gói tạm dừng. */
class SubscriptionWalletShortError extends Error {}

const WALLET_SHORT_MESSAGE = 'Số dư Ví Tubu không đủ để thanh toán đơn định kỳ.';

/** Mã lỗi ổn định cho FE: đã có gói còn chạy cùng SP + địa chỉ (C-057, Q-13). */
export const SUBSCRIPTION_DUPLICATE = 'SUBSCRIPTION_DUPLICATE';

/** Trạng thái nằm trong partial unique index subscriptions_user_variation_address_open_key. */
const OPEN_STATUSES = ['ACTIVE', 'PAUSED'];

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
}

/** Đơn kỳ vừa ghi xong, kèm phần việc chạy sau commit (Pancake, thông báo). */
interface PlacedCycleOrder {
  order: Order;
  userId: string;
}

/**
 * Subscribe & Save (Build Spec §6.14.4): đặt định kỳ 4/6/8/10 tuần.
 * Chiết khấu theo THANG BẬC (subscribe.discount_tiers, kiểu Amazon): càng nhiều
 * subscription ACTIVE, % giảm càng cao (chọn bậc minActive cao nhất user đạt được),
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
    if (![4, 6, 8, 10].includes(dto.intervalWeeks)) {
      throw new BadRequestException('Chu kỳ chỉ nhận 4/6/8/10 tuần.');
    }
    const paymentMethod = this.parsePaymentMethod(dto.paymentMethod);
    const firstRunAt = this.parseStartDate(dto.startDate);
    const variation = await this.prisma.variation.findUnique({
      where: { id: dto.variationId },
      include: { product: { select: { name: true, isActive: true, approvalStatus: true } } },
    });
    if (!variation) throw new BadRequestException('Sản phẩm không khả dụng.');
    if (!isSellableVariation(variation)) throw productDiscontinuedError(variation.product.name);
    const address = await this.prisma.address.findUnique({ where: { id: dto.addressId } });
    if (!address || address.userId !== userId) throw new BadRequestException('Địa chỉ không hợp lệ.');

    const quantity = Math.max(1, dto.quantity);
    const key = { userId, variationId: dto.variationId, addressId: dto.addressId };
    const asRequested = { quantity, intervalWeeks: dto.intervalWeeks };
    // Giao ngay: gói + đơn đầu cùng một transaction — đơn đầu không đặt được (hết hàng, ví thiếu)
    // thì không để lại gói nào, khách thấy lỗi và chọn lại thay vì có gói "chạy" mà không có hàng.
    const startNow = firstRunAt === null;
    const code = startNow ? await this.generateCode() : null;
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
      if (err instanceof SubscriptionOutOfStockError) throw new BadRequestException(err.message);
      if (err instanceof SubscriptionWalletShortError) {
        throw new BadRequestException('Số dư Ví Tubu không đủ để thanh toán đơn đầu tiên, hãy nạp thêm hoặc chọn cách trả khác.');
      }
      if (err instanceof SubscriptionAddressError) throw new BadRequestException('Địa chỉ không hợp lệ.');
      throw err;
    }
  }

  /**
   * Đã có gói còn chạy cho cùng SP + địa chỉ (Q-13). Bấm đúp/retry gửi lại y hệt → trả lại gói đó
   * (idempotent, FE không phải xử lý gì). Khác số lượng/chu kỳ hoặc gói đang tạm dừng → 409 để khách
   * sửa/bật lại gói cũ thay vì âm thầm có 2 lịch giao cùng chỗ.
   */
  private resolveDuplicate(
    open: { id: string; status: string; quantity: number; intervalWeeks: number },
    req: { quantity: number; intervalWeeks: number },
    productName: string,
  ) {
    if (open.status === 'ACTIVE' && open.quantity === req.quantity && open.intervalWeeks === req.intervalWeeks) {
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
   * Sửa số lượng / địa chỉ / cách trả của gói đang chạy hoặc tạm dừng (Q-13). Khoá dòng gói như tx
   * sinh đơn kỳ: cron đang ghi đơn thì chờ, nên đơn kỳ luôn theo trọn bản cũ hoặc trọn bản mới.
   */
  async update(userId: string, id: string, dto: UpdateSubInput) {
    const paymentMethod = dto.paymentMethod === undefined ? undefined : this.parsePaymentMethod(dto.paymentMethod);
    if (dto.quantity !== undefined && (!Number.isInteger(dto.quantity) || dto.quantity < 1)) {
      throw new BadRequestException('Số lượng không hợp lệ.');
    }
    let productName = 'Sản phẩm';
    let variationId: string | null = null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const sub = await this.lockSubscription(tx, id);
        if (!sub || sub.userId !== userId) throw new NotFoundException('Không tìm thấy lịch đặt định kỳ.');
        if (!OPEN_STATUSES.includes(sub.status)) {
          throw new BadRequestException('Gói định kỳ đã huỷ, không sửa được nữa.');
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
        const updated = await tx.subscription
          .update({
            where: { id },
            data: {
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
            addressChanged: updated.addressId !== sub.addressId,
            paymentMethod: updated.paymentMethod,
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

  /** Mặc định 100 gói mới nhất (tối đa 200); cursor = id gói cuối của trang trước. */
  async list(userId: string, opts: { take?: number; cursor?: string } = {}) {
    const subs = await this.prisma.subscription.findMany({
      where: { userId, status: { not: 'CANCELLED' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(opts.take ?? 100, 1), 200),
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    if (subs.length === 0) return [];
    const [variations, effectiveDiscountPct] = await Promise.all([
      this.prisma.variation.findMany({
        where: { id: { in: subs.map((s) => s.variationId) } },
        include: { product: { select: { name: true, thumbnail: true, slug: true } } },
      }),
      this.effectiveDiscountPct(userId),
    ]);
    const vmap = new Map(variations.map((v) => [v.id, v]));
    return subs.map((s) => {
      const v = vmap.get(s.variationId);
      return {
        id: s.id,
        quantity: s.quantity,
        intervalWeeks: s.intervalWeeks,
        status: s.status,
        nextRunAt: s.nextRunAt,
        addressId: s.addressId,
        paymentMethod: s.paymentMethod ?? 'COD',
        lastOrderId: s.lastOrderId ?? null,
        productName: v?.product.name ?? 'Sản phẩm',
        variationName: v?.name ?? '',
        thumbnail: v?.product.thumbnail ?? null,
        slug: v?.product.slug ?? null,
        unitPrice: v ? (v.salePrice ?? v.retailPrice) : 0,
        effectiveDiscountPct,
      };
    });
  }

  /**
   * % giảm hiệu lực cho đơn Subscribe & Save của userId, theo THANG BẬC
   * subscribe.discount_tiers dựa trên số subscription đang ACTIVE — chọn bậc
   * minActive cao nhất mà user đạt được. Subscription đang tạo đơn (đang ACTIVE)
   * được TÍNH VÀO activeCount — user có 1 sub thì vẫn đạt bậc cơ bản.
   */
  async effectiveDiscountPct(userId: string, db: Pick<Prisma.TransactionClient, 'subscription'> = this.prisma): Promise<number> {
    const basePct = await this.config.get<number>('subscribe.discount_pct', 0.12);
    const tiers = await this.config.get<{ minActive: number; pct: number }[]>('subscribe.discount_tiers', [
      { minActive: 1, pct: basePct },
    ]);
    const activeCount = await db.subscription.count({ where: { userId, status: 'ACTIVE' } });
    const applicable = tiers.filter((t) => activeCount >= t.minActive).sort((a, b) => b.pct - a.pct);
    return applicable[0]?.pct ?? 0;
  }

  async setStatus(userId: string, id: string, status: 'ACTIVE' | 'PAUSED' | 'CANCELLED') {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub || sub.userId !== userId) throw new NotFoundException('Không tìm thấy lịch đặt định kỳ.');
    // Khi bật lại từ PAUSED, dời nextRunAt tới chu kỳ kế nếu đã quá hạn.
    const nextRunAt =
      status === 'ACTIVE' && sub.nextRunAt < new Date()
        ? this.addWeeks(new Date(), sub.intervalWeeks)
        : sub.nextRunAt;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.subscription.update({ where: { id }, data: { status, nextRunAt } });
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
   * Save-flow: bỏ qua 1 kỳ giao kế tiếp mà KHÔNG hủy/tạm dừng lịch — đẩy
   * nextRunAt thêm 1 chu kỳ tính từ nextRunAt hiện tại, giữ nguyên status ACTIVE.
   */
  async skipCycle(userId: string, id: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub || sub.userId !== userId) throw new NotFoundException('Không tìm thấy lịch đặt định kỳ.');
    if (sub.status !== 'ACTIVE') throw new BadRequestException('Chỉ bỏ qua kỳ khi lịch đang chạy.');
    const nextRunAt = this.addWeeks(sub.nextRunAt, sub.intervalWeeks);
    return this.prisma.subscription.update({ where: { id }, data: { nextRunAt } });
  }

  /**
   * Cron 3h sáng: xử lý các subscription đến hạn → tạo đơn kỳ + dời chu kỳ.
   *
   * Toàn thân bọc try/catch: @Cron không tự bắt lỗi — findMany/updateMany lỗi (DB blip...) ném ra
   * ngoài là unhandledRejection, Node 20 mặc định crash cả process. Lỗi tạo đơn từng subscription
   * đã được cô lập ở try/catch trong vòng lặp bên dưới.
   */
  @Cron('0 3 * * *', { timeZone: CRON_TZ })
  async processDue(): Promise<void> {
    try {
      const now = new Date();
      const due = await this.prisma.subscription.findMany({
        where: { status: 'ACTIVE', nextRunAt: { lte: now } },
        take: 200,
      });
      let created = 0;
      for (const sub of due) {
        // CLAIM atomic: advance nextRunAt TRƯỚC khi tạo đơn. Chỉ instance đầu tiên
        // (count=1) được xử lý → multi-instance cron không tạo đơn TRÙNG cho khách.
        const claimed = await this.prisma.subscription.updateMany({
          where: { id: sub.id, status: 'ACTIVE', nextRunAt: { lte: now } },
          data: { nextRunAt: this.addWeeks(now, sub.intervalWeeks) },
        });
        if (claimed.count === 0) continue; // instance khác đã claim
        try {
          if (await this.runCycle(sub, sub.nextRunAt)) created++;
        } catch (err) {
          // nextRunAt đã advance → bỏ qua chu kỳ này (không double-charge), chờ chu kỳ kế.
          this.logger.error(`Subscription ${sub.id} lỗi: ${err instanceof Error ? err.message : err}`);
        }
      }
      if (created) this.logger.log(`Subscription orders created: ${created}`);
    } catch (err) {
      this.logger.error(`processDue lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Một kỳ đã claim: ghi đơn rồi xử lý hậu quả từng loại lỗi. Trả true nếu có đơn mới. */
  private async runCycle(sub: { id: string; userId: string }, cycleAt: Date): Promise<boolean> {
    const code = await this.generateCode();
    let placed: PlacedCycleOrder | null;
    try {
      placed = await this.prisma.$transaction((tx) => this.placeCycleOrder(tx, sub.id, cycleAt, code));
    } catch (err) {
      if (isProductDiscontinuedError(err)) {
        await this.pauseSubscription(sub, 'Sản phẩm đã ngừng bán', 'inactive_product');
        return false;
      }
      if (err instanceof SubscriptionAddressError) {
        await this.pauseSubscription(sub, 'Địa chỉ giao hàng không còn hợp lệ', 'invalid_address');
        return false;
      }
      if (err instanceof SubscriptionWalletShortError) {
        await this.pauseSubscription(sub, 'Số dư Ví Tubu không đủ để thanh toán đơn kỳ này', 'insufficient_wallet');
        return false;
      }
      if (err instanceof SubscriptionOutOfStockError) {
        // Khác nhánh isActive/địa chỉ ở trên (pause hẳn): hết hàng báo cho khách biết kỳ này
        // không có đơn, KHÔNG pause lịch — cron sẽ tự thử lại ở chu kỳ kế (nextRunAt đã advance).
        await this.notifications
          .notify(sub.userId, 'SUBSCRIPTION_ORDER_FAILED', { reason: 'Hết hàng tạm thời' })
          .catch(() => undefined);
        await this.analytics.recordBestEffort({
          eventName: 'subscription_changed',
          userId: sub.userId,
          platform: 'system',
          props: { subscriptionId: sub.id, action: 'order_failed', reason: 'out_of_stock' },
        });
      }
      throw err; // giữ nguyên hành vi cũ: processDue() log lỗi + đếm là chu kỳ bị bỏ qua.
    }
    if (!placed) return false;
    await this.afterOrderPlaced(placed);
    return true;
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
  ): Promise<(PlacedCycleOrder & { nextRunAt: Date }) | null> {
    const sub = await this.lockSubscription(tx, subId);
    if (!sub || sub.status !== 'ACTIVE') return null;
    const variation = await tx.variation.findUnique({
      where: { id: sub.variationId },
      include: { product: { select: { name: true, slug: true, isActive: true, approvalStatus: true } } },
    });
    if (!variation || !isSellableVariation(variation)) throw productDiscontinuedError(variation?.product.name);
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
    const subtotal = unitPrice * sub.quantity;
    const discountPct = await this.effectiveDiscountPct(sub.userId, tx);
    const discount = Math.floor(subtotal * discountPct);
    const goods = Math.max(0, subtotal - discount);
    const shippingFee = await this.pricing.calcShippingFee({ subtotal, tierId: user.tierId });
    const multiplier = await this.loyalty.getTierMultiplier(user.tierId);
    const pointsEarned = await this.pricing.calcPointsEarned(goods, multiplier);
    const total = goods + shippingFee;
    const method = sub.paymentMethod;
    const paid = method === 'WALLET';

    // Trừ stock ATOMIC (mirror checkout.placeOrder/affiliate.processGroupOrder) TRONG cùng
    // transaction với tạo đơn — không đủ stock → throw, rollback; nextRunAt đã advance ở claim
    // nên không double-charge, chu kỳ sau sẽ thử lại.
    await assertVariationsSellable(tx, [{ variationId: variation.id, productName: variation.product.name }]);
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
      data: { lastOrderId: order.id },
      select: { nextRunAt: true, intervalWeeks: true },
    });
    // Đơn đầu giao ngay ghi trong tx tạo gói: kỳ kế tính từ hôm nay (cron thì đã dời ở bước claim).
    let nextRunAt = after.nextRunAt;
    if (nextRunAt.getTime() <= cycleAt.getTime()) {
      nextRunAt = this.addWeeks(cycleAt, after.intervalWeeks);
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
        .notify(userId, 'SUBSCRIPTION_ORDER_AWAITING_PAYMENT', {
          order_code: order.code,
          amount: order.total.toLocaleString('vi-VN'),
          hours: String(hours),
        })
        .catch(() => undefined);
      return;
    }
    await this.notifications.notify(userId, 'SUBSCRIPTION_ORDER', { order_code: order.code }).catch(() => undefined);
  }

  /** Không sinh đơn được vì lý do không tự hết (SP ngừng bán, địa chỉ hỏng, ví thiếu): tạm dừng + báo khách. */
  private async pauseSubscription(sub: { id: string; userId: string }, reason: string, reasonCode: string): Promise<void> {
    // Chỉ lật gói còn ACTIVE: khách vừa huỷ thì giữ CANCELLED.
    await this.prisma.subscription.updateMany({ where: { id: sub.id, status: 'ACTIVE' }, data: { status: 'PAUSED' } });
    await this.notifications.notify(sub.userId, 'SUBSCRIPTION_PAUSED', { reason }).catch(() => undefined);
    await this.analytics.recordBestEffort({
      eventName: 'subscription_changed',
      userId: sub.userId,
      platform: 'system',
      props: { subscriptionId: sub.id, action: 'order_failed', reason: reasonCode },
    });
  }

  private async lockSubscription(tx: Prisma.TransactionClient, id: string): Promise<LockedSubRow | null> {
    const rows = await tx.$queryRaw<LockedSubRow[]>`
      SELECT "id", "userId", "variationId", "quantity", "addressId", "status", "paymentMethod"::text AS "paymentMethod"
      FROM "subscriptions" WHERE "id" = ${id} FOR UPDATE`;
    return rows[0] ?? null;
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
    if (Number.isNaN(at.getTime()) || this.vnDateOf(at) !== startDate) throw invalid();
    const today = this.vnDateOf(new Date());
    if (startDate < today) throw new BadRequestException('Ngày bắt đầu giao đã qua, vui lòng chọn lại.');
    if (startDate === today) return null;
    const last = this.vnDateOf(new Date(Date.now() + MAX_START_DAYS_AHEAD * 864e5));
    if (startDate > last) {
      throw new BadRequestException(`Chỉ chọn ngày bắt đầu giao trong vòng ${MAX_START_DAYS_AHEAD} ngày tới.`);
    }
    return at;
  }

  /** YYYY-MM-DD theo giờ Việt Nam (UTC+7, không đổi giờ mùa hè). */
  private vnDateOf(d: Date): string {
    return new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
  }

  private async pendingPaymentTtlHours(): Promise<number> {
    const raw = await this.config.get<unknown>(PENDING_PAYMENT_TTL_KEY, DEFAULT_PENDING_PAYMENT_TTL_HOURS);
    const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_PENDING_PAYMENT_TTL_HOURS;
    return Math.min(MAX_TTL_HOURS, Math.max(MIN_TTL_HOURS, n));
  }

  private addWeeks(from: Date, weeks: number): Date {
    return new Date(from.getTime() + weeks * 7 * 864e5);
  }

  private async generateCode(): Promise<string> {
    for (let i = 0; i < 6; i++) {
      const code = `TUBUSUB${Date.now().toString().slice(-7)}${String(randomInt(0, 1000)).padStart(3, '0')}`;
      const exists = await this.prisma.order.findUnique({ where: { code } });
      if (!exists) return code;
    }
    return `TUBUSUB${Date.now()}`;
  }
}
