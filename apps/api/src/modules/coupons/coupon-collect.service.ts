import { Injectable } from '@nestjs/common';
import type { CouponType } from '@prisma/client';
import { hasPriorOrder } from '../../common/first-order';
import { PrismaService } from '../../prisma/prisma.service';

/** Trần số mã hiện ở kho: mã listed do admin bật tay, vài chục là nhiều; trần chỉ để chặn dữ liệu bất thường. */
export const COLLECTABLE_LIMIT = 50;

/**
 * Cửa sổ hiệu lực so theo THỜI ĐIỂM `now`, không cắt ngày theo múi giờ máy chủ: mã hạn 23:59:59 giờ Việt Nam (16:59:59Z) còn nhận được
 * tới đúng giây đó. Điều kiện `scope CLAIM` + `batch null` lặp lại luật chặn lúc bật `listed` (assertListable, CHECK ở DB) để một dòng
 * lọt qua đường khác vẫn không lộ ra mã thẻ in. Dùng chung cho kho công khai và phần riêng của khách để hai bên luôn nói về cùng một tập mã.
 */
function listedWindow(now: Date) {
  return {
    where: { listed: true, isActive: true, scope: 'CLAIM' as const, batch: null, startAt: { lte: now }, endAt: { gte: now } },
    orderBy: [{ endAt: 'asc' as const }, { id: 'asc' as const }],
  };
}

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
 * Phần riêng của khách trên kho mã. Route kho (`collectable`) có cache dùng chung nên không mang được phần này; ví `/me/coupons` thì ẩn mã
 * khách đã dùng hết lượt và mã chỉ-khách-mới của khách cũ, nên chỉ nhìn ví không phân biệt được "chưa nhận" với "nhận rồi mà không còn dùng được".
 */
export interface CollectableMine {
  /** Mã trong kho mà khách đã có dòng nhận (coupon_claims), dù mã còn nằm trong ví hay không. */
  claimed: string[];
  /** Mã chỉ dành cho khách mới trong kho, khi khách đã có đơn: bấm "Lưu mã" chỉ nhận lời từ chối. */
  newCustomerOnly: string[];
  /**
   * Mã trong kho mà khách đã nhận nhưng không còn áp dụng: chỉ dành cho khách mới, khách đã có đơn, và khách chưa dùng nó. Ví `/me/coupons` ẩn mã này
   * (như mã đã dùng hết lượt) nên không phân biệt được hai trường hợp; mã đã dùng đủ `perUserLimit` không nằm ở đây, nó là "đã dùng".
   */
  claimedIneligible: string[];
}

/**
 * Kho mã công khai (P14): mã `listed` còn hạn, còn lượt nhận. Không có trạng thái riêng của khách (đã nhận chưa): route có cache dùng chung,
 * client ghép từ `/me/coupons` và `mine`. Nhận mã vẫn qua `POST /coupons/claim` (khoá và trần lượt ở CouponClaimService), nên số "đã nhận" ở đây
 * cũ vài giây là chấp nhận được: lượt thật kiểm lúc nhận.
 */
@Injectable()
export class CouponCollectService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cửa sổ hiệu lực và lọc mã thẻ in: xem `listedWindow`. Lượt nhận còn lại tính từ số dòng coupon_claims, cũ vài giây là chấp nhận được. */
  async collectable(now: Date = new Date()): Promise<CollectableCoupon[]> {
    const rows = await this.prisma.coupon.findMany({ ...listedWindow(now), take: COLLECTABLE_LIMIT });
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

  /**
   * Phần riêng của khách trên cùng tập mã với `collectable` (cùng điều kiện, cùng thứ tự, cùng trần) nhưng không bỏ mã hết lượt: mã hết lượt
   * không có trong kho thì vô hại, còn mã khách đã nhận thì phải biết. Chỉ đọc; nhận mã vẫn là `POST /coupons/claim` và máy chủ kiểm lại ở đó.
   */
  async mine(userId: string, now: Date = new Date()): Promise<CollectableMine> {
    const rows = await this.prisma.coupon.findMany({
      ...listedWindow(now),
      select: { id: true, code: true, newCustomerOnly: true, perUserLimit: true },
      take: COLLECTABLE_LIMIT,
    });
    if (rows.length === 0) return { claimed: [], newCustomerOnly: [], claimedIneligible: [] };
    const mine = await this.prisma.couponClaim.findMany({
      where: { userId, couponId: { in: rows.map((r) => r.id) } },
      select: { couponId: true },
    });
    const claimedIds = new Set(mine.map((m) => m.couponId));
    // Chỉ hỏi đơn khi trong kho có mã chỉ-khách-mới (đã nhận hay chưa): luật ví là mã đó biến mất khi khách đã có đơn, bất kể đã nhận.
    const gatedRows = rows.filter((r) => r.newCustomerOnly);
    const returning = gatedRows.length > 0 && (await hasPriorOrder(this.prisma, userId));
    const heldGated = returning ? gatedRows.filter((r) => claimedIds.has(r.id)) : [];
    // Mã đã nhận mà đã dùng đủ lượt cá nhân thì là "đã dùng", cùng luật `perUserLimit <= 0 = không giới hạn` với `getAvailableCoupons`.
    const used = heldGated.length
      ? new Map(
          (
            await this.prisma.couponRedemption.groupBy({
              by: ['couponId'],
              where: { userId, couponId: { in: heldGated.map((r) => r.id) } },
              _count: { _all: true },
            })
          ).map((g) => [g.couponId, g._count._all]),
        )
      : new Map<string, number>();
    return {
      claimed: rows.filter((r) => claimedIds.has(r.id)).map((r) => r.code),
      newCustomerOnly: returning ? gatedRows.filter((r) => !claimedIds.has(r.id)).map((r) => r.code) : [],
      claimedIneligible: heldGated.filter((r) => !(r.perUserLimit > 0 && (used.get(r.id) ?? 0) >= r.perUserLimit)).map((r) => r.code),
    };
  }
}
