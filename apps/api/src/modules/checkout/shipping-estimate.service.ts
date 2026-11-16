import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { PricingService, firstOrderFreeShipFrom, firstOrderShippingFee, freeShipThreshold } from '../pricing/pricing.service';

export interface ShippingEstimateInput {
  /** Tiền hàng kiện Tubu (trước mọi khoản giảm), như `subtotal` của kiện Tubu trong báo giá. */
  subtotal: number;
  provinceCode?: string | null;
}

export interface ShippingEstimate {
  fee: number;
  /** Khoảng phí theo các tỉnh khi chưa biết tỉnh; bằng `fee` khi đã biết tỉnh. */
  feeMin: number;
  feeMax: number;
  freeshipThreshold: number;
  missingForFreeship: number;
  isEstimate: true;
  /** Tỉnh dùng để ước tính: tỉnh khách gửi, hoặc tỉnh của địa chỉ mặc định khi khách đã đăng nhập; null = chưa biết tỉnh. */
  provinceCode: string | null;
  /** Tên tỉnh, chỉ có khi lấy từ địa chỉ mặc định của chính người gọi. */
  provinceName: string | null;
}

/**
 * Phí giao kiện Tubu ước tính trước khi có địa chỉ (giỏ, trang sản phẩm). Gọi đúng các hàm mà `CheckoutService.shipmentTerms` dùng cho
 * kiện Tubu: phí theo ngưỡng và hạng (`PricingService.calcShippingFee`), rồi miễn phí giao đơn đầu (`firstOrderShippingFee`). Không gồm
 * các khoản chỉ biết ở thanh toán: mã miễn phí giao, thu rác kèm đơn, phí của gian hàng đối tác.
 */
@Injectable()
export class ShippingEstimateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly pricing: PricingService,
  ) {}

  async estimate(userId: string | null | undefined, input: ShippingEstimateInput): Promise<ShippingEstimate> {
    const subtotal = input.subtotal;
    let tierId: string | null = null;
    let firstOrderFrom: number | null = null;
    let provinceCode = input.provinceCode?.trim() || null;
    let provinceName: string | null = null;
    if (userId) {
      const [user, from, home] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: userId }, select: { tierId: true } }),
        firstOrderFreeShipFrom(this.config, this.prisma, userId),
        provinceCode
          ? Promise.resolve(null)
          : this.prisma.address.findFirst({
              where: { userId, isDefault: true },
              select: { provinceCode: true, province: true },
            }),
      ]);
      tierId = user?.tierId ?? null;
      firstOrderFrom = from;
      if (home?.provinceCode) {
        provinceCode = home.provinceCode;
        provinceName = home.province || null;
      }
    }
    const [base, threshold] = await Promise.all([
      this.pricing.calcShippingFee({ subtotal, tierId }),
      freeShipThreshold(this.config, tierId),
    ]);
    const fee = firstOrderShippingFee(base, subtotal, firstOrderFrom);
    const freeshipThreshold = firstOrderFrom != null ? Math.min(threshold, firstOrderFrom) : threshold;
    // Luật phí hiện tại không có thành phần theo tỉnh, nên khoảng phí của mọi tỉnh co về đúng một số; giữ hai trường để màn hình không
    // phải đổi khi luật phí theo vùng được thêm.
    return {
      fee,
      feeMin: fee,
      feeMax: fee,
      freeshipThreshold,
      missingForFreeship: fee === 0 ? 0 : Math.max(0, freeshipThreshold - subtotal),
      isEstimate: true,
      provinceCode,
      provinceName,
    };
  }
}
