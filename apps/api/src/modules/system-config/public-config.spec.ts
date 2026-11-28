import { buildPublicConfig } from './public-config';
import { DEFAULT_CHAT_HOURS } from '../support-chat/support-chat.config';

const build = (stored: Record<string, unknown>) =>
  buildPublicConfig({ get: jest.fn(async (key: string, fallback?: unknown) => (key in stored ? stored[key] : fallback)) } as never);

describe('buildPublicConfig — chat', () => {
  it('mặc định: tắt, giờ mặc định', async () => {
    const cfg = await build({});
    expect(cfg.chat).toEqual({ enabled: false, hours: DEFAULT_CHAT_HOURS });
  });

  it('chỉ boolean true thật mới bật', async () => {
    expect((await build({ 'chat.enabled': true })).chat.enabled).toBe(true);
    expect((await build({ 'chat.enabled': 'true' })).chat.enabled).toBe(false);
    expect((await build({ 'chat.enabled': 1 })).chat.enabled).toBe(false);
  });

  it('giờ hợp lệ được giữ, giờ hỏng rơi về mặc định', async () => {
    expect((await build({ 'chat.hours': { start: '09:00', end: '18:30' } })).chat.hours).toEqual({ start: '09:00', end: '18:30' });
    expect((await build({ 'chat.hours': { start: '25:00', end: '18:30' } })).chat.hours).toEqual(DEFAULT_CHAT_HOURS);
    expect((await build({ 'chat.hours': 'sáng' })).chat.hours).toEqual(DEFAULT_CHAT_HOURS);
  });

  it('giờ hợp lệ có khoá thừa thì chỉ trả start và end', async () => {
    const cfg = await build({ 'chat.hours': { start: '09:00', end: '18:00', note: 'internal' } });
    expect(cfg.chat.hours).toEqual({ start: '09:00', end: '18:00' });
  });

  it('không lộ mã nhóm Zalo và lời nhắn ngoài giờ', async () => {
    const cfg = await build({ 'chat.enabled': true, 'chat.zalo_group_id': 'g1', 'chat.off_hours_text': 'x' });
    expect(Object.keys(cfg.chat).sort()).toEqual(['enabled', 'hours']);
    expect(Object.keys(cfg.chat.hours).sort()).toEqual(['end', 'start']);
  });
});

describe('buildPublicConfig — shippingFlatFee (phí giao cố định dưới ngưỡng freeship)', () => {
  it('mặc định 19.000đ khi chưa cấu hình, cùng mặc định với PricingService', async () => {
    expect((await build({})).shippingFlatFee).toBe(19000);
  });

  it('số đã cấu hình được trả nguyên văn, kể cả 0 (mọi đơn miễn phí giao)', async () => {
    expect((await build({ 'shipping.flat_fee_below_threshold': 25000 })).shippingFlatFee).toBe(25000);
    expect((await build({ 'shipping.flat_fee_below_threshold': 0 })).shippingFlatFee).toBe(0);
  });

  it('giá trị hỏng (chuỗi, âm, NaN, null) thì về mặc định, không ra con số vô lý cho JSON-LD', async () => {
    for (const bad of ['19000', -1, Number.NaN, null, Infinity]) {
      expect((await build({ 'shipping.flat_fee_below_threshold': bad })).shippingFlatFee).toBe(19000);
    }
  });
});

describe('buildPublicConfig — catalogLaunchDate (mốc ngày mở bán)', () => {
  it('mặc định null: client giữ luật 30 ngày', async () => {
    expect((await build({})).catalogLaunchDate).toBeNull();
    expect((await build({ 'catalog.launch_date': '' })).catalogLaunchDate).toBeNull();
  });

  it('ngày hợp lệ được trả nguyên văn; giá trị hỏng thành null', async () => {
    expect((await build({ 'catalog.launch_date': '2026-11-01' })).catalogLaunchDate).toBe('2026-11-01');
    for (const bad of ['2026-02-30', 'mai', 20261101, null]) expect((await build({ 'catalog.launch_date': bad })).catalogLaunchDate).toBeNull();
  });
});

describe('buildPublicConfig — đơn vị vận hành', () => {
  it('mặc định: mọi trường null', async () => {
    expect((await build({})).company).toEqual({ legalName: null, taxCode: null, address: null, bctNoticeUrl: null, representative: null, registrationNumber: null, registrationDate: null, registrationPlace: null });
  });

  it('trường chỉ có ký tự vô hình là null để chân trang ẩn dòng; ký tự vô hình ở hai đầu chữ thật bị cắt', async () => {
    const cfg = await build({ 'company.legal_name': '\u200b\ufeff\u2060', 'company.tax_code': '\u200b0312345678\ufeff', 'company.address': ' \u200b ' });
    expect(cfg.company).toEqual({ legalName: null, taxCode: '0312345678', address: null, bctNoticeUrl: null, representative: null, registrationNumber: null, registrationDate: null, registrationPlace: null });
  });

  it('trả tên, MST, địa chỉ đã cắt khoảng trắng; trường rỗng hoặc sai kiểu là null', async () => {
    const cfg = await build({ 'company.legal_name': ' Công ty A ', 'company.tax_code': '0312345678', 'company.address': '   ', 'company.bct_notice_url': 5 });
    expect(cfg.company).toEqual({ legalName: 'Công ty A', taxCode: '0312345678', address: null, bctNoticeUrl: null, representative: null, registrationNumber: null, registrationDate: null, registrationPlace: null });
  });

  it('người đại diện và ĐKDN: trả đã chuẩn hoá; ngày dd/mm/yyyy từ nhiều dạng; ngày vô lý, số lạ, chuỗi quá dài hoặc sai kiểu là null', async () => {
    const ok = await build({
      'company.representative': ' Nguyễn Văn A ',
      'company.business_registration_number': ' 0319585995 ',
      'company.business_registration_date': '2020-03-02',
      'company.business_registration_place': 'Sở Tài chính Thành phố Hồ Chí Minh',
    });
    expect(ok.company).toMatchObject({
      representative: 'Nguyễn Văn A',
      registrationNumber: '0319585995',
      registrationDate: '02/03/2020',
      registrationPlace: 'Sở Tài chính Thành phố Hồ Chí Minh',
    });
    expect((await build({ 'company.business_registration_date': '2/3/2020' })).company.registrationDate).toBe('02/03/2020');
    for (const bad of ['31/02/2020', '2099-01-01', '01/01/1980', 'mai', 20200302, null]) {
      expect((await build({ 'company.business_registration_date': bad })).company.registrationDate).toBeNull();
    }
    for (const bad of ['<script>', 'a'.repeat(41), 5, null]) {
      expect((await build({ 'company.business_registration_number': bad })).company.registrationNumber).toBeNull();
    }
    expect((await build({ 'company.representative': 'x'.repeat(201) })).company.representative).toBeNull();
    expect((await build({ 'company.business_registration_place': '\u200b' })).company.registrationPlace).toBeNull();
  });

  it('link Bộ Công Thương chỉ nhận https (không đưa javascript: hoặc http cho khách)', async () => {
    expect((await build({ 'company.bct_notice_url': 'https://online.gov.vn/x' })).company.bctNoticeUrl).toBe('https://online.gov.vn/x');
    expect((await build({ 'company.bct_notice_url': 'javascript:alert(1)' })).company.bctNoticeUrl).toBeNull();
    expect((await build({ 'company.bct_notice_url': 'http://online.gov.vn/x' })).company.bctNoticeUrl).toBeNull();
  });

  it('huy hiệu Bộ Công Thương chỉ bật với link online.gov.vn hoặc *.gov.vn: rỗng, trang lạ, giả hậu tố, có @, cổng lạ đều null', async () => {
    expect((await build({ 'company.bct_notice_url': 'https://www.online.gov.vn/Home/WebDetails/1' })).company.bctNoticeUrl).toBe('https://www.online.gov.vn/Home/WebDetails/1');
    expect((await build({ 'company.bct_notice_url': 'https://tmdt.gov.vn/x' })).company.bctNoticeUrl).toBe('https://tmdt.gov.vn/x');
    for (const bad of ['', 'https://example.com/online.gov.vn', 'https://online.gov.vn.evil.com/x', 'https://evilgov.vn/x', 'https://online.gov.vn@evil.com/x', 'https://online.gov.vn:8443/x']) {
      expect((await build({ 'company.bct_notice_url': bad })).company.bctNoticeUrl).toBeNull();
    }
  });
});

describe('buildPublicConfig — hệ số hạng', () => {
  const cfg = { get: jest.fn(async (_k: string, fallback?: unknown) => fallback) } as never;
  const rows = [
    { id: 't1', name: 'Mầm Xanh', pointMultiplier: '1.00' },
    { id: 't2', name: 'Lộc Biếc', pointMultiplier: { toString: () => '1.20' } },
    { id: 'bad', name: 'Hỏng', pointMultiplier: 'abc' },
    { id: 'zero', name: 'Không', pointMultiplier: 0 },
  ];

  it('trả hệ số và tên theo id hạng, bỏ hệ số hỏng', async () => {
    const r = await buildPublicConfig(cfg, async () => rows);
    expect(r.loyalty.tierMultipliers).toEqual({ t1: 1, t2: 1.2 });
    expect(r.loyalty.tierNames).toEqual({ t1: 'Mầm Xanh', t2: 'Lộc Biếc' });
  });

  it('không có bộ đọc hoặc đọc lỗi thì bảng rỗng, phần còn lại của config vẫn trả', async () => {
    expect((await buildPublicConfig(cfg)).loyalty.tierMultipliers).toEqual({});
    const r = await buildPublicConfig(cfg, async () => { throw new Error('db'); });
    expect(r.loyalty.tierMultipliers).toEqual({});
    expect(r.loyalty.earnPct).toBeGreaterThan(0);
  });
});

describe('buildPublicConfig — referralShareCardEnabled (trang đích link mời)', () => {
  it('mặc định tắt; chỉ boolean true thật mới bật', async () => {
    expect((await build({})).referralShareCardEnabled).toBe(false);
    expect((await build({ 'referral.share_card_enabled': true })).referralShareCardEnabled).toBe(true);
    expect((await build({ 'referral.share_card_enabled': 'true' })).referralShareCardEnabled).toBe(false);
    expect((await build({ 'referral.share_card_enabled': 1 })).referralShareCardEnabled).toBe(false);
  });
});

describe('buildPublicConfig — returnPackagingNudgeEnabled (gợi ý gửi lại bao bì)', () => {
  it('mặc định tắt; chỉ boolean true thật mới bật', async () => {
    expect((await build({})).returnPackagingNudgeEnabled).toBe(false);
    expect((await build({ 'checkout.return_packaging_nudge_enabled': true })).returnPackagingNudgeEnabled).toBe(true);
    expect((await build({ 'checkout.return_packaging_nudge_enabled': 'true' })).returnPackagingNudgeEnabled).toBe(false);
    expect((await build({ 'checkout.return_packaging_nudge_enabled': 1 })).returnPackagingNudgeEnabled).toBe(false);
  });
});

describe('buildPublicConfig — freeshipBoosterEnabled (dải "Thêm 1 món nhỏ" ở giỏ)', () => {
  it('mặc định tắt; chỉ boolean true thật mới bật', async () => {
    expect((await build({})).freeshipBoosterEnabled).toBe(false);
    expect((await build({ 'commerce.freeship_booster_enabled': true })).freeshipBoosterEnabled).toBe(true);
    expect((await build({ 'commerce.freeship_booster_enabled': 'true' })).freeshipBoosterEnabled).toBe(false);
    expect((await build({ 'commerce.freeship_booster_enabled': 1 })).freeshipBoosterEnabled).toBe(false);
  });
});

describe('buildPublicConfig — unitPriceEnabled, pdpEtaEnabled (trang chi tiết, tubu-w4-02)', () => {
  it('mặc định tắt; chỉ boolean true thật mới bật', async () => {
    const off = await build({});
    expect(off.unitPriceEnabled).toBe(false);
    expect(off.pdpEtaEnabled).toBe(false);
    expect((await build({ 'catalog.unit_price_enabled': true })).unitPriceEnabled).toBe(true);
    expect((await build({ 'catalog.unit_price_enabled': 'true' })).unitPriceEnabled).toBe(false);
    expect((await build({ 'shipping.pdp_eta_enabled': true })).pdpEtaEnabled).toBe(true);
    expect((await build({ 'shipping.pdp_eta_enabled': 1 })).pdpEtaEnabled).toBe(false);
  });

  it('bật hai cờ không đổi các mốc kinh tế đã chốt (ngưỡng miễn phí giao, trần dùng điểm)', async () => {
    const cfg = { 'shipping.free_threshold': 199_000, 'loyalty.max_redeem_pct': 0.2 };
    const off = await build(cfg);
    const on = await build({ ...cfg, 'catalog.unit_price_enabled': true, 'shipping.pdp_eta_enabled': true });
    expect(on.freeshipThreshold).toBe(199_000);
    expect(on.loyalty.maxRedeemPct).toBe(0.2);
    const { unitPriceEnabled: _u, pdpEtaEnabled: _p, ...restOn } = on;
    const { unitPriceEnabled: _u2, pdpEtaEnabled: _p2, ...restOff } = off;
    expect(restOn).toEqual(restOff);
  });
});

describe('buildPublicConfig — perfRum (đo tốc độ trên máy khách)', () => {
  it('mặc định tắt với tỉ lệ 100; chỉ boolean true thật mới bật; tỉ lệ ngoài 0–100 hay sai kiểu là 0', async () => {
    expect((await build({})).perfRum).toEqual({ enabled: false, samplePct: 100 });
    expect((await build({ 'perf.rum_enabled': true, 'perf.rum_sample_pct': 25 })).perfRum).toEqual({ enabled: true, samplePct: 25 });
    expect((await build({ 'perf.rum_enabled': 'true' })).perfRum.enabled).toBe(false);
    for (const bad of [-1, 101, '50', Number.NaN, null]) {
      expect((await build({ 'perf.rum_sample_pct': bad })).perfRum.samplePct).toBe(0);
    }
  });

  it('bật cờ không đổi một giá trị nào khác: freeship, voucher chào mừng, điểm, trần đổi điểm giữ nguyên', async () => {
    const { perfRum: off, ...rest } = await build({});
    const { perfRum: on, ...restOn } = await build({ 'perf.rum_enabled': true, 'perf.rum_sample_pct': 100 });
    expect(off.enabled).toBe(false);
    expect(on.enabled).toBe(true);
    expect(restOn).toEqual(rest);
    expect(restOn).toEqual(
      expect.objectContaining({
        freeshipThreshold: 199000,
        loyalty: expect.objectContaining({ maxRedeemPct: expect.any(Number) }),
      }),
    );
    expect((restOn as { loyalty: { maxRedeemPct: number } }).loyalty.maxRedeemPct).toBeLessThanOrEqual(0.2);
  });
});

describe('buildPublicConfig — lịch kho của ngày nhận dự kiến (tubu-w6-02)', () => {
  it('chưa có dòng: lịch chuẩn; có dòng: theo dòng, trường hỏng về mặc định', async () => {
    expect((await build({})).deliverySchedule).toEqual({ cutoff: '15:00', workDays: [1, 2, 3, 4, 5, 6], holidays: [], hcmDays: [1, 2], provinceDays: [2, 4] });
    const cfg = await build({ 'shipping.warehouse_schedule': { cutoff: '14:00', workDays: [1, 2, 3, 4, 5], holidays: ['2026-12-25'], hcmDays: [1, 1], provinceDays: 'x' } });
    expect(cfg.deliverySchedule).toEqual({ cutoff: '14:00', workDays: [1, 2, 3, 4, 5], holidays: ['2026-12-25'], hcmDays: [1, 1], provinceDays: [2, 4] });
    expect(cfg.pdpEtaEnabled).toBe(false);
  });
});

describe('buildPublicConfig — đăng nhập web không cần Zalo (Email, Google)', () => {
  const KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'] as const;
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('chưa có khoá Google/SMTP → cả hai false (web ẩn nút Google, ẩn form Email)', async () => {
    const cfg = await build({});
    expect(cfg.googleLoginConfigured).toBe(false);
    expect(cfg.emailLoginConfigured).toBe(false);
  });

  it('chỉ một khoá Google → vẫn false; đủ hai khoá → true; không lộ giá trị khoá', async () => {
    process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
    expect((await build({})).googleLoginConfigured).toBe(false);
    process.env.GOOGLE_CLIENT_SECRET = 'gsecret-should-not-leak';
    const cfg = await build({});
    expect(cfg.googleLoginConfigured).toBe(true);
    expect(JSON.stringify(cfg)).not.toContain('gsecret-should-not-leak');
    expect(JSON.stringify(cfg)).not.toContain('cid.apps.googleusercontent.com');
  });

  it('SMTP Gmail đủ (như PROD) → emailLoginConfigured true, không lộ mật khẩu', async () => {
    Object.assign(process.env, { SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'shop@gmail.com', SMTP_PASS: 'app-pass-should-not-leak' });
    const cfg = await build({});
    expect(cfg.emailLoginConfigured).toBe(true);
    expect(JSON.stringify(cfg)).not.toContain('app-pass-should-not-leak');
  });
});
