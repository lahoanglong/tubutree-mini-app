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
  checkIds: readonly string[];
  /** Biến môi trường bắt buộc đủ cả: API chỉ trả đã điền hay chưa, không trả giá trị. Biến chọn một trong hai thì không liệt kê ở đây. */
  envVars?: readonly string[];
}

/** Đúng 15 dòng WARN còn lại trên PROD sau w24-04 (go-live 55/15/0), xếp theo việc lâu nhất trước: mẫu ZNS chờ Zalo duyệt 7–14 ngày. */
export const HANDOVER_ITEMS: readonly HandoverDef[] = [
  {
    key: 'zns_templates',
    title: 'Mã mẫu ZNS do Zalo duyệt',
    owner: 'Chủ Zalo OA',
    guide: 'Đăng ký mẫu ZNS trên Zalo (duyệt 7–14 ngày, docs/GO-LIVE-KEYS.md mục 2 bước D), rồi nhập mã số Zalo cấp ở Quản trị › Mẫu thông báo.',
    checkIds: ['db.zns_templates'],
  },
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
    key: 'zalopay',
    title: 'Merchant ZaloPay',
    owner: 'Chủ shop (hợp đồng ZaloPay)',
    guide: 'Chỉ cần khi chủ shop quyết định bật ZaloPay (hai app đang ẩn ZaloPay). Lấy App ID, Key1, Key2 bản production (docs/GO-LIVE-KEYS.md mục 1).',
    checkIds: ['env.zalopay'],
    envVars: ['ZALOPAY_APP_ID', 'ZALOPAY_KEY1', 'ZALOPAY_KEY2'],
  },
  {
    key: 'accesstrade',
    title: 'Accesstrade (hoàn tiền mua sàn ngoài)',
    owner: 'Chủ shop (tài khoản Accesstrade)',
    guide: 'Lấy token API và publisher ID trong trang publisher Accesstrade (docs/GO-LIVE-KEYS.md mục 3). Chưa chạy hoàn tiền thì để sau.',
    checkIds: ['env.accesstrade.api'],
    envVars: ['ACCESSTRADE_TOKEN', 'ACCESSTRADE_PUBLISHER_ID'],
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
    guide: 'Tạo webhook Slack, Google Chat hoặc n8n rồi đặt URL; đặt OPS_ALERT_ENV_LABEL=production để báo động PROD không lẫn staging (docs/GO-LIVE-KEYS.md mục 8).',
    checkIds: ['env.ops.webhook', 'env.ops.label'],
    envVars: ['OPS_ALERT_WEBHOOK_URL', 'OPS_ALERT_ENV_LABEL'],
  },
  {
    key: 'cloudinary',
    title: 'Cloudinary cho ảnh khách tải lên',
    owner: 'Kỹ thuật (build Mini App)',
    guide: 'API không đọc khoá này. Xác nhận file build Mini App có VITE_CLOUDINARY_CLOUD_NAME và VITE_CLOUDINARY_UPLOAD_PRESET (preset unsigned).',
    checkIds: ['env.cloudinary'],
  },
  {
    key: 'backup_offsite',
    title: 'Backup hằng đêm ra ngoài máy chủ',
    owner: 'Kỹ thuật (VPS)',
    guide: 'Cài cron backup-db.sh với RCLONE_REMOTE và HEALTHCHECK_URL (tools/backup/README.md). API chạy trong container nên không đọc được cron: kiểm tay `crontab -l | grep backup-db` và `rclone lsd <remote>:` trên VPS.',
    checkIds: ['backup.script', 'backup.cron', 'backup.offsite', 'backup.healthcheck'],
  },
  {
    key: 'demo_coupons',
    title: 'Mã giảm giá demo',
    owner: 'Chủ shop (PO)',
    guide: 'Chốt tắt hay giữ từng mã demo ở Quản trị › Mã giảm giá trước giờ mở bán.',
    checkIds: ['db.demo_coupons'],
  },
];

export interface HandoverCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
}

export interface HandoverItem {
  key: string;
  title: string;
  owner: string;
  guide: string;
  /** "Đã cấu hình" khi mọi dòng kiểm của việc này đạt; thiếu dòng (bộ kiểm không chạy được) là "Chờ điền". */
  configured: boolean;
  /** Mức nặng nhất của các dòng, để tô màu (đỏ là đặt dở dang hoặc sai). */
  status: CheckStatus;
  vars: { name: string; configured: boolean }[];
  checks: HandoverCheck[];
}

export interface HandoverBoard {
  title: string;
  configured: number;
  total: number;
  items: HandoverItem[];
}

const isSet = (env: Env, name: string) => Boolean(env[name]?.trim());

export function buildHandover(results: readonly CheckResult[], env: Env): HandoverBoard {
  const byId = new Map(results.map((r) => [r.id, r]));
  const items = HANDOVER_ITEMS.map((def): HandoverItem => {
    const rows = def.checkIds.map((id) => byId.get(id)).filter((r): r is CheckResult => r !== undefined);
    const configured = rows.length > 0 && rows.every((r) => r.status === 'PASS');
    return {
      key: def.key,
      title: def.title,
      owner: def.owner,
      guide: def.guide,
      configured,
      status: rows.length === 0 ? 'WARN' : worstStatus(rows),
      vars: (def.envVars ?? []).map((name) => ({ name, configured: isSet(env, name) })),
      checks: rows.map((r) => ({ id: r.id, title: r.title, status: r.status, detail: r.detail })),
    };
  });
  return { title: HANDOVER_TITLE, configured: items.filter((i) => i.configured).length, total: items.length, items };
}
