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

  // SELLER-11: CTV cần thấy số thực nhận sau thuế TNCN trước khi bấm rút; số phải là số service dùng để khấu trừ.
  it('trả mức khấu trừ thuế TNCN khi rút hoa hồng (cùng khoá và mặc định với affiliate.service)', async () => {
    expect((await new SystemConfigController(makeConfig()).publicConfig()).affiliatePitWithhold).toEqual({
      pct: 0.1,
      threshold: 2_000_000,
    });
    const config = makeConfig({ 'affiliate.pit_withhold_pct': 0, 'affiliate.pit_withhold_threshold': 5_000_000 });
    expect((await new SystemConfigController(config).publicConfig()).affiliatePitWithhold).toEqual({
      pct: 0,
      threshold: 5_000_000,
    });
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

// D2-07b: khối "Quà khách mới" và các chữ có số (D5-10) đọc từ đây. Mặc định phải bằng mặc định trong mã của nơi dùng số đó.
describe('SystemConfigController.publicConfig — số cho khách mới và Điểm Xanh', () => {
  it('chưa cấu hình → đúng mặc định hiện hành: voucher chào mừng 30.000đ cho đơn từ 199.000đ, freeship đơn đầu tắt, 10.000đ = 1 điểm, 1 điểm = 1.000đ', async () => {
    const out = await new SystemConfigController(makeConfig()).publicConfig();
    expect(out.newCustomer).toEqual({
      welcomeVoucher: { amount: 30000, minOrder: 199000 },
      firstOrderFreeShip: { enabled: false, minSubtotal: 0 },
    });
    expect(out.loyalty).toEqual({ vndPerPoint: 10000, vndPerPointRedeem: 1000, maxRedeemPct: 0.2, pointExpireMonths: 12 });
    expect(out.homeNewCustomerLayout).toBe(false);
    expect(out.communityPublicPreview).toBe(false);
  });

  it('admin đổi → trả giá trị mới của đúng khoá mà cron voucher, checkout và pricing đang đọc', async () => {
    const out = await new SystemConfigController(
      makeConfig({
        'voucher.welcome_amount': 25000,
        'voucher.welcome_min_order': 150000,
        'shipping.first_order_free_enabled': true,
        'shipping.first_order_free_min_subtotal': 99000,
        'loyalty.vnd_per_point': 20000,
        'home.new_customer_layout': true,
        'community.public_preview': true,
      }),
    ).publicConfig();
    expect(out.newCustomer).toEqual({
      welcomeVoucher: { amount: 25000, minOrder: 150000 },
      firstOrderFreeShip: { enabled: true, minSubtotal: 99000 },
    });
    expect(out.loyalty.vndPerPoint).toBe(20000);
    expect(out.homeNewCustomerLayout).toBe(true);
    expect(out.communityPublicPreview).toBe(true);
  });

  // Chuỗi "false" là truthy: chỉ boolean true thật mới bật, để cờ gõ nhầm không hứa freeship hay đổi bố cục.
  it.each(['true', 'false', 1, 'yes'])('cờ sai kiểu (%p) → coi là tắt', async (bad) => {
    const out = await new SystemConfigController(
      makeConfig({ 'shipping.first_order_free_enabled': bad, 'home.new_customer_layout': bad, 'community.public_preview': bad }),
    ).publicConfig();
    expect(out.newCustomer.firstOrderFreeShip.enabled).toBe(false);
    expect(out.homeNewCustomerLayout).toBe(false);
    expect(out.communityPublicPreview).toBe(false);
  });
});

// D5-10: câu trả lời FAQ dự phòng ("tối đa 20% giá trị đơn", "điểm có hạn 12 tháng") đọc từ đây, cùng khoá và mặc định với getOverview.
describe('SystemConfigController.publicConfig — trần dùng điểm và hạn điểm (D5-10)', () => {
  it('admin đổi → trả đúng giá trị của loyalty.max_redeem_pct và loyalty.point_expire_months', async () => {
    const out = await new SystemConfigController(
      makeConfig({ 'loyalty.max_redeem_pct': 0.3, 'loyalty.point_expire_months': 6 }),
    ).publicConfig();
    expect(out.loyalty).toMatchObject({ maxRedeemPct: 0.3, pointExpireMonths: 6 });
  });

  it('trần 0 là hợp lệ (tắt dùng điểm ở thanh toán), không bị thay bằng mặc định', async () => {
    const out = await new SystemConfigController(makeConfig({ 'loyalty.max_redeem_pct': 0 })).publicConfig();
    expect(out.loyalty.maxRedeemPct).toBe(0);
  });

  it.each(['0.3', 1.5, -0.1, null])('trần sai (%p) → mặc định 0.2 như getOverview', async (bad) => {
    const out = await new SystemConfigController(makeConfig({ 'loyalty.max_redeem_pct': bad })).publicConfig();
    expect(out.loyalty.maxRedeemPct).toBe(0.2);
  });

  it.each(['12', 0, -3, Number.NaN, null])('số tháng hạn điểm sai (%p) → 12 tháng như pointsExpiryFrom', async (bad) => {
    const out = await new SystemConfigController(makeConfig({ 'loyalty.point_expire_months': bad })).publicConfig();
    expect(out.loyalty.pointExpireMonths).toBe(12);
  });
});

// D5-10: chữ trong miniapp từng viết cứng 45%, 24 giờ, "tối đa 1.000 điểm"; giờ đọc từ config công khai.
describe('SystemConfigController.publicConfig — số trong chữ đại lý và sự kiện cộng đồng (D5-10)', () => {
  it('chưa cấu hình → đúng mặc định hiện hành: chiết khấu đại lý tối đa 45%, duyệt hồ sơ 24 giờ, thưởng sự kiện tối đa 1.000 điểm', async () => {
    const out = await new SystemConfigController(makeConfig()).publicConfig();
    expect(out.dealer).toEqual({ maxDiscountPct: 0.45, reviewHours: 24 });
    expect(out.community).toEqual({ eventRewardMaxPoints: 1000 });
  });

  it('admin đổi → trả giá trị mới của đúng khoá mà dealer.service đang kẹp chiết khấu', async () => {
    const out = await new SystemConfigController(
      makeConfig({ 'dealer.max_discount_pct': 0.4, 'dealer.review_hours': 48 }),
    ).publicConfig();
    expect(out.dealer).toEqual({ maxDiscountPct: 0.4, reviewHours: 48 });
  });

  it.each(['0.4', 0, -1, 1.5, null])('chiết khấu sai (%p) → null để miniapp bỏ con số', async (bad) => {
    const out = await new SystemConfigController(makeConfig({ 'dealer.max_discount_pct': bad })).publicConfig();
    expect(out.dealer.maxDiscountPct).toBeNull();
  });

  it.each(['24', 0, -3, 1.5, null])('số giờ duyệt sai (%p) → null để miniapp bỏ cam kết giờ', async (bad) => {
    const out = await new SystemConfigController(makeConfig({ 'dealer.review_hours': bad })).publicConfig();
    expect(out.dealer.reviewHours).toBeNull();
  });
});
