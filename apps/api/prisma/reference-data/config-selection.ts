import type { ConfigSeed } from '../../src/modules/system-config/config-seed';

/**
 * Chọn khoá SystemConfig nào trong `seed.ts` được nạp lên DB thật (`seed-reference.ts`).
 *
 * Mọi khoá có mặc định trong mã nên không khoá nào "thiếu thì hỏng"; nạp để admin THẤY và sửa được ở tab Cấu hình
 * (tab chỉ liệt kê dòng đã có trong DB) và để các cặp khoá đi cùng nhau (hạng thành viên + freeship theo hạng) không lệch.
 * Danh sách theo tiền tố là danh sách cho phép: tiền tố mới chưa ai duyệt thì KHÔNG được nạp, và
 * reference-config-selection.spec.ts đỏ để buộc người thêm khoá quyết định nạp hay loại.
 */
export const REFERENCE_CONFIG_PREFIXES: readonly string[] = [
  'loyalty',
  'voucher',
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
  'shipping',
  'returns',
  'remarketing',
  'reorder',
  'attendance',
  'retention',
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
};

/**
 * Khoá mã đọc nhưng `seed.ts` chưa có, nạp đúng giá trị mặc định trong mã để admin thấy (D4-021).
 * `fallbackSource` là đoạn mã nguồn đang giữ mặc định đó; reference-config-selection.spec.ts đối chiếu để hai nơi không lệch.
 */
export interface ExtraConfig extends ConfigSeed {
  fallbackSource: { file: string; text: string };
}

const FEED = 'src/modules/feed/community-feed.service.ts';

export const EXTRA_CONFIGS: readonly ExtraConfig[] = [
  { key: 'community.rep_post', value: 5, category: 'community', description: 'Điểm uy tín cộng cho người có bài cộng đồng được đăng', fallbackSource: { file: FEED, text: "get<number>('community.rep_post', 5)" } },
  { key: 'community.rep_answer', value: 2, category: 'community', description: 'Điểm uy tín cộng cho người trả lời bài của người khác', fallbackSource: { file: FEED, text: "get<number>('community.rep_answer', 2)" } },
  { key: 'community.rep_best', value: 10, category: 'community', description: 'Điểm uy tín cộng cho câu trả lời được chọn hay nhất (lần chọn đầu)', fallbackSource: { file: FEED, text: "get<number>('community.rep_best', 10)" } },
  { key: 'community.daily_rep_cap', value: 30, category: 'community', description: 'Tổng điểm uy tín tối đa một người được cộng mỗi ngày', fallbackSource: { file: FEED, text: "get<number>('community.daily_rep_cap', 30)" } },
  { key: 'community.rep_thresholds', value: [0, 50, 200, 500], category: 'community', description: 'Mốc điểm uy tín để lên cấp 1 đến 4 (Mầm, Cây non, Cây trưởng thành, Cổ thụ)', fallbackSource: { file: FEED, text: 'const DEFAULT_REP_THRESHOLDS = [0, 50, 200, 500];' } },
];

export type ConfigDecision = 'reference' | 'excluded' | 'unclassified';

export function classifyConfigKey(key: string): ConfigDecision {
  if (key in EXCLUDED_CONFIG_KEYS) return 'excluded';
  if (Object.keys(EXCLUDED_CONFIG_PREFIXES).some((prefix) => key.startsWith(`${prefix}.`))) return 'excluded';
  return REFERENCE_CONFIG_PREFIXES.includes(key.split('.')[0]!) ? 'reference' : 'unclassified';
}

/** Dòng SystemConfig sẽ nạp: khoá được duyệt của seed.ts cộng các khoá bổ sung. */
export function selectReferenceConfigs(all: readonly ConfigSeed[]): ConfigSeed[] {
  const fromSeed = all.filter((c) => classifyConfigKey(c.key) === 'reference');
  const extras = EXTRA_CONFIGS.map(({ fallbackSource: _src, ...row }) => row);
  return [...fromSeed, ...extras];
}
