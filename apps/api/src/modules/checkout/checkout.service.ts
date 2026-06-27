import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { CouponsService } from '../coupons/coupons.service';
import { PricingService } from '../pricing/pricing.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { CoinsService } from '../wallet/coins.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { ComboService } from '../storefront/combo.service';
import { PlaceOrderDto, QuoteDto } from './dto/checkout.dto';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly coupons: CouponsService,
    private readonly pricing: PricingService,
    private readonly loyalty: LoyaltyService,
    private readonly notifications: NotificationsService,
    private readonly pancakeOrder: PancakeOrderService,
    private readonly affiliate: AffiliateService,
    private readonly coins: CoinsService,
    private readonly config: SystemConfigService,
    private readonly combo: ComboService,
  ) {}

  /** Map mã giới thiệu → userId CTV (khác người mua). */
  private async resolveReferrer(referralCode: string | undefined, buyerId: string): Promise<string | null> {
    if (!referralCode) return null;
    const ref = await this.prisma.user.findUnique({ where: { referralCode } });
    if (!ref || ref.id === buyerId) return null;
    return ref.id;
  }

  /** Tính tạm đơn (ship + giảm + điểm) cho màn checkout. */
  async quote(userId: string, dto: QuoteDto) {
    const { cart, user, computed } = await this.compute(userId, dto.addressId, dto.pointsToUse, dto.storefrontSlug);
    return {
      subtotal: cart.subtotal,
      discount: computed.discount,
      comboDiscount: computed.comboDiscount,
      pointsUsed: computed.pointsUsed,
      pointsDiscount: computed.pointsDiscount,
      shippingFee: computed.shippingFee,
      total: computed.total,
      pointsEarned: computed.pointsEarned,
      pointsBalance: user.pointsBalance,
      items: cart.items,
    };
  }

  async placeOrder(userId: string, dto: PlaceOrderDto, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await this.prisma.order.findUnique({ where: { idempotencyKey } });
      if (existing) return this.findOrderResponse(existing.id);
    }

    // Attribution: ưu tiên referralCode/slug của phiên hiện tại; nếu phiên mất nhưng còn
    // "chạm" giới thiệu trong hạn (3 ngày) → fallback. Resolve TRƯỚC compute() để combo +
    // storefrontSlug dùng đúng slug hiệu lực.
    let referrerUserId = await this.resolveReferrer(dto.referralCode, userId);
    let storefrontSlug = dto.storefrontSlug ?? null;
    if (!referrerUserId || !storefrontSlug) {
      const touch = await this.affiliate.getActiveTouch(userId);
      if (touch) {
        if (!referrerUserId) referrerUserId = touch.referrerUserId;
        // chỉ lấy slug từ touch kind=ctv (brand không gắn storefrontSlug — tránh ô nhiễm analytics)
        if (!storefrontSlug && touch.kind === 'ctv') storefrontSlug = touch.storefrontSlug;
      }
    }

    const { cart, user, address, computed } = await this.compute(
      userId,
      dto.addressId,
      dto.pointsToUse,
      storefrontSlug ?? undefined,
    );
    if (cart.items.length === 0) throw new BadRequestException('Giỏ hàng trống.');

    if (dto.paymentMethod === 'WALLET' && user.walletBalance < computed.total) {
      throw new BadRequestException('Số dư Ví Tubu không đủ.');
    }
    if (dto.paymentMethod === 'XU' && user.coinsBalance < computed.total) {
      throw new BadRequestException('Số dư TubuXu không đủ.');
    }
    const codMax = 5_000_000;
    if (dto.paymentMethod === 'COD' && computed.total > codMax) {
      throw new BadRequestException('Đơn vượt hạn mức COD, vui lòng chọn phương thức khác.');
    }

    // WALLET và XU đều thanh toán ngay (đơn CONFIRMED + PAID); 1 xu = 1đ.
    const paid = dto.paymentMethod === 'WALLET' || dto.paymentMethod === 'XU';
    const status = dto.paymentMethod === 'COD' || paid ? 'CONFIRMED' : 'PENDING_PAYMENT';
    // Đơn trả bằng TubuXu KHÔNG sinh điểm Xanh mới (mặc định): xu là tín dụng tiêu-trong-app
    // (đã thưởng ×1.2 khi đổi từ Ví) — cộng thêm điểm trên đơn tự-fund = vòng khuếch đại giá trị.
    // Lật bằng config loyalty.earn_points_on_xu=true nếu muốn xu cũng tích điểm.
    // So sánh === true: config là cột Json, giá trị lỗi kiểu chuỗi "false"/"0" vẫn truthy →
    // chỉ đúng boolean true mới cho đơn XU tích điểm (mặc định/khác → không tích).
    const earnPointsOnXu = (await this.config.get<boolean>('loyalty.earn_points_on_xu', false)) === true;
    const pointsEarned =
      dto.paymentMethod === 'XU' && !earnPointsOnXu ? 0 : computed.pointsEarned;
    const code = await this.generateCode();

    let order: Awaited<ReturnType<typeof this.prisma.order.create>>;
    try {
      order = await this.prisma.$transaction(async (tx) => {
        // Trừ stock ATOMIC từng line (gte) — chống oversell khi flash-sale/hàng giới hạn:
        // 2 đơn cùng grab variation cuối → chỉ 1 thắng updateMany; thua thì throw rollback.
        // Đặt TRƯỚC order.create để fail-fast, không tốn resource ghi Order/Item rồi rollback.
        for (const line of cart.items) {
          const stockHit = await tx.variation.updateMany({
            where: { id: line.variationId, stock: { gte: line.quantity } },
            data: { stock: { decrement: line.quantity } },
          });
          if (stockHit.count === 0) {
            throw new BadRequestException(`Sản phẩm "${line.productName}" không đủ tồn kho.`);
          }
        }
        const created = await tx.order.create({
          data: {
            code,
            idempotencyKey: idempotencyKey ?? null,
            userId,
            type: 'RETAIL',
            status,
            subtotal: cart.subtotal,
            discount: computed.discount + computed.comboDiscount + computed.pointsDiscount,
            shippingFee: computed.shippingFee,
            total: computed.total,
            pointsEarned,
            pointsUsed: computed.pointsUsed,
            paymentMethod: dto.paymentMethod,
            paymentStatus: paid ? 'PAID' : 'UNPAID',
            shippingAddress: this.addressSnapshot(address),
            referrerUserId,
            storefrontSlug,
            couponCode: cart.couponCode,
            invoiceRequest: dto.invoiceRequest ? (dto.invoiceRequest as object) : undefined,
            invoiceStatus: dto.invoiceRequest ? 'REQUESTED' : 'NOT_REQUESTED',
            note: dto.note,
            items: {
              // Combo: trừ phần giảm phân bổ vào total từng dòng → hoa hồng (đọc OrderItem.total)
              // tính trên giá thực trả sau giảm combo (§7.2).
              create: cart.items.map((l) => ({
                variationId: l.variationId,
                productName: l.productName,
                variationName: l.variationName,
                unitPrice: l.unitPrice,
                quantity: l.quantity,
                total: l.total - (computed.comboPerLine[l.variationId] ?? 0),
              })),
            },
          },
        });

        if (computed.pointsUsed > 0) {
          // Trừ điểm ATOMIC (gte) — chống TOCTOU khi đặt nhiều đơn đồng thời tiêu cùng điểm.
          const dec = await tx.user.updateMany({
            where: { id: userId, pointsBalance: { gte: computed.pointsUsed } },
            data: { pointsBalance: { decrement: computed.pointsUsed } },
          });
          if (dec.count === 0) throw new BadRequestException('Số điểm Xanh không đủ.');
          await tx.pointsTransaction.create({
            data: {
              userId,
              delta: -computed.pointsUsed,
              reason: `ORDER_REDEEM:${code}`,
              refType: 'ORDER',
              refId: created.id,
            },
          });
        }
        if (dto.paymentMethod === 'WALLET') {
          // Trừ ví ATOMIC (gte) — chống overdraft khi 2 đơn WALLET chạy đồng thời.
          const dec = await tx.user.updateMany({
            where: { id: userId, walletBalance: { gte: computed.total } },
            data: { walletBalance: { decrement: computed.total } },
          });
          if (dec.count === 0) throw new BadRequestException('Số dư Ví Tubu không đủ.');
        } else if (dto.paymentMethod === 'XU') {
          // Trả đơn bằng TubuXu (1 xu = 1đ): trừ xu ATOMIC trong CÙNG tx — không đủ → throw
          // rollback toàn bộ đơn/stock/điểm. Ghi CoinTransaction(-total, ORDER_PAY:<code>).
          await this.coins.spendCoins(userId, computed.total, `ORDER_PAY:${code}`, 'ORDER', created.id, tx);
        }
        // B4: redeem coupon ATOMIC trong cùng tx — chống race usageLimit/perUserLimit khi 2 đơn
        // đồng thời cùng dùng 1 mã (đặc biệt voucher giới thiệu usageLimit=1). Nếu hết lượt
        // sẽ throw → rollback toàn bộ order/stock/ví/điểm, đảm bảo không bị "đặt nửa".
        if (cart.couponCode) {
          await this.coupons.redeem(cart.couponCode, userId, created.id, tx);
        }
        return created;
      });
    } catch (err) {
      // Race idempotency: 2 request cùng Idempotency-Key chạy đồng thời — request thua
      // cuộc ăn unique-violation (P2002). Trả lại đơn mà request thắng đã tạo.
      if (idempotencyKey && this.isUniqueViolation(err)) {
        const existing = await this.prisma.order.findUnique({ where: { idempotencyKey } });
        if (existing) return this.findOrderResponse(existing.id);
      }
      throw err;
    }

    // Dọn giỏ + đẩy Pancake (ngoài transaction chính). Coupon redeem đã chạy trong tx ở trên.
    await this.cart.clear(userId);
    try {
      await this.pancakeOrder.pushOrder(order.id);
    } catch (err) {
      this.logger.error(`Đẩy Pancake lỗi cho đơn ${code}: ${err instanceof Error ? err.message : err}`);
    }
    if (referrerUserId) {
      await this.affiliate.createCommissionForOrder(order.id).catch((err) =>
        this.logger.error(`Tạo commission lỗi cho đơn ${code}: ${err instanceof Error ? err.message : err}`),
      );
    }
    // Thông báo là side-effect — lỗi gửi không được làm hỏng đơn đã đặt (nhất quán với Pancake/affiliate).
    try {
      await this.notifications.notify(userId, 'ORDER_CONFIRMED', { order_code: code });
    } catch (err) {
      this.logger.error(`Gửi thông báo lỗi cho đơn ${code}: ${err instanceof Error ? err.message : err}`);
    }

    return this.findOrderResponse(order.id);
  }

  // ── Helpers ────────────────────────────────────────
  /** Lỗi vi phạm ràng buộc unique của Prisma (P2002). */
  private isUniqueViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
  }

  private async compute(userId: string, addressId: string, pointsToUse?: number, storefrontSlug?: string) {
    const cart = await this.cart.getCart(userId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const address = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!address || address.userId !== userId) {
      throw new BadRequestException('Địa chỉ giao hàng không hợp lệ.');
    }

    // Thứ tự áp giảm TUẦN TỰ (mỗi mức trên phần còn lại) để KHÔNG giảm chồng và KHÔNG vượt
    // giá trị hàng (giữ invariant subtotal - tổng-giảm = goods):
    //   1) Combo (shop tài trợ) — phân bổ vào từng dòng → cũng ghi vào OrderItem.total (§7.2, hoa hồng trên giá thực trả).
    //   2) Coupon (Tubu tài trợ) — tính lại trên base SAU combo (đơn không-combo: base = subtotal → y hệt cũ).
    //   3) Điểm Xanh — trên phần còn lại sau coupon.
    const combo = await this.combo.computeForStorefront(
      storefrontSlug,
      cart.items.map((l) => ({ variationId: l.variationId, productId: l.productId, total: l.total })),
    );
    const goodsAfterCombo = Math.max(0, cart.subtotal - combo.total);

    let discount = 0; // coupon (sau combo)
    let freeship = false;
    if (cart.couponCode) {
      try {
        const r = await this.coupons.validateAndCompute(cart.couponCode, userId, goodsAfterCombo);
        discount = Math.min(r.discount, goodsAfterCombo);
        freeship = r.freeship;
      } catch {
        // Coupon không còn hợp lệ trên base sau-combo (vd combo kéo xuống dưới minOrder):
        // GIỮ theo giá trị cart đã validate trên gross nhưng kẹp vào phần còn lại — tránh lệch
        // với bước redeem (placeOrder vẫn redeem theo cart.couponCode) và tránh giảm âm.
        discount = Math.min(cart.discount, goodsAfterCombo);
        freeship = cart.freeship;
      }
    }
    const goodsAfterCoupon = Math.max(0, goodsAfterCombo - discount);

    const redemption = await this.pricing.resolvePointsRedemption(
      pointsToUse ?? 0,
      user.pointsBalance,
      goodsAfterCoupon,
    );
    const goodsAfterAll = Math.max(0, goodsAfterCoupon - redemption.discount);

    let shippingFee = await this.pricing.calcShippingFee({
      subtotal: cart.subtotal,
      tierId: user.tierId,
    });
    if (freeship) shippingFee = 0;

    const multiplier = await this.loyalty.getTierMultiplier(user.tierId);
    const pointsEarned = await this.pricing.calcPointsEarned(goodsAfterAll, multiplier);

    const total = goodsAfterAll + shippingFee;
    return {
      cart,
      user,
      address,
      computed: {
        discount,
        comboDiscount: combo.total,
        comboPerLine: combo.perLine,
        pointsUsed: redemption.pointsUsed,
        pointsDiscount: redemption.discount,
        shippingFee,
        total,
        pointsEarned,
      },
    };
  }

  private async generateCode(): Promise<string> {
    for (let i = 0; i < 6; i++) {
      const d = new Date();
      const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
        d.getUTCDate(),
      ).padStart(2, '0')}`;
      const code = `TUBU${ymd}${String(randomInt(0, 100000)).padStart(5, '0')}`;
      const exists = await this.prisma.order.findUnique({ where: { code } });
      if (!exists) return code;
    }
    return `TUBU${Date.now()}`;
  }

  private addressSnapshot(a: {
    recipient: string;
    phone: string;
    province: string;
    district: string;
    ward: string;
    street: string;
    provinceCode: string;
    districtCode: string;
    wardCode: string;
  }): Prisma.InputJsonValue {
    return {
      recipient: a.recipient,
      phone: a.phone,
      province: a.province,
      district: a.district,
      ward: a.ward,
      street: a.street,
      provinceCode: a.provinceCode,
      districtCode: a.districtCode,
      wardCode: a.wardCode,
    };
  }

  private async findOrderResponse(orderId: string) {
    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
  }
}
