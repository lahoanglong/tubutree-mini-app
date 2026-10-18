import type { ConfigSeed } from '../../src/modules/system-config/config-seed';

/**
 * Chọn khoá SystemConfig nào trong `seed.ts` được nạp lên DB thật (`seed-reference.ts`).
 *
 * Mọi khoá đều có mặc định trong mã nên không khoá nào "thiếu thì hỏng"; nạp để admin THẤY và sửa được ở tab Cấu hình
 * (tab chỉ liệt kê dòng đã có trong DB). Dòng có giá trị BẰNG mặc định trong mã thì nạp không đổi hành vi. Dòng có giá
 * trị KHÁC mặc định trong mã (BUSINESS_CONFIG_KEYS) thì nạp là đổi hành vi, nên chỉ nạp khi chủ dự án đã duyệt từng giá trị.
 * Danh sách theo tiền tố là danh sách cho phép: tiền tố mới chưa ai duyệt thì KHÔNG được nạp, và
 * reference-config-selection.spec.ts đỏ để buộc người thêm khoá quyết định nạp hay loại.
 */
export const REFERENCE_CONFIG_PREFIXES: readonly string[] = [
  'loyalty',
  'voucher',
  'coupon',
  'affiliate',
  'cashback',
  'wallet',
  'referral',
  'support',
  'community',
  'game',
  'subscribe',
  'wishlist',
  'flashsale',
  'orders',
  'merchant',
  'ops',
  'storefront',
  'dealer',
  'seasonpass',
  'groupbuy',
  'legal',
  'shipping',
  'returns',
  'remarketing',
  'reorder',
  'attendance',
  'retention',
  'pancake',
  'home',
];

/**
 * Tiền tố cố ý không nạp, kèm lý do. Khớp theo `<tiền tố>.` nên một tiền tố hẹp (shipping.gomdon) loại cả họ khoá, kể cả
 * khoá Gomdon mới thêm sau, mà không kéo theo phần còn lại của `shipping`.
 */
export const EXCLUDED_CONFIG_PREFIXES: Readonly<Record<string, string>> = {
  payment: 'tài khoản nhận tiền: seed chứa số tài khoản mẫu; migration 20260625070000 đã tạo dòng, chủ shop nhập số thật ở admin',
  refill: 'thuộc gói đổi vỏ/đổi rác (phiên khác); ba khoá cũ đã có từ migration',
  'shipping.gomdon': 'thuộc gói đổi rác/Gomdon (phiên khác); migration 20260926100000 đã tạo dòng',
};

/** Khoá cố ý không nạp (nằm trong tiền tố được nạp), kèm lý do. */
export const EXCLUDED_CONFIG_KEYS: Readonly<Record<string, string>> = {
  'shipping.free_threshold': 'phí ship là quyết định của chủ shop: để trống thì go-live:check WARN (db.shipping_rates) buộc xác nhận, nạp 200k sẽ làm WARN biến mất mà chưa ai xác nhận',
  'shipping.flat_fee_below_threshold': 'như shipping.free_threshold',
  'shipping.first_order_free_enabled': 'migration 20261018150010_claim_freeship_config đã tạo dòng với giá trị bằng mặc định trong mã (ON CONFLICT DO NOTHING), nên nạp lại ở seed-reference là thừa',
  'shipping.first_order_free_min_subtotal': 'như shipping.first_order_free_enabled',
  'app.miniapp_base_url': 'như shipping.first_order_free_enabled (mặc định rỗng, không rơi về biến môi trường: link thiếu thì QR dùng đường dẫn tương đối)',
  'merchant.consignment_settle_from': 'mốc đối soát hàng giao hộ là quyết định của chủ shop: thiếu dòng thì go-live:check WARN (db.consignment_from) buộc đặt mốc; nạp ngày nào cũng làm WARN thành PASS mà chưa ai xác nhận, và nạp null chỉ đổi WARN sang thông báo "giá trị không hợp lệ". Chủ shop đặt ở Quản trị, Cấu hình (ghi được dù chưa có dòng nhờ luật ghi trong SystemConfigService.JSON_RULES), theo gợi ý của go-live:check',
};

/**
 * Khoá nằm trong tiền tố được nạp nhưng giá trị seed là quyết định kinh doanh (tiền, điểm, xác suất) khác mặc định trong mã,
 * kèm hai giá trị để chủ dự án so. Chỉ nạp với `--with-business-defaults`; không cờ thì DB giữ hành vi như bảng trống.
 */
export const BUSINESS_CONFIG_KEYS: Readonly<Record<string, string>> = {
  'game.spin_prizes': 'mã mặc định [] (vòng quay tắt); seed mở 8 giải, có voucher 20k/50k và tới 50 điểm Xanh',
  'referral.milestones_points': 'mã mặc định [] (không thưởng mốc); seed thưởng 20/40/100 điểm Xanh ở mốc 3/5/10 bạn',
  'subscribe.discount_tiers': 'mã mặc định một bậc bằng subscribe.discount_pct (12%); seed thêm 14% (3 gói) và 15% (5 gói)',
  'shipping.tier_freeship_overrides': 'mã mặc định {} (không hạng nào freeship sớm); seed cho Lộc Biếc freeship từ 99k, Đại Thụ và Cổ Thụ freeship hết',
  'game.streak_7_bonus': 'mã mặc định { seeds: 20 }; seed { seeds: 10, free_spins: 1 } (free_spins không code nào đọc)',
  'seasonpass.tiers': 'mã mặc định [] ; seed 5 bậc thưởng (Season Pass đang ẩn, SEASON_PASS_ENABLED=false)',
};

/**
 * Khoá mã đọc nhưng `seed.ts` chưa có, nạp đúng giá trị mặc định trong mã để admin thấy (D4-021).
 * `fallbackSource` là đoạn mã nguồn đang giữ mặc định đó; reference-config-selection.spec.ts đối chiếu để hai nơi không lệch.
 */
export interface ExtraConfig extends ConfigSeed {
  fallbackSource: { file: string; text: string };
}

const FEED = 'src/modules/feed/community-feed.service.ts';
const PUBLIC_CONFIG = 'src/modules/system-config/public-config.ts';
const COMMISSION_RATE = 'src/modules/affiliate/commission-rate-csv.ts';
const COMMISSION_ROLES = 'src/modules/affiliate/commission-eligibility.ts';
const STOREFRONT_CONFIG = 'src/modules/storefront/storefront-config.ts';
const PANCAKE_CATEGORY_MAP = 'src/modules/integrations/pancake/pancake-sync.service.ts';
const PANCAKE_PROCESSOR = 'src/modules/integrations/pancake/pancake.processor.ts';

export const EXTRA_CONFIGS: readonly ExtraConfig[] = [
  { key: 'community.rep_post', value: 5, category: 'community', description: 'Điểm uy tín cộng cho người có bài cộng đồng được đăng', fallbackSource: { file: FEED, text: "get<number>('community.rep_post', 5)" } },
  { key: 'community.rep_answer', value: 2, category: 'community', description: 'Điểm uy tín cộng cho người trả lời bài của người khác', fallbackSource: { file: FEED, text: "get<number>('community.rep_answer', 2)" } },
  { key: 'community.rep_best', value: 10, category: 'community', description: 'Điểm uy tín cộng cho câu trả lời được chọn hay nhất (lần chọn đầu)', fallbackSource: { file: FEED, text: "get<number>('community.rep_best', 10)" } },
  { key: 'community.daily_rep_cap', value: 30, category: 'community', description: 'Tổng điểm uy tín tối đa một người được cộng mỗi ngày', fallbackSource: { file: FEED, text: "get<number>('community.daily_rep_cap', 30)" } },
  { key: 'community.rep_thresholds', value: [0, 50, 200, 500], category: 'community', description: 'Mốc điểm uy tín để lên cấp 1 đến 4 (Mầm, Cây non, Cây trưởng thành, Cổ thụ)', fallbackSource: { file: FEED, text: 'const DEFAULT_REP_THRESHOLDS = [0, 50, 200, 500];' } },
  { key: 'dealer.review_hours', value: 24, category: 'dealer', description: 'Số giờ Tubu hẹn xét duyệt hồ sơ đại lý (chỉ để hiện chữ cho người đăng ký, không tự duyệt theo số này)', fallbackSource: { file: PUBLIC_CONFIG, text: "get<unknown>('dealer.review_hours', DEALER_REVIEW_HOURS_DEFAULT)" } },
  { key: 'community.public_preview', value: true, category: 'community', description: 'true = khách chưa đăng nhập được xem trước vài bài cộng đồng đã đăng (chỉ đọc, thích/bình luận/đăng bài vẫn cần đăng nhập); false = phải đăng nhập mới thấy', fallbackSource: { file: FEED, text: 'get<unknown>(PUBLIC_PREVIEW_KEY, PUBLIC_PREVIEW_DEFAULT)' } },
  { key: 'home.new_customer_layout', value: true, category: 'home', description: 'Trang chủ Mini App: cờ chỉ đổi thứ tự khối, không bật/tắt khối. true = với khách chưa có đơn, "Quà khách mới" và danh mục lên ngay sau ô tìm và dải đơn, trước giờ vàng; false = giữ thứ tự cũ. Khối "Quà khách mới" luôn hiện với khách mới ở cả hai trường hợp', fallbackSource: { file: PUBLIC_CONFIG, text: "get<unknown>('home.new_customer_layout', true)" } },
  { key: 'affiliate.max_rate_pct', value: 50, category: 'affiliate', description: 'Trần % hoa hồng CTV admin được đặt cho một biến thể (phần trăm, 50 = 50%)', fallbackSource: { file: COMMISSION_RATE, text: 'export const DEFAULT_AFFILIATE_MAX_RATE_PCT = 50;' } },
  { key: 'affiliate.commission_eligible_roles', value: ['AFFILIATE', 'DEALER'], category: 'affiliate', description: 'Vai trò được ghi công đơn và hưởng hoa hồng CTV (thêm "CUSTOMER" nếu khách thường chia sẻ cũng được hưởng)', fallbackSource: { file: COMMISSION_ROLES, text: 'DEFAULT_COMMISSION_ELIGIBLE_ROLES: readonly UserRole[] = [UserRole.AFFILIATE, UserRole.DEALER];' } },
  { key: 'storefront.require_approval', value: true, category: 'storefront', description: 'Bật thì gian hàng CTV phải được admin duyệt lần đầu mới hiện trên trang công khai (tắt: hiện ngay khi CTV đăng)', fallbackSource: { file: STOREFRONT_CONFIG, text: 'export const DEFAULT_STOREFRONT_REQUIRE_APPROVAL = true;' } },
  { key: 'storefront.subdomain_enabled', value: false, category: 'storefront', description: 'Bật khi DNS wildcard và chứng chỉ đã xong: gian hàng được hiện và chia sẻ link <tên>.tubutree.com (tắt: chỉ link /s/<mã>)', fallbackSource: { file: STOREFRONT_CONFIG, text: 'export const DEFAULT_STOREFRONT_SUBDOMAIN_ENABLED = false;' } },
  { key: 'pancake.total_mismatch_check', value: true, category: 'pancake', description: 'So tổng tiền Pancake với đơn Tubu mỗi lần webhook; lệch thì đưa đơn vào "Cần xử lý Pancake" (false = tắt khi báo nhầm hàng loạt)', fallbackSource: { file: PANCAKE_PROCESSOR, text: 'get<boolean>(PANCAKE_TOTAL_CHECK_KEY, true)' } },
  { key: 'pancake.category_map', value: {}, category: 'pancake', description: 'Gán danh mục tự động cho sản phẩm đồng bộ từ Pancake: { "mã hoặc tên nhóm hàng Pancake": "id danh mục Tubu" } (xem Quản trị, Danh mục sản phẩm). Chỉ áp cho sản phẩm chưa có danh mục; rỗng = không tự gán', fallbackSource: { file: PANCAKE_CATEGORY_MAP, text: 'get<PancakeCategoryMap>(PANCAKE_CATEGORY_MAP_KEY, {})' } },
];

export type ConfigDecision = 'reference' | 'business' | 'excluded' | 'unclassified';

export function classifyConfigKey(key: string): ConfigDecision {
  if (key in EXCLUDED_CONFIG_KEYS) return 'excluded';
  if (Object.keys(EXCLUDED_CONFIG_PREFIXES).some((prefix) => key.startsWith(`${prefix}.`))) return 'excluded';
  if (!REFERENCE_CONFIG_PREFIXES.includes(key.split('.')[0]!)) return 'unclassified';
  return key in BUSINESS_CONFIG_KEYS ? 'business' : 'reference';
}

/** Dòng SystemConfig nạp mặc định: khoá được duyệt của seed.ts cộng các khoá bổ sung (không gồm khoá giá trị kinh doanh). */
export function selectReferenceConfigs(all: readonly ConfigSeed[]): ConfigSeed[] {
  const fromSeed = all.filter((c) => classifyConfigKey(c.key) === 'reference');
  const extras = EXTRA_CONFIGS.map(({ fallbackSource: _src, ...row }) => row);
  return [...fromSeed, ...extras];
}

/** Dòng SystemConfig chỉ nạp khi có `--with-business-defaults`. */
export function selectBusinessConfigs(all: readonly ConfigSeed[]): ConfigSeed[] {
  return all.filter((c) => classifyConfigKey(c.key) === 'business');
}
