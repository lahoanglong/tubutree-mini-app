import { BadRequestException, Injectable } from '@nestjs/common';
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

  /** Ghi nhận đã dùng (gọi sau khi đặt đơn thành công). */
  async redeem(code: string, userId: string, orderId: string): Promise<void> {
    const coupon = await this.prisma.coupon.findUnique({ where: { code } });
    if (!coupon) return;
    await this.prisma.couponRedemption.create({
      data: { couponId: coupon.id, userId, orderId },
    });
  }
}
