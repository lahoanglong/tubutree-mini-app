import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { SystemConfigService } from './system-config.service';
import { isGomdonRecyclingEnabled } from '../integrations/gomdon/gomdon-config';
import { toShippingEta } from './shipping-eta';

/**
 * Config hiển thị an toàn cho client (public) — WHITELIST rõ ràng, KHÔNG dùng getByCategory
 * để tránh lộ key nội bộ/secret. Hiện phục vụ badge freeship ở PDP.
 */
@Public()
@Controller('config')
export class SystemConfigController {
  constructor(private readonly config: SystemConfigService) {}

  @Get('public')
  /**
   * Tham số nghiệp vụ FE cần để HIỂN THỊ đúng. Mọi giá trị ở đây trước đó bị hardcode rải rác
   * trong miniapp ("tiết kiệm 12%", "Ví Tubu ×1.5", "rút tối thiểu 50k") — admin đổi config là
   * FE nói sai số tiền mà không ai phát hiện (P2-5/P2-15 audit mạch lạc). Chỉ đưa ra thứ vốn
   * đã hiển thị công khai cho người dùng, không lộ tham số nội bộ.
   */
  async publicConfig() {
    const [
      freeshipThreshold,
      subscribeDiscountPct,
      affiliateWalletMultiplier,
      affiliateMinWithdrawBank,
      cashbackHoldDays,
      recyclingEnabled,
      etaMinDays,
      etaMaxDays,
    ] = await Promise.all([
      this.config.get<number>('shipping.free_threshold', 200000),
      this.config.get<number>('subscribe.discount_pct', 0.12),
      this.config.get<number>('affiliate.tubu_wallet_multiplier', 1.5),
      this.config.get<number>('affiliate.min_withdraw_bank', 50000),
      this.config.get<number>('cashback.hold_days', 30),
      // Chỉ trả boolean — KHÔNG lộ cấu hình/tài khoản Gomdon. true khi Gomdon đã cấu hình VÀ admin
      // bật shipping.gomdon.recycling_enabled; miniapp chỉ hiện lựa chọn thu gom khi true.
      isGomdonRecyclingEnabled(this.config).catch(() => false),
      this.config.get<number | null>('shipping.eta_min_days', null),
      this.config.get<number | null>('shipping.eta_max_days', null),
    ]);
    return {
      freeshipThreshold,
      subscribeDiscountPct,
      affiliateWalletMultiplier,
      affiliateMinWithdrawBank,
      cashbackHoldDays,
      recyclingEnabled,
      shippingEta: toShippingEta(etaMinDays, etaMaxDays),
    };
  }
}
