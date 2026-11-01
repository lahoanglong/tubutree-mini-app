import { Injectable } from '@nestjs/common';
import type { CouponType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Trần số mã hiện ở kho: mã listed do admin bật tay, vài chục là nhiều; trần chỉ để chặn dữ liệu bất thường. */
export const COLLECTABLE_LIMIT = 50;

/** Một mã ở kho "Nhận mã" công khai. Không có id nội bộ, phạm vi hay người tạo: chỉ thứ khách cần để vẽ thẻ và bấm Lưu. */
export interface CollectableCoupon {
  code: string;
  title: string | null;
  type: CouponType;
  value: number;
  minOrder: number | null;
  maxDiscount: number | null;
  startAt: Date;
  endAt: Date;
  newCustomerOnly: boolean;
  claimedCount: number;
  /** null = không giới hạn lượt nhận. */
  usageLimit: number | null;
}

/**
 * Kho mã công khai (P14): mã `listed` còn hạn, còn lượt nhận. Không có trạng thái riêng của khách (đã nhận chưa): route có cache dùng chung,
 * client ghép từ `/me/coupons`. Nhận mã vẫn qua `POST /coupons/claim` (khoá và trần lượt ở CouponClaimService), nên số "đã nhận" ở đây
 * cũ vài giây là chấp nhận được: lượt thật kiểm lúc nhận.
 */
@Injectable()
export class CouponCollectService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cửa sổ hiệu lực so theo THỜI ĐIỂM `now`, không cắt ngày theo múi giờ máy chủ: mã hạn 23:59:59 giờ Việt Nam (16:59:59Z) còn nhận được
   * tới đúng giây đó. Điều kiện `scope CLAIM` + `batch null` lặp lại luật chặn lúc bật `listed` (assertListable, CHECK ở DB) để một dòng
   * lọt qua đường khác vẫn không lộ ra mã thẻ in.
   */
  async collectable(now: Date = new Date()): Promise<CollectableCoupon[]> {
    const rows = await this.prisma.coupon.findMany({
      where: { listed: true, isActive: true, scope: 'CLAIM', batch: null, startAt: { lte: now }, endAt: { gte: now } },
      orderBy: [{ endAt: 'asc' }, { id: 'asc' }],
      take: COLLECTABLE_LIMIT,
    });
    if (rows.length === 0) return [];
    const grouped = await this.prisma.couponClaim.groupBy({
      by: ['couponId'],
      where: { couponId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    });
    const claimed = new Map(grouped.map((g) => [g.couponId, g._count._all]));
    return rows.flatMap((r) => {
      const claimedCount = claimed.get(r.id) ?? 0;
      if (r.usageLimit != null && claimedCount >= r.usageLimit) return [];
      return [
        {
          code: r.code,
          title: r.title,
          type: r.type,
          value: r.value,
          minOrder: r.minOrder,
          maxDiscount: r.maxDiscount,
          startAt: r.startAt,
          endAt: r.endAt,
          newCustomerOnly: r.newCustomerOnly,
          claimedCount,
          usageLimit: r.usageLimit,
        },
      ];
    });
  }
}
