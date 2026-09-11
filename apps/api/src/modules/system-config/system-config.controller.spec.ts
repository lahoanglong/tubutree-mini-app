import { SystemConfigController } from './system-config.controller';
import type { SystemConfigService } from './system-config.service';

/** config.get(key, fallback) giả lập: trả giá trị đã cấu hình, thiếu thì trả fallback. */
function makeConfig(values: Record<string, unknown> = {}) {
  return {
    get: jest.fn(async (key: string, fallback?: unknown) => (key in values ? values[key] : fallback)),
  } as unknown as SystemConfigService;
}

describe('SystemConfigController.publicConfig', () => {
  it('trả freeshipThreshold từ config', async () => {
    const config = makeConfig({ 'shipping.free_threshold': 150000 });
    const out = await new SystemConfigController(config).publicConfig();
    expect(out.freeshipThreshold).toBe(150000);
    expect((config as unknown as { get: jest.Mock }).get).toHaveBeenCalledWith('shipping.free_threshold', 200000);
  });

  // FE đang hardcode các con số này ở nhiều màn (tiết kiệm 12% đặt định kỳ, hoa hồng → Ví ×1.5,
  // rút tối thiểu 50k). Admin đổi config là FE hiển thị SAI SỐ TIỀN mà không ai biết
  // (P2-5/P2-15 audit mạch lạc) → đưa hết vào endpoint public để FE đọc.
  it('trả kèm tham số FE đang hardcode: % đặt định kỳ, hệ số Ví CTV, mốc rút tối thiểu', async () => {
    const config = makeConfig({
      'subscribe.discount_pct': 0.15,
      'affiliate.tubu_wallet_multiplier': 1.8,
      'affiliate.min_withdraw_bank': 80000,
    });
    const out = await new SystemConfigController(config).publicConfig();
    expect(out.subscribeDiscountPct).toBe(0.15);
    expect(out.affiliateWalletMultiplier).toBe(1.8);
    expect(out.affiliateMinWithdrawBank).toBe(80000);
  });

  it('chưa cấu hình → trả đúng mặc định hiện hành (12%, ×1.5, 50k)', async () => {
    const out = await new SystemConfigController(makeConfig()).publicConfig();
    expect(out.subscribeDiscountPct).toBe(0.12);
    expect(out.affiliateWalletMultiplier).toBe(1.5);
    expect(out.affiliateMinWithdrawBank).toBe(50000);
  });

  it('dùng default 200000 khi config chưa set', async () => {
    const out = await new SystemConfigController(makeConfig()).publicConfig();
    expect(out.freeshipThreshold).toBe(200000);
  });
});
