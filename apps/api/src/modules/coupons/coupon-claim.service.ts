import { BadRequestException, Injectable } from '@nestjs/common';
import type { Coupon, CouponType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isRealUser, REAL_USER_REQUIRED_MSG } from '../../common/real-user';
import { hasPriorOrder } from '../../common/first-order';
import { formatVnDate } from '../../common/vn-time';
import { isCouponEligible } from './coupon-scope';
import { NEW_CUSTOMER_ONLY_MSG, normalizeCouponCode } from './coupons.service';

/** Khoá theo mã khi đếm lượt nhận (cặp với hashtext(couponId)); khác dạng khoá (mã, khách) của CouponsService.redeem. */
const CLAIM_LOCK = 'coupon-claim';

export interface ClaimedCoupon {
  code: string;
  type: CouponType;
  value: number;
  minOrder: number | null;
  maxDiscount: number | null;
  endAt: Date;
  newCustomerOnly: boolean;
  /** Khách đã nhận mã này từ trước (quét lại thẻ): không ghi thêm gì. */
  alreadyClaimed: boolean;
}

function view(c: Coupon, alreadyClaimed: boolean): ClaimedCoupon {
  return {
    code: c.code,
    type: c.type,
    value: c.value,
    minOrder: c.minOrder,
    maxDiscount: c.maxDiscount,
    endAt: c.endAt,
    newCustomerOnly: c.newCustomerOnly,
    alreadyClaimed,
  };
}

/**
 * Nhận mã vào ví (D2-03): link `?claim=CODE` từ thẻ QR trong hộp hàng sàn, hoặc khách gõ mã thẻ ở giỏ. Mã CLAIM chỉ vào ví
 * (và chỉ áp được) sau khi có dòng coupon_claims của khách; mã scope khác đã nằm sẵn trong ví khách đủ điều kiện nên chỉ kiểm
 * điều kiện và trả thông tin để báo cho khách. Lượt dùng vẫn kiểm ở CouponsService khi áp mã và khi đặt đơn.
 */
@Injectable()
export class CouponClaimService {
  constructor(private readonly prisma: PrismaService) {}

  async claim(userId: string, rawCode: string): Promise<ClaimedCoupon> {
    const code = normalizeCouponCode(rawCode);
    const coupon = await this.prisma.coupon.findUnique({ where: { code } });
    if (!coupon) throw new BadRequestException('Mã giảm giá không tồn tại. Vui lòng kiểm tra lại mã trên thẻ.');
    if (!coupon.isActive) throw new BadRequestException('Mã giảm giá đã ngừng áp dụng.');
    const now = new Date();
    if (now > coupon.endAt) throw new BadRequestException('Mã giảm giá đã hết hạn.');
    if (now < coupon.startAt) throw new BadRequestException(`Mã giảm giá áp dụng từ ngày ${formatVnDate(coupon.startAt)}.`);

    // Mọi lần nhận đòi tài khoản thật: mã thẻ riêng chỉ có một lượt nhận, tài khoản khách (deviceId mới) không được giữ chỗ.
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, tierId: true, phone: true, zaloId: true } });
    if (!user || !isRealUser(user)) throw new BadRequestException(REAL_USER_REQUIRED_MSG);
    // Khách cũ không giữ chỗ của thẻ "chỉ khách mới": thẻ đó còn để khách mới khác nhận.
    if (coupon.newCustomerOnly && (await hasPriorOrder(this.prisma, userId))) throw new BadRequestException(NEW_CUSTOMER_ONLY_MSG);

    if (coupon.scope !== 'CLAIM') {
      if (!isCouponEligible(coupon, user)) throw new BadRequestException('Mã không áp dụng cho tài khoản này.');
      await this.assertNotUsedUp(coupon, userId);
      return view(coupon, false);
    }

    const mine = await this.prisma.couponClaim.findUnique({
      where: { couponId_userId: { couponId: coupon.id, userId } },
      select: { id: true },
    });
    if (mine) {
      await this.assertNotUsedUp(coupon, userId);
      return view(coupon, true);
    }

    const alreadyClaimed = await this.prisma.$transaction(async (tx) => {
      if (coupon.usageLimit != null) {
        // Đếm rồi ghi dưới khoá theo mã: nhiều khách quét cùng một mã chung hết lượt (hoặc chuyền tay một thẻ riêng) không
        // nhận vượt tổng lượt. Lần nhận song song của CHÍNH khách này đi sau sẽ thấy dòng của lần trước ở bước đọc dưới.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${CLAIM_LOCK}), hashtext(${coupon.id}))`;
        const again = await tx.couponClaim.findUnique({
          where: { couponId_userId: { couponId: coupon.id, userId } },
          select: { id: true },
        });
        if (again) return true;
        const taken = await tx.couponClaim.count({ where: { couponId: coupon.id } });
        if (taken >= coupon.usageLimit) {
          throw new BadRequestException(
            coupon.usageLimit === 1 ? 'Mã giảm giá này đã được tài khoản khác nhận.' : 'Mã giảm giá đã hết lượt nhận.',
          );
        }
      }
      // Không tổng lượt thì không khoá: unique (couponId, userId) + ON CONFLICT DO NOTHING giữ một dòng mỗi khách.
      const inserted = await tx.couponClaim.createMany({ data: [{ couponId: coupon.id, userId }], skipDuplicates: true });
      return inserted.count === 0;
    });
    return view(coupon, alreadyClaimed);
  }

  /**
   * Khách gõ mã thẻ ở giỏ thay vì quét QR: mã CLAIM chưa nhận thì nhận luôn (lỗi nhận báo đúng lý do), để mã in trên thẻ dùng
   * được như mọi mã khác. Mã khác hoặc mã không tồn tại thì để CouponsService báo lỗi như cũ.
   */
  async claimHiddenForCart(userId: string, rawCode: string): Promise<void> {
    const code = normalizeCouponCode(rawCode);
    const coupon = await this.prisma.coupon.findUnique({ where: { code } });
    if (coupon?.scope !== 'CLAIM') return;
    const mine = await this.prisma.couponClaim.findUnique({
      where: { couponId_userId: { couponId: coupon.id, userId } },
      select: { id: true },
    });
    if (mine) return;
    await this.claim(userId, code);
  }

  private async assertNotUsedUp(coupon: Coupon, userId: string): Promise<void> {
    if (coupon.perUserLimit <= 0) return;
    const used = await this.prisma.couponRedemption.count({ where: { couponId: coupon.id, userId } });
    if (used >= coupon.perUserLimit) throw new BadRequestException('Bạn đã dùng mã giảm giá này rồi.');
  }
}
