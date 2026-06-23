import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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
    if (usedByUser >= coupon.perUserLimit) {
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
        discount = Math.floor((subtotal * coupon.value) / 100);
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
   * Đảm bảo user được phép dùng coupon theo scope.
   * - PUBLIC: cho phép.
   * - USER_GROUP: chỉ user trong scopeMeta.userId.
   * - TIER: bắt buộc meta.tierId tồn tại VÀ khớp user.tierId (chặn case
   *   meta.tierId=undefined+user.tierId=null → undefined===undefined → bypass).
   * - BIRTHDAY / INVITE / khác: default DENY tới khi có logic chính thức,
   *   tránh user khác redeem voucher cá nhân do scope chưa được implement check.
   * Nhận `db` (PrismaClient hoặc TransactionClient) để query user trong cùng tx
   * khi được gọi từ redeem(tx) — đọc tier nhất quán với phần còn lại của tx.
   */
  private async assertScopeOwnership(
    coupon: { scope?: string | null; scopeMeta?: unknown },
    userId: string,
    db: Prisma.TransactionClient | PrismaService,
  ): Promise<void> {
    if (coupon.scope === 'PUBLIC' || coupon.scope == null) return;
    if (coupon.scope === 'USER_GROUP') {
      const meta = (coupon.scopeMeta ?? {}) as { userId?: string };
      if (!meta.userId || meta.userId !== userId) {
        throw new BadRequestException('Mã không áp dụng cho tài khoản này.');
      }
      return;
    }
    if (coupon.scope === 'TIER') {
      const meta = (coupon.scopeMeta ?? {}) as { tierId?: string };
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { tierId: true },
      });
      // meta.tierId BẮT BUỘC tồn tại — nếu admin quên set, KHÔNG để user chưa hạng
      // (tierId=null) lọt qua vì undefined===null là false nhưng undefined===undefined là true.
      if (!user || !meta.tierId || meta.tierId !== user.tierId) {
        throw new BadRequestException('Mã chỉ áp dụng cho hạng thành viên khác.');
      }
      return;
    }
    // BIRTHDAY/INVITE và scope chưa biết: từ chối để tránh leak voucher cá nhân
    // do logic check chưa được implement (xem schema CouponScope enum).
    throw new BadRequestException('Mã không áp dụng cho tài khoản này.');
  }
}
