import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isCouponEligible } from './coupon-scope';

export interface CouponResult {
  code: string;
  discount: number;
  freeship: boolean;
}

/**
 * Validate coupon + tính mức giảm (Build Spec §6.3, §6.6).
 * Phase 1: scope PUBLIC. TIER/BIRTHDAY/INVITE mở rộng ở Phase 2.
 */
@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  async validateAndCompute(code: string, userId: string, subtotal: number): Promise<CouponResult> {
    const coupon = await this.prisma.coupon.findUnique({ where: { code } });
    if (!coupon) throw new BadRequestException('Mã giảm giá không tồn tại.');

    await this.assertScopeOwnership(coupon, userId, this.prisma);

    const now = new Date();
    if (now < coupon.startAt || now > coupon.endAt) {
      throw new BadRequestException('Mã giảm giá đã hết hạn hoặc chưa hiệu lực.');
    }
    if (coupon.minOrder && subtotal < coupon.minOrder) {
      throw new BadRequestException(
        `Đơn tối thiểu ${coupon.minOrder.toLocaleString('vi-VN')}đ để dùng mã này.`,
      );
    }

    const usedByUser = await this.prisma.couponRedemption.count({
      where: { couponId: coupon.id, userId },
    });
    // perUserLimit <= 0 = không giới hạn (nhất quán với guard trong redeem() bên dưới).
    // Trước đây thiếu guard này → coupon perUserLimit=0 bị validateAndCompute từ chối
    // NGAY LẦN ĐẦU (0 >= 0), dù redeem() coi 0 là "không giới hạn" → không ai dùng được mã.
    if (coupon.perUserLimit > 0 && usedByUser >= coupon.perUserLimit) {
      throw new BadRequestException('Bạn đã dùng hết lượt cho mã này.');
    }
    if (coupon.usageLimit != null) {
      // Chỉ check pre-flight để UX tốt; kiểm cuối ATOMIC ở redeem() (updateMany guard usedCount<usageLimit).
      const totalUsed = await this.prisma.couponRedemption.count({ where: { couponId: coupon.id } });
      if (totalUsed >= coupon.usageLimit) {
        throw new BadRequestException('Mã giảm giá đã hết lượt sử dụng.');
      }
    }

    let discount = 0;
    let freeship = false;
    switch (coupon.type) {
      case 'PERCENT':
        // value có thể >100 nếu admin nhập sai và không set maxDiscount (DTO chỉ @Min(0), không
        // @Max) — clamp về subtotal như nhánh AMOUNT bên dưới để discount không bao giờ vượt
        // giá trị đơn hàng, bất kể caller nào gọi hàm này (cart preview, checkout...).
        discount = Math.min(Math.floor((subtotal * coupon.value) / 100), subtotal);
        if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
        break;
      case 'AMOUNT':
        discount = Math.min(coupon.value, subtotal);
        break;
      case 'FREESHIP':
        freeship = true;
        break;
    }
    return { code: coupon.code, discount, freeship };
  }

  /**
   * Ghi nhận đã dùng (gọi sau khi đặt đơn thành công).
   * B4: nhận tx? để chạy ATOMIC cùng transaction đặt đơn — chống race usageLimit.
   *  - updateMany với guard `usedCount < usageLimit` → bộ đếm atomic, count=0 nghĩa là hết lượt.
   *  - bắt P2002 (couponId+orderId trùng) → coi như đã redeem (idempotent cho retry).
   */
  async redeem(
    code: string,
    userId: string,
    orderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const coupon = await db.coupon.findUnique({ where: { code } });
    if (!coupon) return;
    await this.assertScopeOwnership(coupon, userId, db);

    if (coupon.usageLimit != null) {
      const hit = await db.coupon.updateMany({
        where: { id: coupon.id, usedCount: { lt: coupon.usageLimit } },
        data: { usedCount: { increment: 1 } },
      });
      if (hit.count === 0) {
        throw new BadRequestException('Mã giảm giá đã hết lượt sử dụng.');
      }
    }

    // perUserLimit race: validateAndCompute() check pre-flight nhưng KHÔNG atomic.
    // 2 checkout song song cùng user → cùng đọc usedByUser < limit → cùng tạo
    // CouponRedemption với orderId khác → UNIQUE(couponId,orderId) KHÔNG chặn.
    // Re-check trong tx để thu hẹp window (vẫn còn race nếu cùng 1 tx isolation = READ COMMITTED,
    // nhưng đáng kể nhỏ hơn). Long-term: cần counter atomic per (couponId, userId).
    if (coupon.perUserLimit != null && coupon.perUserLimit > 0) {
      const usedByUser = await db.couponRedemption.count({
        where: { couponId: coupon.id, userId },
      });
      if (usedByUser >= coupon.perUserLimit) {
        throw new BadRequestException('Bạn đã dùng hết lượt cho mã này.');
      }
    }

    try {
      await db.couponRedemption.create({
        data: { couponId: coupon.id, userId, orderId },
      });
    } catch (err) {
      // P2002 = unique (couponId, orderId): retry/double-submit cùng đơn → no-op.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return;
      }
      throw err;
    }
  }

  /**
   * Đảm bảo user được phép dùng coupon theo scope (chặn validate/redeem nếu không).
   * Quy tắc eligible nằm ở isCouponEligible (coupon-scope.ts) — dùng CHUNG với
   * LoyaltyService.getAvailableCoupons để list & apply không lệch nhau.
   * Nhận `db` (PrismaClient hoặc TransactionClient) để query user trong cùng tx
   * khi được gọi từ redeem(tx) — đọc tier nhất quán với phần còn lại của tx.
   */
  private async assertScopeOwnership(
    coupon: { scope?: string | null; scopeMeta?: unknown },
    userId: string,
    db: Prisma.TransactionClient | PrismaService,
  ): Promise<void> {
    // Chỉ TIER cần tierId — lazy-load trong cùng db/tx để đọc hạng nhất quán với
    // phần còn lại của tx (PUBLIC/USER_GROUP không tốn query thừa).
    let tierId: string | null | undefined;
    if (coupon.scope === 'TIER') {
      const user = await db.user.findUnique({ where: { id: userId }, select: { tierId: true } });
      tierId = user?.tierId;
    }
    // Quyết định eligible dùng CHUNG isCouponEligible với LoyaltyService.getAvailableCoupons
    // (list) → list & apply không lệch. Message giữ riêng theo scope cho rõ với user.
    if (isCouponEligible(coupon, { id: userId, tierId })) return;
    throw new BadRequestException(
      coupon.scope === 'TIER'
        ? 'Mã chỉ áp dụng cho hạng thành viên khác.'
        : 'Mã không áp dụng cho tài khoản này.',
    );
  }
}
