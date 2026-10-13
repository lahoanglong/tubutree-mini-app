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

  // FE đang hardcode các con số này ở nhiều màn (tiết kiệm 12% đặt định kỳ, rút tối thiểu 50k).
  // Admin đổi config là FE hiển thị SAI SỐ TIỀN mà không ai biết (P2-5/P2-15 audit mạch lạc) →
  // đưa hết vào endpoint public để FE đọc.
  it('trả kèm tham số FE đang hardcode: % đặt định kỳ, mốc rút tối thiểu', async () => {
    const config = makeConfig({
      'subscribe.discount_pct': 0.15,
      'affiliate.min_withdraw_bank': 80000,
    });
    const out = await new SystemConfigController(config).publicConfig();
    expect(out.subscribeDiscountPct).toBe(0.15);
    expect(out.affiliateMinWithdrawBank).toBe(80000);
  });

  it('chưa cấu hình → trả đúng mặc định hiện hành (12%, 50k)', async () => {
    const out = await new SystemConfigController(makeConfig()).publicConfig();
    expect(out.subscribeDiscountPct).toBe(0.12);
    expect(out.affiliateMinWithdrawBank).toBe(50000);
  });

  // C-054 (A1-043): luật Ví ×1,5 đã bỏ (rút hoa hồng về Ví Tubu là 1:1, affiliate.service P0 A5-07). Config công
  // khai không được đọc khoá cũ nữa — dòng DB còn seed 1,5 mà FE cũ hiển thị "×1,5" là hứa sai số tiền.
  it('affiliateWalletMultiplier luôn là 1 (Ví 1:1), không đọc khoá affiliate.tubu_wallet_multiplier còn sót trong DB', async () => {
    const config = makeConfig({ 'affiliate.tubu_wallet_multiplier': 1.8 });
    const out = await new SystemConfigController(config).publicConfig();
    expect(out.affiliateWalletMultiplier).toBe(1);
    const get = (config as unknown as { get: jest.Mock }).get;
    expect(get.mock.calls.map((c) => c[0])).not.toContain('affiliate.tubu_wallet_multiplier');
  });

  // ENGAGE-20: miniapp hứa "Tiết kiệm đến 30%" trong khi mức mua chung thật là groupbuy.discount_pct (mặc định 15%);
  // BUYERMINI-16: màn đơn hàng ghi cứng "7 ngày" trong khi hạn đổi/trả đọc returns.window_days.
  it('trả mức giảm/quy mô nhóm mua chung và hạn đổi/trả theo config', async () => {
    const out = await new SystemConfigController(
      makeConfig({ 'groupbuy.discount_pct': 20, 'groupbuy.target_size': 4, 'returns.window_days': 10 }),
    ).publicConfig();
    expect(out.groupBuy).toEqual({ discountPct: 20, targetSize: 4 });
    expect(out.returnWindowDays).toBe(10);
  });

  it('chưa cấu hình → mặc định mua chung 15% / 3 người, đổi/trả 7 ngày (khớp giá trị service dùng)', async () => {
    const out = await new SystemConfigController(makeConfig()).publicConfig();
    expect(out.groupBuy).toEqual({ discountPct: 15, targetSize: 3 });
    expect(out.returnWindowDays).toBe(7);
  });

  it('dùng default 200000 khi config chưa set', async () => {
    const out = await new SystemConfigController(makeConfig()).publicConfig();
    expect(out.freeshipThreshold).toBe(200000);
  });

  describe('recyclingEnabled — cờ hiện lựa chọn "gửi lại vật liệu tái chế" ở checkout', () => {
    const KEYS = ['GOMDON_BASE_URL', 'GOMDON_PHONE', 'GOMDON_PASSWORD'] as const;
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
      for (const k of KEYS) saved[k] = process.env[k];
    });
    afterEach(() => {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    it('mặc định (chưa bật công tắc / chưa cấu hình Gomdon) → false', async () => {
      const out = await new SystemConfigController(makeConfig()).publicConfig();
      expect(out.recyclingEnabled).toBe(false);
    });

    it('công tắc bật nhưng thiếu tài khoản/base URL Gomdon → false (không hứa thu gom khi không ai đi thu)', async () => {
      for (const k of KEYS) delete process.env[k];
      const out = await new SystemConfigController(makeConfig({ 'shipping.gomdon.recycling_enabled': true })).publicConfig();
      expect(out.recyclingEnabled).toBe(false);
    });

    it('Gomdon đã cấu hình env + công tắc true → true; chỉ trả boolean, không lộ cấu hình/tài khoản', async () => {
      process.env.GOMDON_BASE_URL = 'https://gomdon.test';
      process.env.GOMDON_PHONE = '0900';
      process.env.GOMDON_PASSWORD = 'pw';
      const out = await new SystemConfigController(makeConfig({ 'shipping.gomdon.recycling_enabled': true })).publicConfig();
      expect(out.recyclingEnabled).toBe(true);
      expect(JSON.stringify(out)).not.toContain('pw');
      expect(JSON.stringify(out)).not.toContain('0900');
    });

    it('đọc config lỗi → false, không làm hỏng cả endpoint public', async () => {
      const config = {
        get: jest.fn(async (key: string, fb?: unknown) => {
          if (key.startsWith('shipping.gomdon')) throw new Error('db');
          return fb;
        }),
      } as unknown as SystemConfigService;
      const out = await new SystemConfigController(config).publicConfig();
      expect(out.recyclingEnabled).toBe(false);
      expect(out.freeshipThreshold).toBe(200000);
    });
  });

  describe('shippingEta — ngày giao dự kiến (chỉ khi chủ shop đã cấu hình)', () => {
    it('chưa cấu hình → null (FE ẩn dòng "Giao dự kiến", không hứa ngày)', async () => {
      const out = await new SystemConfigController(makeConfig()).publicConfig();
      expect(out.shippingEta).toBeNull();
    });

    it('2 và 4 → { minDays: 2, maxDays: 4 }', async () => {
      const out = await new SystemConfigController(
        makeConfig({ 'shipping.eta_min_days': 2, 'shipping.eta_max_days': 4 }),
      ).publicConfig();
      expect(out.shippingEta).toEqual({ minDays: 2, maxDays: 4 });
    });

    it.each([
      [5, 2],
      [1.5, 3],
      [-1, 2],
      [2, 90],
      ['2', 4],
      [2, null],
    ])('giá trị sai (%p, %p) → null', async (min, max) => {
      const out = await new SystemConfigController(
        makeConfig({ 'shipping.eta_min_days': min, 'shipping.eta_max_days': max }),
      ).publicConfig();
      expect(out.shippingEta).toBeNull();
    });

    it('đọc 2 khoá với fallback null (không ném NotFound khi thiếu khoá)', async () => {
      const config = makeConfig();
      await new SystemConfigController(config).publicConfig();
      const get = (config as unknown as { get: jest.Mock }).get;
      expect(get).toHaveBeenCalledWith('shipping.eta_min_days', null);
      expect(get).toHaveBeenCalledWith('shipping.eta_max_days', null);
    });
  });
});

describe('SystemConfigController.publicConfig — liên hệ CSKH (C-019, Q-17)', () => {
  it('chưa cấu hình → hotline/email thật của Tubu Tree, chưa có Zalo OA', async () => {
    const out = await new SystemConfigController(makeConfig()).publicConfig();
    expect(out.support).toEqual({ hotline: '0899 149 229', email: 'tubutree@gmail.com', zaloOaName: null });
  });

  it('admin sửa → trả giá trị mới; để trống hoặc sai kiểu → null để miniapp ẩn dòng', async () => {
    const out = await new SystemConfigController(
      makeConfig({ 'support.hotline': ' 0900 000 000 ', 'support.email': '', 'support.zalo_oa_name': 42 }),
    ).publicConfig();
    expect(out.support).toEqual({ hotline: '0900 000 000', email: null, zaloOaName: null });
  });
});
