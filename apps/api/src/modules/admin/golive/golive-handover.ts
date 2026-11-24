import type { CheckResult, CheckStatus, Env } from '../../../config/go-live/types';
import { worstStatus } from './golive-cards';

export const HANDOVER_TITLE = 'Cấu hình bên thứ 3 chờ bàn giao Go-Live';

/**
 * Một việc bàn giao: khoá hay quyết định do người ngoài đội kỹ thuật đưa (chủ OA, chủ shop, Accesstrade, người trực VPS). Trạng thái lấy từ
 * đúng các dòng của `go-live:check`, nên bảng này và lệnh chạy trên máy chủ không bao giờ nói khác nhau.
 */
interface HandoverDef {
  key: string;
  title: string;
  /** Ai đưa giá trị hoặc chốt quyết định. */
  owner: string;
  /** Lấy ở đâu, đặt ở đâu. Chỉ tên biến và đường dẫn, không bao giờ có giá trị. */
  guide: string;
  /** Dòng quyết định việc xong hay chưa. */
  checkIds: readonly string[];
  /** Dòng chỉ để xem, không giữ việc ở "Chờ điền" (vd nhãn môi trường báo động: tài liệu ghi tuỳ chọn, PROD để trống). */
  infoCheckIds?: readonly string[];
  /** Biến môi trường bắt buộc đủ cả: API chỉ trả đã điền hay chưa, không trả giá trị. Biến chọn một trong hai thì không liệt kê ở đây. */
  envVars?: readonly string[];
  optionalEnvVars?: readonly string[];
  /**
   * `host`: API trong container không kiểm được (cron, rclone, biến build Mini App), dòng vàng "không kiểm được" là bình thường nên hiện
   * "Kiểm tay" chứ không "Chờ điền". `optional`: chủ quyết có làm hay không (mẫu ZNS tính phí từng tin). `later`: kênh ngày mở bán không dùng
   * (bán bằng chuyển khoản VietQR và COD), nằm ở nhóm "Tuỳ chọn (Mở sau)". Cả ba không vào bộ đếm bắt buộc.
   */
  kind?: 'required' | 'host' | 'optional' | 'later';
  /** Dòng vàng cũng tính là đã chốt: mã demo chủ dự án duyệt giữ (GO_LIVE_ACCEPT_DEMO_COUPONS) ra vàng, chưa duyệt ra đỏ. */
  warnIsSettled?: boolean;
}

/** Đúng 15 dòng WARN còn lại trên PROD sau w24-04 (go-live 55/15/0): việc bắt buộc trước, rồi việc kiểm tay và tuỳ chọn, cuối cùng nhóm mở sau. */
export const HANDOVER_ITEMS: readonly HandoverDef[] = [
  {
    key: 'zalo_oa',
    title: 'Zalo OA gửi tin ZNS',
    owner: 'Chủ Zalo OA',
    guide: 'Lấy OA ID, access token và refresh token ở developers.zalo.me (docs/GO-LIVE-KEYS.md mục 2 bước A–C). Kỹ thuật dán vào .env của api rồi tạo lại container.',
    checkIds: ['env.zalo.oa'],
    envVars: ['ZALO_OA_ID', 'ZALO_OA_ACCESS_TOKEN', 'ZALO_OA_REFRESH_TOKEN'],
  },
  {
    key: 'zalo_oa_webhook',
    title: 'Khoá webhook OA (tin nhắn CSKH)',
    owner: 'Chủ Zalo OA',
    guide: 'Nên dùng ZALO_OA_SECRET_KEY (khoá bí mật OA ở developers.zalo.me, mục webhook) để bật chữ ký; chưa có thì đặt token tĩnh ZALO_OA_WEBHOOK_SECRET (docs/GO-LIVE-KEYS.md mục 5).',
    checkIds: ['env.zalo.oa_webhook_secret'],
  },
  {
    key: 'zalo_open_api',
    title: 'API Key webhook Mini App (rút đồng ý, xoá dữ liệu)',
    owner: 'Chủ Mini App Zalo',
    guide: 'Lấy ở mini.zalo.me/developers › Open APIs. Đặt và deploy TRƯỚC khi lưu Webhook URL trên console; Zalo đòi có Webhook URL trước khi gửi duyệt Mini App.',
    checkIds: ['env.zalo.open_api_key'],
    envVars: ['ZALO_OPEN_API_KEY'],
  },
  {
    key: 'phone_hmac',
    title: 'Khoá mã băm số điện thoại',
    owner: 'Kỹ thuật (máy chủ)',
    guide: 'Sinh bằng `openssl rand -hex 32`, đặt trong .env của api ngoài khung Giờ vàng. Đặt rồi giữ nguyên, không xoay như khoá JWT.',
    checkIds: ['env.phone_hmac'],
    envVars: ['PHONE_HMAC_SECRET'],
  },
  {
    key: 'ops_alerts',
    title: 'Báo động ra ngoài app',
    owner: 'Kỹ thuật và người trực',
    guide:
      'Tạo webhook Slack, Google Chat hoặc n8n rồi đặt OPS_ALERT_WEBHOOK_URL; chưa đặt thì báo động chỉ hiện ở màn Sức khoẻ hệ thống (và email nếu đã bật). OPS_ALERT_ENV_LABEL tuỳ chọn: PROD để trống (lấy theo NODE_ENV), chỉ staging chạy NODE_ENV=production mới cần đặt (docs/GO-LIVE-KEYS.md mục 8).',
    checkIds: ['env.ops.webhook'],
    infoCheckIds: ['env.ops.label'],
    envVars: ['OPS_ALERT_WEBHOOK_URL'],
    optionalEnvVars: ['OPS_ALERT_ENV_LABEL'],
  },
  {
    key: 'cloudinary',
    title: 'Cloudinary cho ảnh khách tải lên',
    owner: 'Kỹ thuật (build Mini App)',
    guide: 'API không đọc khoá này. Xác nhận file build Mini App có VITE_CLOUDINARY_CLOUD_NAME và VITE_CLOUDINARY_UPLOAD_PRESET (preset unsigned).',
    checkIds: ['env.cloudinary'],
    kind: 'host',
  },
  {
    key: 'backup_offsite',
    title: 'Backup hằng đêm ra ngoài máy chủ',
    owner: 'Kỹ thuật (VPS)',
    guide:
      'Cài cron backup-db.sh với RCLONE_REMOTE và HEALTHCHECK_URL (tools/backup/README.md). RCLONE_REMOTE phải là remote rclone kiểu `crypt`: remote thường thì script không đẩy bản backup và thoát mã 3. API chạy trong container nên không đọc được cron: kiểm tay `crontab -l | grep backup-db` và `rclone lsd <remote>:` trên VPS.',
    checkIds: ['backup.script', 'backup.cron', 'backup.offsite', 'backup.healthcheck'],
    kind: 'host',
  },
  {
    key: 'demo_coupons',
    title: 'Mã giảm giá demo',
    owner: 'Chủ shop (PO)',
    guide:
      'Chốt từng mã demo trước giờ mở bán. Không giữ: kỹ thuật chạy dọn mã demo (lệnh trong dòng kiểm đỏ). Giữ: kỹ thuật thêm mã vào GO_LIVE_ACCEPT_DEMO_COUPONS (dòng thành vàng, coi là đã chốt), rồi xác nhận điều kiện mã ở Quản trị › Mã giảm giá.',
    checkIds: ['db.demo_coupons'],
    warnIsSettled: true,
  },
  {
    key: 'zns_templates',
    title: 'Mã mẫu ZNS do Zalo duyệt',
    owner: 'Chủ shop (quyết) và chủ Zalo OA',
    guide:
      'Đợt này không nộp mẫu ORDER_CONFIRMED và ORDER_SHIPPING: chưa có mã thì hai tin đó chỉ gửi trong app. Muốn gửi ZNS thì chủ shop quyết riêng (mỗi tin ZNS tính phí), đăng ký mẫu trên Zalo (duyệt 7–14 ngày, docs/GO-LIVE-KEYS.md mục 2 bước D), rồi nhập mã số Zalo cấp ở Quản trị › Mẫu thông báo.',
    checkIds: ['db.zns_templates'],
    kind: 'optional',
  },
  {
    key: 'zalopay',
    title: 'Merchant ZaloPay',
    owner: 'Chủ shop (hợp đồng ZaloPay)',
    guide: 'Chỉ cần khi chủ shop quyết định bật ZaloPay (hai app đang ẩn ZaloPay). Lấy App ID, Key1, Key2 bản production (docs/GO-LIVE-KEYS.md mục 1).',
    checkIds: ['env.zalopay'],
    envVars: ['ZALOPAY_APP_ID', 'ZALOPAY_KEY1', 'ZALOPAY_KEY2'],
    kind: 'later',
  },
  {
    key: 'accesstrade',
    title: 'Accesstrade (hoàn tiền mua sàn ngoài)',
    owner: 'Chủ shop (tài khoản Accesstrade)',
    guide: 'Lấy token API và publisher ID trong trang publisher Accesstrade (docs/GO-LIVE-KEYS.md mục 3). Chưa chạy hoàn tiền thì để sau.',
    checkIds: ['env.accesstrade.api'],
    envVars: ['ACCESSTRADE_TOKEN', 'ACCESSTRADE_PUBLISHER_ID'],
    kind: 'later',
  },
];

export interface HandoverCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
}

/** `configured` Đã cấu hình, `pending` Chờ điền, `host` Kiểm tay trên máy chủ, `optional` Tuỳ chọn (chủ quyết), `later` Mở sau. */
export type HandoverState = 'configured' | 'pending' | 'host' | 'optional' | 'later';

/** Tên nhóm việc ngày mở bán không cần (PO A2.2, 24/11/2026): ngày đầu bán bằng chuyển khoản VietQR và COD. */
export const HANDOVER_LATER_TITLE = 'Tuỳ chọn (Mở sau)';

export interface HandoverItem {
  key: string;
  title: string;
  owner: string;
  guide: string;
  state: HandoverState;
  /** Chỉ việc bắt buộc mới vào bộ đếm của thẻ. */
  required: boolean;
  /** `later`: hiện ở nhóm "Tuỳ chọn (Mở sau)" dưới danh sách chính, dù đã cấu hình hay đặt dở. */
  group: 'launch' | 'later';
  /** `state === 'configured'`. Thiếu dòng (bộ kiểm không chạy được) không bao giờ là đã cấu hình. */
  configured: boolean;
  /** Mức nặng nhất của các dòng quyết định, để tô màu (đỏ là đặt dở dang hoặc sai). */
  status: CheckStatus;
  vars: { name: string; configured: boolean; optional: boolean }[];
  checks: HandoverCheck[];
}

export interface HandoverBoard {
  title: string;
  /** Số việc bắt buộc đã cấu hình. */
  configured: number;
  /** Số việc bắt buộc; việc kiểm tay, tuỳ chọn và mở sau không tính. */
  total: number;
  /** Tên nhóm của các việc `group === 'later'`. */
  laterTitle: string;
  items: HandoverItem[];
}

const isSet = (env: Env, name: string) => Boolean(env[name]?.trim());

function stateOf(def: HandoverDef, rows: readonly CheckResult[]): HandoverState {
  const settled = rows.length > 0 && rows.every((r) => r.status === 'PASS' || (def.warnIsSettled === true && r.status === 'WARN'));
  if (settled) return 'configured';
  if (rows.some((r) => r.status === 'FAIL')) return 'pending';
  if (def.kind === 'host') return 'host';
  if (def.kind === 'optional') return 'optional';
  if (def.kind === 'later') return 'later';
  return 'pending';
}

export function buildHandover(results: readonly CheckResult[], env: Env): HandoverBoard {
  const byId = new Map(results.map((r) => [r.id, r]));
  const pick = (ids: readonly string[] | undefined) => (ids ?? []).map((id) => byId.get(id)).filter((r): r is CheckResult => r !== undefined);
  const items = HANDOVER_ITEMS.map((def): HandoverItem => {
    const rows = pick(def.checkIds);
    const state = stateOf(def, rows);
    return {
      key: def.key,
      title: def.title,
      owner: def.owner,
      guide: def.guide,
      state,
      required: (def.kind ?? 'required') === 'required',
      group: def.kind === 'later' ? 'later' : 'launch',
      configured: state === 'configured',
      status: rows.length === 0 ? 'WARN' : worstStatus(rows),
      vars: [
        ...(def.envVars ?? []).map((name) => ({ name, configured: isSet(env, name), optional: false })),
        ...(def.optionalEnvVars ?? []).map((name) => ({ name, configured: isSet(env, name), optional: true })),
      ],
      checks: [...rows, ...pick(def.infoCheckIds)].map((r) => ({ id: r.id, title: r.title, status: r.status, detail: r.detail })),
    };
  });
  const required = items.filter((i) => i.required);
  return { title: HANDOVER_TITLE, configured: required.filter((i) => i.configured).length, total: required.length, laterTitle: HANDOVER_LATER_TITLE, items };
}
