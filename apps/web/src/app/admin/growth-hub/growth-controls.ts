import { formatVnNumber } from '@tubutree/app-core/number-format';
import type { ConfigRow } from '@/lib/admin-client';

/**
 * Công tắc và ô số của Trung tâm tăng trưởng. Mọi khoá ghi qua PUT /admin/config chung, nên biên ở đây phải trùng biên máy chủ
 * (admin-config-rules.ts, SystemConfigService.RANGES, game-mini.settings.ts): lệch thì admin chỉ nhận lỗi của máy chủ, không ghi sai.
 */

export interface GrowthSwitch {
  kind: 'switch';
  key: string;
  label: string;
  description: string;
  /** Giá trị máy chủ dùng khi DB chưa có dòng. */
  fallback: boolean;
  /** Khoá do tính năng khác tạo. Chưa có dòng trong DB thì công tắc bị khoá và ghi "Chưa có trên hệ thống". */
  needsRow?: boolean;
  /** Chỉ có tác dụng khi công tắc chung này bật. */
  requires?: string;
  onWarning?: string;
  offWarning?: string;
}

export interface GrowthNumber {
  kind: 'number';
  key: string;
  label: string;
  hint: string;
  unit: string;
  /** Biên theo đơn vị hiển thị. */
  min: number;
  max: number;
  /** Giá trị máy chủ dùng khi DB chưa có dòng, theo đơn vị lưu. */
  fallback: number;
  /** Lưu dạng phân số, hiện dạng phần trăm (0,2 hiện 20). */
  percent?: boolean;
  /** Mức chuẩn PO đã chốt (đơn vị lưu); giá trị đang chạy khác mức này thì hiện nhãn "Khác mức chuẩn". */
  standard?: number;
  needsRow?: boolean;
}

/** "Điểm danh ngày" không có công tắc: luôn bật, chỉ chỉnh bảng điểm 7 ngày ở tab Cấu hình. */
export interface GrowthCheckin {
  kind: 'checkin';
  key: string;
  label: string;
}

export type GrowthControl = GrowthSwitch | GrowthNumber | GrowthCheckin;

export interface GrowthGroup {
  id: string;
  title: string;
  description: string;
  items: GrowthControl[];
}

export const MINI_MASTER_KEY = 'game.mini.enabled';
/** Khoá mốc Quà tặng dùng thử 0đ; tính năng quà theo mốc giỏ tạo dòng này. Tới lúc đó dòng hiện "Chưa có trên hệ thống". */
export const GIFT_TRIAL_MIN_ORDER_KEY = 'commerce.gift_trial_min_order';
export const GIFT_TRIAL_ENABLED_KEY = 'commerce.gift_trial_enabled';
export const GREEN_HOUR_KEY = 'flashsale.green_hour_enabled';
export const CHECKIN_POINTS_KEY = 'loyalty.checkin_points';

const WEB_ONLY = 'Chỉ chơi trên web; Mini App hiện một dòng dẫn sang tubutree.com.';
const NEEDS_MASTER = 'Chỉ mở với khách khi "Lượt chơi có thưởng" cũng bật.';

export const GROWTH_GROUPS: GrowthGroup[] = [
  {
    id: 'games',
    title: 'Game và Vườn Xanh',
    description: 'Bật hoặc tắt từng game với khách. Game có dưới 10 mục nội dung đang bật thì tự ẩn dù công tắc bật.',
    items: [
      {
        kind: 'switch',
        key: MINI_MASTER_KEY,
        label: 'Lượt chơi có thưởng (công tắc chung)',
        description: 'Mở các game mini có thưởng 💧 và Điểm Xanh. Tắt thì mọi game mini đóng; Chọn Chuẩn Xanh vẫn chơi được nhưng không thưởng.',
        fallback: false,
        onWarning: 'Khách bắt đầu chơi được những game đang bật bên dưới. Thưởng tính theo trần Điểm Xanh hằng ngày ở mục bên dưới.',
        offWarning: 'Mọi game mini đóng với khách ngay; ván đang chơi dở không được chấm. Điểm đã cộng được giữ nguyên.',
      },
      { kind: 'switch', key: 'game.mini.match.enabled', label: 'Ghép Cặp', description: `Ghép sản phẩm với công dụng. ${WEB_ONLY} ${NEEDS_MASTER}`, fallback: false, requires: MINI_MASTER_KEY },
      { kind: 'switch', key: 'game.mini.origin.enabled', label: 'Đoán Xuất Xứ', description: `Đoán vùng nguyên liệu của sản phẩm. ${WEB_ONLY} ${NEEDS_MASTER}`, fallback: false, requires: MINI_MASTER_KEY },
      { kind: 'switch', key: 'game.mini.basket.enabled', label: 'Giỏ Đúng Việc', description: `Chọn đúng 3 món cho một việc nhà. ${WEB_ONLY} ${NEEDS_MASTER}`, fallback: false, requires: MINI_MASTER_KEY },
      {
        kind: 'switch',
        key: 'game.matcher_enabled',
        label: 'Chọn Chuẩn Xanh',
        description: `Trả lời vài câu để ra bộ 2–4 món còn hàng, thêm cả bộ vào giỏ. ${WEB_ONLY} Có thưởng khi "Lượt chơi có thưởng" bật.`,
        fallback: false,
      },
      {
        kind: 'switch',
        key: 'game.mini.kitchen_swap.enabled',
        label: 'Căn Bếp Xanh',
        description: `Đổi đồ ở 3 góc nhà sang sản phẩm Tubu trong 45 giây, cuối ván có 3 sản phẩm để thêm vào giỏ dùng thử. Món nạp sẵn đang tắt: bật ít nhất 10 món (đủ 3 góc nhà) ở trang nội dung game thì game mới hiện. ${WEB_ONLY} ${NEEDS_MASTER}`,
        fallback: false,
        needsRow: true,
        requires: MINI_MASTER_KEY,
      },
      { kind: 'switch', key: 'game.mini.daily_quiz.enabled', label: 'Đố Xanh Mỗi Ngày', description: `3 câu đố mỗi ngày, chơi trên Mini App và web. ${NEEDS_MASTER}`, fallback: false, requires: MINI_MASTER_KEY },
      { kind: 'switch', key: 'game.mini.sort.enabled', label: 'Đúng Thùng', description: `Phân loại rác vào đúng thùng, chơi trên Mini App và web. ${NEEDS_MASTER}`, fallback: false, requires: MINI_MASTER_KEY },
      { kind: 'checkin', key: CHECKIN_POINTS_KEY, label: 'Điểm danh ngày' },
      {
        kind: 'switch',
        key: 'engagement.daily_missions_enabled',
        label: 'Nhiệm vụ ngày',
        description: `3 nhiệm vụ hằng ngày ở thẻ Nhiệm vụ của Vườn Xanh, thưởng tính chung trần của game mini. ${NEEDS_MASTER}`,
        fallback: false,
        requires: MINI_MASTER_KEY,
      },
    ],
  },
  {
    id: 'caps',
    title: 'Trần Điểm Xanh và 💧 hằng ngày',
    description: 'Máy chủ áp trần sau khi chấm ván: vượt trần thì ván vẫn chấm nhưng không cộng thêm.',
    items: [
      { kind: 'number', key: 'game.mini.points_daily_cap', label: 'Điểm Xanh tối đa mỗi khách mỗi ngày', hint: 'Từ mọi game mini và nhiệm vụ ngày cộng lại.', unit: 'Điểm Xanh', min: 0, max: 500, fallback: 100 },
      { kind: 'number', key: 'game.mini.global_points_daily_budget', label: 'Ngân sách Điểm Xanh toàn hệ thống mỗi ngày', hint: 'Hết ngân sách thì ván sau trong ngày chỉ còn 💧.', unit: 'Điểm Xanh', min: 0, max: 1_000_000, fallback: 200_000 },
      { kind: 'number', key: 'game.mini.water_daily_cap', label: '💧 tối đa mỗi khách mỗi ngày', hint: 'Giọt nước tưới cây ở Vườn Xanh.', unit: '💧', min: 0, max: 200, fallback: 40 },
      { kind: 'number', key: 'game.mini.rounds_per_game_per_day', label: 'Số ván có thưởng mỗi game mỗi ngày', hint: 'Đố Xanh luôn tối đa 1 ván có thưởng.', unit: 'ván', min: 0, max: 10, fallback: 2 },
    ],
  },
  {
    id: 'growth',
    title: 'Hộ chiếu Xanh, Mời bạn, Góc Sống Xanh, Giờ Xanh và tin Zalo',
    description: 'Các tính năng giữ chân khách và kết nối MSS.',
    items: [
      {
        kind: 'switch',
        key: 'eco.passport_enabled',
        label: 'Hộ chiếu Xanh',
        description: 'Trang tác động xanh của khách (chỉ web), tính từ đơn đã giao, Đổi rác và cây đã cam kết. Không phát điểm.',
        fallback: false,
        offWarning: 'Trang Hộ chiếu Xanh trả "Không tìm thấy" và lối vào ẩn. Không dữ liệu nào bị xoá.',
      },
      {
        kind: 'switch',
        key: 'referral.share_card_enabled',
        label: 'Mời bạn sống xanh: trang đích link mời',
        description: 'Link mời trỏ tubutree.com/moi/<mã>, khối mời hiện tiến độ bạn đã nhận mã và đã mua. Không đổi thưởng.',
        fallback: false,
        offWarning: 'Trang đích /moi/<mã> trả "Không tìm thấy", khối mời về lại link cũ.',
      },
      {
        kind: 'switch',
        key: 'reviews.green_corner_enabled',
        label: 'Góc Sống Xanh: đánh giá ảnh thật',
        description: 'Đánh giá có ảnh hoặc video chờ duyệt ở tab Đánh giá; duyệt xong cộng điểm theo ô "Thưởng đánh giá có ảnh thật" ở nhóm Kinh tế đơn hàng.',
        fallback: false,
        needsRow: true,
        onWarning: 'Đánh giá có ảnh chờ duyệt rồi mới hiện. Thưởng cũ lúc gửi đánh giá ngừng; đánh giá chỉ chữ không còn được cộng điểm.',
        offWarning: 'Đánh giá và thưởng về như cũ. Đánh giá đang chờ vẫn duyệt và thưởng được.',
      },
      {
        kind: 'switch',
        key: GREEN_HOUR_KEY,
        label: 'Giờ Xanh Ưu Đãi',
        description: 'Khối Giờ vàng ở Trang chủ và Ưu đãi đổi tên "Giờ Xanh Ưu Đãi", màu xanh, mỗi thẻ có nút ＋ thêm một chạm vào giỏ. Giá, suất và giới hạn mua giữ nguyên của Giờ vàng.',
        fallback: false,
        needsRow: true,
        onWarning: 'Khối Giờ vàng ở Trang chủ và Ưu đãi đổi sang Giờ Xanh Ưu Đãi ngay. Mini App cần bản có Giờ Xanh; bản cũ vẫn hiện Giờ vàng.',
        offWarning: 'Khối về lại Giờ vàng như cũ. Suất và giá không đổi.',
      },
      {
        kind: 'number',
        key: 'referral.referrer_reward_points',
        label: 'Thưởng người mời khi bạn được mời mua đơn thứ 2',
        hint: 'Cộng cho người mời khi đơn thứ 2 của bạn được mời giao thành công trong hạn của chương trình; thu lại nếu đơn bị trả.',
        unit: 'Điểm Xanh',
        min: 0,
        max: 100_000,
        fallback: 5_000,
      },
      {
        kind: 'switch',
        key: 'mss.customer_sync_enabled',
        label: 'MSS: đồng bộ khách cho tin Zalo',
        description: 'Gửi hồ sơ khách đã đồng ý nhận tin sang MSS. Chỉ chạy khi máy chủ đã cài kết nối MSS (Sức khoẻ hệ thống, thẻ Kết nối MSS).',
        fallback: false,
        onWarning: 'Hồ sơ khách đã đồng ý bắt đầu được gửi sang MSS. Máy chủ chưa cài kết nối MSS thì không gửi gì.',
        offWarning: 'Ngừng gửi hồ sơ khách sang MSS. Hồ sơ đã gửi vẫn nằm ở MSS.',
      },
      {
        kind: 'switch',
        key: 'mss.order_events_enabled',
        label: 'MSS: tin Zalo theo đơn',
        description: 'Gửi mốc đơn sang MSS để MSS nhắn Zalo cho khách đã đồng ý. Chỉ chạy khi máy chủ đã cài kết nối MSS.',
        fallback: false,
        onWarning: 'Mốc đơn mới bắt đầu được gửi sang MSS để nhắn Zalo cho khách đã đồng ý.',
        offWarning: 'Ngừng gửi mốc đơn sang MSS; khách không nhận tin Zalo theo đơn nữa.',
      },
    ],
  },
  {
    id: 'economy',
    title: 'Kinh tế đơn hàng',
    description: 'Mức chuẩn chốt ngày 18/11: miễn phí giao từ 199.000đ, quà dùng thử 0đ từ 299.000đ, +100 Điểm Xanh cho đánh giá có ảnh thật, trần dùng Điểm Xanh 20% tạm tính.',
    items: [
      {
        kind: 'number',
        key: 'shipping.free_threshold',
        label: 'Mốc miễn phí giao hàng',
        hint: 'Đơn có tạm tính từ mức này được miễn phí giao.',
        unit: 'đ',
        min: 0,
        max: 50_000_000,
        fallback: 199_000,
        standard: 199_000,
      },
      {
        kind: 'switch',
        key: GIFT_TRIAL_ENABLED_KEY,
        label: 'Quà tặng dùng thử 0đ',
        description: 'Đơn đạt mốc bên dưới thì Giỏ và Thanh toán hiện "Chọn quà tặng 0đ"; đơn có thêm một dòng quà 0đ, không đổi tiền, Điểm Xanh hay mã giảm giá. Danh sách quà sửa ở tab Cấu hình, khoá commerce.gift_trial_options.',
        fallback: false,
        needsRow: true,
        onWarning: 'Cần ít nhất một quà còn hàng ở commerce.gift_trial_options, và Mini App đã lên bản có ô chọn quà. Thiếu quà thì khách không thấy gì.',
        offWarning: 'Giỏ và Thanh toán thôi hiện quà. Đơn đã đặt vẫn giữ dòng quà 0đ.',
      },
      {
        kind: 'number',
        key: GIFT_TRIAL_MIN_ORDER_KEY,
        label: 'Mốc mở quà tặng dùng thử 0đ',
        hint: 'Đơn có tạm tính từ mức này được chọn một quà dùng thử 0đ.',
        unit: 'đ',
        min: 0,
        max: 50_000_000,
        fallback: 299_000,
        standard: 299_000,
        needsRow: true,
      },
      {
        kind: 'number',
        key: 'reviews.photo_reward_points',
        label: 'Thưởng đánh giá có ảnh thật (Góc Sống Xanh)',
        hint: 'Cộng khi admin duyệt đánh giá có ảnh, mỗi dòng đơn một lần.',
        unit: 'Điểm Xanh',
        min: 0,
        max: 20_000,
        fallback: 100,
        standard: 100,
        needsRow: true,
      },
      {
        kind: 'number',
        key: 'loyalty.max_redeem_pct',
        label: 'Trần giảm voucher + Điểm Xanh mỗi đơn',
        hint: 'Phần trăm tạm tính đơn được giảm bằng voucher và Điểm Xanh cộng lại (mã lấy trước, Điểm Xanh lấy phần còn lại). Giỏ hàng, thanh toán và máy chủ cùng đọc mức này. Tối đa 20%.',
        unit: '%',
        min: 0,
        max: 20,
        fallback: 0.2,
        percent: true,
        standard: 0.2,
      },
    ],
  },
];

export function findRow(rows: ConfigRow[] | undefined, key: string): ConfigRow | undefined {
  return rows?.find((r) => r.key === key);
}

/** Cờ chỉ bật với đúng `true`, như máy chủ (`readFlag` nhận thêm chuỗi 'true' của admin cũ). */
export function switchOn(rows: ConfigRow[] | undefined, item: GrowthSwitch): boolean {
  const row = findRow(rows, item.key);
  if (!row) return item.fallback;
  return row.value === true || row.value === 'true';
}

/** Giá trị đang chạy theo đơn vị lưu; giá trị hỏng (không phải số) thì null để UI báo, không đoán. */
export function numberValue(rows: ConfigRow[] | undefined, item: GrowthNumber): number | null {
  const row = findRow(rows, item.key);
  if (!row) return item.fallback;
  return typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : null;
}

/** Đơn vị lưu → chuỗi trong ô nhập ("199000", "20"). */
export function toInput(item: GrowthNumber, stored: number | null): string {
  if (stored == null) return '';
  return item.percent ? String(Math.round(stored * 1000) / 10) : String(stored);
}

/**
 * Chuỗi trong ô nhập → giá trị lưu, hoặc câu lỗi. Nhận "199.000", "199 000", "199000đ"; phần trăm nhận một chữ số thập phân ("12,5").
 * Số đồng, điểm, ván luôn là số nguyên vì máy chủ chặn số lẻ.
 */
export function parseInput(item: GrowthNumber, raw: string): { value?: number; error?: string } {
  const range = `${formatVnNumber(item.min)}–${formatVnNumber(item.max)}`;
  if (item.percent) {
    const t = raw.replace(/[%\s]/g, '').replace(',', '.');
    const n = Number(t);
    // So có dung sai: 1.1 * 10 = 11.000000000000002 trong JS.
    if (!t || !Number.isFinite(n) || n < item.min || n > item.max || Math.abs(n * 10 - Math.round(n * 10)) > 1e-9) {
      return { error: `Nhập phần trăm ${range}, tối đa một chữ số thập phân.` };
    }
    return { value: Math.round(n * 10) / 1000 };
  }
  const digits = raw.replace(/[.\s,đ]/g, '');
  const n = Number(digits);
  if (!digits || !/^\d+$/.test(digits) || n < item.min || n > item.max) {
    return { error: `Nhập số nguyên ${range} ${item.unit}.` };
  }
  return { value: n };
}

/** "199.000đ", "20%", "100 Điểm Xanh". */
export function formatStored(item: GrowthNumber, stored: number): string {
  if (item.percent) return `${toInput(item, stored).replace('.', ',')}%`;
  if (item.unit === 'đ') return `${formatVnNumber(stored)}đ`;
  return `${formatVnNumber(stored)} ${item.unit}`;
}

/** Tổng điểm 7 ngày điểm danh; bảng hỏng thì null. */
export function checkinWeekTotal(rows: ConfigRow[] | undefined): number | null {
  const v = findRow(rows, CHECKIN_POINTS_KEY)?.value;
  if (!Array.isArray(v) || v.length !== 7 || !v.every((x) => typeof x === 'number')) return null;
  return (v as number[]).reduce((s, x) => s + x, 0);
}
