import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { isRealUser } from '../../common/real-user';
import { hasPriorOrder } from '../../common/first-order';
import { pointsForGoods } from './points-earn';

export interface ShippingInput {
  subtotal: number; // sau giảm giá hàng (chưa gồm ship)
  tierId?: string | null;
}

/**
 * Ngưỡng tiền hàng được miễn phí giao kho Tubu cho một hạng: ngưỡng toàn cục, hoặc ngưỡng riêng của hạng nếu thấp hơn
 * (id tier viết hoa: LOC_BIEC / DAI_THU / CO_THU). Giỏ hàng (thanh tiến độ freeship) và checkout cùng dùng hàm này.
 */
export async function freeShipThreshold(config: Pick<SystemConfigService, 'get'>, tierId: string | null | undefined): Promise<number> {
  const global = await config.get<number>('shipping.free_threshold', 200000);
  if (!tierId) return global;
  // `?? {}`: get() chỉ áp fallback khi CHƯA có row; admin lỡ lưu value=null thì get() trả null.
  const overrides = await config.get<Record<string, number> | null>('shipping.tier_freeship_overrides', {});
  const tier = (overrides ?? {})[tierId];
  return typeof tier === 'number' ? Math.min(tier, global) : global;
}

export const FIRST_ORDER_FREESHIP_ENABLED_KEY = 'shipping.first_order_free_enabled';
export const FIRST_ORDER_FREESHIP_MIN_KEY = 'shipping.first_order_free_min_subtotal';
export const FIRST_ORDER_FREESHIP_ENABLED_DEFAULT = true;
export const FIRST_ORDER_FREESHIP_MIN_DEFAULT = 199_000;

/**
 * Freeship đơn đầu (D2-08): ngưỡng tiền hàng kiện Tubu để đơn đầu của khách được miễn phí giao, null = không áp. Chỉ khách thật
 * (cùng luật voucher chào mừng: tài khoản deviceId mới tạo vô hạn) chưa có đơn nào ngoài đơn huỷ (common/first-order.ts).
 * Mặc định bật từ 199.000đ; chỉ đọc DB khi cờ bật. Giỏ (thanh tiến độ) và checkout cùng dùng hàm này.
 */
export async function firstOrderFreeShipFrom(
  config: Pick<SystemConfigService, 'get'> | undefined,
  prisma: Pick<PrismaService, 'user' | 'order'>,
  userId: string,
): Promise<number | null> {
  if (!config || (await config.get<boolean>(FIRST_ORDER_FREESHIP_ENABLED_KEY, FIRST_ORDER_FREESHIP_ENABLED_DEFAULT)) !== true) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true, zaloId: true } });
  if (!isRealUser(user)) return null;
  if (await hasPriorOrder(prisma, userId)) return null;
  const min: unknown = await config.get<number>(FIRST_ORDER_FREESHIP_MIN_KEY, FIRST_ORDER_FREESHIP_MIN_DEFAULT);
  return typeof min === 'number' && Number.isFinite(min) && min >= 0 ? min : null;
}

/** Lần đặt khác của khách vừa ghi đơn đầu giữa lúc báo giá và lúc ghi đơn này (kiểm trong tx đặt đơn). */
export const FIRST_ORDER_FREESHIP_TAKEN_MSG =
  'Ưu đãi miễn phí giao hàng đơn đầu đã dùng cho đơn khác của bạn. Vui lòng tải lại trang thanh toán để xem phí giao mới.';

/** Phí giao kiện Tubu sau freeship đơn đầu: 0 khi có ngưỡng và tiền hàng của kiện đạt ngưỡng. */
export function firstOrderShippingFee(fee: number, subtotal: number, freeFrom: number | null): number {
  return freeFrom != null && subtotal >= freeFrom ? 0 : fee;
}

/**
 * Tỉ lệ giảm tự động của hạng thành viên (0..1; 0 khi chưa có hạng). Giỏ và checkout cùng đọc qua hàm này.
 */
export async function tierDiscountPctOf(prisma: Pick<PrismaService, 'membershipTier'>, tierId: string | null | undefined): Promise<number> {
  if (!tierId) return 0;
  const tier = await prisma.membershipTier.findUnique({ where: { id: tierId }, select: { discountPct: true } });
  return tier ? Number(tier.discountPct) : 0;
}

/** Giảm theo hạng trên phần hàng còn lại sau combo và mã; làm tròn XUỐNG, không âm. Giỏ và checkout cùng dùng hàm này. */
export function calcTierDiscount(goodsValue: number, discountPct: number): number {
  if (discountPct <= 0 || goodsValue <= 0) return 0;
  return Math.floor(goodsValue * discountPct);
}

/**
 * Tính phí ship, điểm tích, điểm tối đa được trừ — TẤT CẢ đọc tham số từ SystemConfig.
 * Quy tắc (Build Spec §0.7, §6.6, §15):
 *  - Đơn ≥ shipping.free_threshold (200k) → freeship; ngược lại flat_fee (19k).
 *  - Hạng có override (Lộc Biếc freeship ≥99k, Đại Thụ/Cổ Thụ freeship toàn shop).
 *  - 10.000đ chi tiêu = 1 điểm × multiplier theo hạng.
 *  - 1 điểm = 1.000đ khi trừ, tối đa 20% giá trị đơn.
 */
@Injectable()
export class PricingService {
  constructor(private readonly config: SystemConfigService) {}

  async calcShippingFee(input: ShippingInput): Promise<number> {
    const [threshold, flatFee] = await Promise.all([
      freeShipThreshold(this.config, input.tierId),
      this.config.get<number>('shipping.flat_fee_below_threshold', 19000),
    ]);
    return input.subtotal >= threshold ? 0 : flatFee;
  }

  /** Điểm tích cho giá trị hàng (đã trừ giảm giá), nhân multiplier hạng. */
  async calcPointsEarned(goodsValue: number, tierMultiplier = 1): Promise<number> {
    const vndPerPoint = await this.config.get<number>('loyalty.vnd_per_point', 10000);
    return pointsForGoods(goodsValue, vndPerPoint, tierMultiplier);
  }

  /** Số VND tối đa có thể trừ bằng điểm cho 1 đơn. */
  async calcMaxRedeemableValue(orderValue: number): Promise<number> {
    const maxPct = await this.config.get<number>('loyalty.max_redeem_pct', 0.2);
    return Math.floor(orderValue * maxPct);
  }

  /** Quy đổi số điểm muốn dùng → VND được trừ, đã kẹp theo trần 20% và số điểm sẵn có. */
  async resolvePointsRedemption(
    pointsToUse: number,
    pointsBalance: number,
    orderValue: number,
  ): Promise<{ pointsUsed: number; discount: number }> {
    const [vndPerPointRedeem, maxValue] = await Promise.all([
      this.config.get<number>('loyalty.vnd_per_point_redeem', 1000),
      this.calcMaxRedeemableValue(orderValue),
    ]);
    // Guard chia 0/âm (mirror calcPointsEarned's vndPerPoint guard): misconfig hoặc orderValue=0
    // → tránh NaN lan vào pointsUsed/discount rồi vào tx tạo đơn (Prisma nhận NaN có thể lỗi khó hiểu).
    if (vndPerPointRedeem <= 0) return { pointsUsed: 0, discount: 0 };
    const maxPointsByValue = Math.floor(maxValue / vndPerPointRedeem);
    const pointsUsed = Math.max(0, Math.min(pointsToUse, pointsBalance, maxPointsByValue));
    return { pointsUsed, discount: pointsUsed * vndPerPointRedeem };
  }

  /**
   * PD-3 (spec 2.3): chia `pointsToUse` giữa hai lô Điểm Xanh.
   *  s = phần STANDARD, chịu trần `loyalty.max_redeem_pct` như resolvePointsRedemption.
   *  c = phần CONVERTED (xu cũ quy đổi), không trần %: phủ phần giá trị hàng còn lại, trừ lẻ < 1 điểm.
   * Lấy STANDARD tới trần trước vì lô đó hết hạn còn lô CONVERTED thì không, và vì CONVERTED vẫn bù
   * được tới `orderValue` nên tổng giảm không bao giờ nhỏ hơn cách chia khác. Tổng giảm ≤ orderValue
   * (không bao giờ trừ vào phí ship).
   */
  async resolvePointsRedemptionByLot(
    pointsToUse: number,
    standardUsable: number,
    convertedBalance: number,
    orderValue: number,
  ): Promise<{ pointsUsed: number; pointsUsedStandard: number; pointsUsedConverted: number; discount: number }> {
    const none = { pointsUsed: 0, pointsUsedStandard: 0, pointsUsedConverted: 0, discount: 0 };
    const vnd = await this.config.get<number>('loyalty.vnd_per_point_redeem', 1000);
    if (!(vnd > 0) || !(orderValue > 0) || !(pointsToUse > 0)) return none;
    const std = await this.resolvePointsRedemption(pointsToUse, Math.max(0, standardUsable), orderValue);
    const s = std.pointsUsed;
    const c = Math.max(
      0,
      Math.min(pointsToUse - s, Math.max(0, convertedBalance), Math.floor((orderValue - s * vnd) / vnd)),
    );
    return { pointsUsed: s + c, pointsUsedStandard: s, pointsUsedConverted: c, discount: (s + c) * vnd };
  }

  /**
   * Giảm giá TỰ ĐỘNG theo hạng thành viên (P0 A3-05 — audit `docs/audit-2026-09/03-retention-loops.md`:
   * hạng hứa "Cổ Thụ: Freeship + giảm 5% mọi đơn" — cột `MembershipTier.discountPct` (seed.ts) đã có
   * sẵn nhưng KHÔNG có chỗ nào trong pricing/checkout đọc nó trước fix này; mọi hạng nhận giá giống hệt
   * nhau bất kể hứa gì trên UI).
   *
   * Hàm THUẦN (không đọc SystemConfig) — caller (CheckoutService.compute) tự tra `MembershipTier` theo
   * `user.tierId` rồi truyền `discountPct` (0..1) vào đây. Tách riêng để test độc lập với DB/tier thật:
   * chỉ cần đưa discountPct bất kỳ là kiểm được công thức, không phải dựng lại toàn bộ bảng hạng.
   *
   * Làm tròn XUỐNG (floor) như calcPointsEarned/calcMaxRedeemableValue — nhất quán "khách không bao giờ
   * bị làm tròn thiệt thêm 1đ vì lẻ", và không bao giờ âm (guard goodsValue/discountPct <= 0).
   */
  calcTierDiscount(goodsValue: number, discountPct: number): number {
    return calcTierDiscount(goodsValue, discountPct);
  }
}
