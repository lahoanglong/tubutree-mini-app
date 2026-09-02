import { Injectable } from '@nestjs/common';
import { SystemConfigService } from '../system-config/system-config.service';

export interface ShippingInput {
  subtotal: number; // sau giảm giá hàng (chưa gồm ship)
  tierId?: string | null;
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
    const [freeThreshold, flatFee] = await Promise.all([
      this.config.get<number>('shipping.free_threshold', 200000),
      this.config.get<number>('shipping.flat_fee_below_threshold', 19000),
    ]);

    // Override theo hạng (id tier viết hoa: LOC_BIEC / DAI_THU / CO_THU).
    if (input.tierId) {
      const overrides = await this.config.get<Record<string, number> | null>(
        'shipping.tier_freeship_overrides',
        {},
      );
      // Guard `?? {}`: SystemConfigService.get() chỉ áp fallback khi CHƯA có row; nếu admin
      // lỡ lưu value=null cho key này, get() trả về null (không phải {}) → indexing throw.
      const tierThreshold = (overrides ?? {})[input.tierId];
      if (tierThreshold !== undefined && input.subtotal >= tierThreshold) {
        return 0;
      }
    }

    return input.subtotal >= freeThreshold ? 0 : flatFee;
  }

  /** Điểm tích cho giá trị hàng (đã trừ giảm giá), nhân multiplier hạng. */
  async calcPointsEarned(goodsValue: number, tierMultiplier = 1): Promise<number> {
    const vndPerPoint = await this.config.get<number>('loyalty.vnd_per_point', 10000);
    if (vndPerPoint <= 0) return 0;
    return Math.floor((goodsValue / vndPerPoint) * tierMultiplier);
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
}
