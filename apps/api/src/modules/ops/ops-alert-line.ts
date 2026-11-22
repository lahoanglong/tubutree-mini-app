/**
 * Lời báo động vận hành gửi người (in-app, webhook Slack/Google Chat, email): một dòng ngắn
 * `[Cảnh báo] <Tên ngắn> · <số lượng / mã đơn> · <chỗ xử lý trong trang quản trị>`, không quá OPS_ALERT_LINE_MAX ký tự.
 * Người trực đọc trên điện thoại: chi tiết dài (lỗi tự do của Pancake/Gomdon, cách sửa từng bước) nằm ở màn admin mà dòng chỉ tới,
 * còn lệnh, biến môi trường và đường dẫn API chỉ ghi vào log cho kỹ thuật.
 */

/** Một dòng báo động đứng riêng (một gạch đầu dòng của webhook/email, phần tóm tắt in-app). */
export const OPS_ALERT_LINE_MAX = 180;
/** Cả tin in-app sau khi điền mẫu (tiền tố của mẫu + phần lời). */
export const OPS_NOTICE_MAX = 200;
/**
 * Phần lời điền vào mẫu có sẵn tiền tố ("⚠️ Đơn {{order_code}} cần xử lý (Pancake): {{message}}", "💸 Hoàn tiền đơn …"): tiền tố dài nhất
 * cộng mã đơn 17 ký tự (TUBU2026101500001) là 46 ký tự, nên phần lời giữ ở đây thì cả tin không quá OPS_NOTICE_MAX.
 */
export const OPS_ALERT_SLOT_MAX = 150;

/** Chỗ xử lý: tên mục đúng như trên menu trang quản trị web, hoặc việc chuyển cho kỹ thuật khi admin không tự sửa được. */
export const OPS_WHERE = {
  health: 'Admin › Sức khoẻ hệ thống',
  cron: 'Admin › Sức khoẻ hệ thống › Tác vụ nền',
  mss: 'Admin › Sức khoẻ hệ thống › MSS',
  pancakeQueue: 'Admin › Đơn hàng › Cần xử lý Pancake',
  /** Thẻ "Pancake báo đã thanh toán…" của tab Hôm nay (đơn chưa gắn đúng đơn Pancake, chờ đối chiếu sao kê): không nằm ở hàng Pancake. */
  paymentUnlinked: 'Admin › Hôm nay › Pancake báo đã thanh toán',
  gomdonQueue: 'Admin › Đơn hàng › Cần xử lý thu gom',
  waste: 'Admin › Đổi rác',
  refunds: 'Admin › Hoàn tiền khách',
  refundsUnverified: 'Admin › Hoàn tiền khách › Chờ đối soát',
  resync: 'Admin › chi tiết đơn › Chạy lại việc sau giao',
  tech: 'Báo đội kỹ thuật',
} as const;

export type OpsAlertTone = 'ALERT' | 'OK';
const TONE_TAG: Record<OpsAlertTone, string> = { ALERT: '[Cảnh báo]', OK: '[Ổn]' };
const SEP = ' · ';
const MIN_SECRET_LEN = 4;

const PHONE_MASK = '[số điện thoại đã ẩn]';
/** 0 hoặc 84/+84, rồi 8-10 chữ số (cho phép cách bằng dấu cách, chấm, gạch). Không bắt đầu giữa một dãy số dài hơn. */
const PHONE_RE = /(?<!\d)(?:\+?84|0)(?:[ .-]?\d){8,10}(?!\d)/g;
/** Mã đơn sinh ra: TUBU + ngày + 5 số, TUBUSUB + 7 số epoch + 3 số — phần số của chúng có thể bắt đầu bằng 0. */
const ORDER_CODE_PREFIX = /TUBU(?:SUB)?$/i;
/** Đầu số quốc gia sau 0/84 của số Việt Nam hiện hành: 2 (bàn), 3, 5, 7, 8, 9 (di động). */
const VN_NATIONAL_START = /^[235789]/;

/**
 * Che số điện thoại Việt Nam bất kể ký tự đứng trước ("SĐT0912345678" cũng bị che). Dính liền chữ cái thì chỉ che khi đúng
 * đầu số Việt Nam và không phải phần số của mã đơn (TUBU…/TUBUSUB… có thể có phần số bắt đầu bằng 0): che thừa một mã đơn
 * làm người vận hành không tra được đơn, nên các dãy khác thì giữ nguyên.
 */
function maskPhones(text: string): string {
  return text.replace(PHONE_RE, (m, offset: number) => {
    const before = text.slice(0, offset);
    if (/[\p{L}_]$/u.test(before)) {
      if (ORDER_CODE_PREFIX.test(before)) return m;
      const digits = m.replace(/\D/g, '');
      const national = digits.startsWith('84') ? digits.slice(2) : digits.slice(1);
      if (!VN_NATIONAL_START.test(national)) return m;
    }
    return PHONE_MASK;
  });
}

/**
 * Lời báo động chỉ mang mã đơn và số lượng, nhưng vài thông điệp chứa lỗi tự do (đồng bộ danh mục, hàng đợi) — che số
 * điện thoại, thông tin đăng nhập trong URL, khoá/token (cả tên có tiền tố như refresh_token, client_secret và dạng JSON "password":"…")
 * trước khi ra khỏi hệ thống. Mã đơn (TUBU…), #id Pancake và tên
 * hàng đợi không khớp các mẫu này nên giữ nguyên. Chuỗi dài giống khoá/token được che trước số điện thoại để một khoá có
 * lẫn dãy số không bị chẻ đôi, lộ nửa còn lại.
 */
export function redactSensitive(text: string): string {
  return maskPhones(
    text
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
      .replace(/((?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|token|secret|password|passwd|authorization))("?\s*[:=]\s*"?)[^\s",}]+/gi, '$1$2***')
      .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '***'),
  );
}

/** Thay mọi giá trị bí mật đã biết (tài khoản/mật khẩu SMTP) trong chuỗi lỗi; giá trị quá ngắn bỏ qua để không phá chữ thường. */
export function scrubSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    const v = s.trim();
    if (v.length >= MIN_SECRET_LEN) out = out.split(v).join('***');
  }
  return out;
}

/** URL đầy đủ chỉ còn tên máy (đường dẫn, query mang id cửa hàng hay khoá thì bỏ); phần đăng nhập trong URL cũng bỏ. */
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s/@]*@)?([^\s/?#@]+)\S*/gi;
/** "POST /admin/orders/<mã>/resync-delivered-effects": cách gọi API của kỹ thuật, không phải việc admin làm được. */
const METHOD_PATH_RE = /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S*/g;
/** Đường dẫn API trần (/admin/…, /api/…, /internal/…, /webhooks/…, /health) đứng một mình trong lời. */
const BARE_PATH_RE = /(?<![\w.~-])\/(?:admin|api|internal|webhooks?|health|v\d+)(?:\/[^\s,;)]*)?/gi;

/** Lời tự do trước khi vào một dòng báo động: che bí mật, bỏ URL/đường dẫn API, gom khoảng trắng, bỏ dấu câu treo ở cuối. */
export function opsText(raw: string): string {
  return redactSensitive(raw)
    .replace(URL_RE, '$1')
    .replace(METHOD_PATH_RE, '')
    .replace(BARE_PATH_RE, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/[\s,;:—-]+$/u, '')
    .trim();
}

/**
 * Cắt còn tối đa `max` ký tự, kết thúc bằng "…": ưu tiên ranh câu (". ", " — ", "; ") nếu giữ được ít nhất nửa độ dài, không thì ranh
 * từ, để mã đơn không bị cắt giữa chừng.
 */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return '…'.slice(0, Math.max(0, max));
  const cut = text.slice(0, max - 1);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' — '), cut.lastIndexOf('; '));
  const space = cut.lastIndexOf(' ');
  const at = sentence >= max / 2 ? sentence : space >= max / 2 ? space : cut.length;
  return `${cut.slice(0, at).replace(/[\s,;:.—-]+$/u, '')}…`;
}

export interface OpsAlertLineParts {
  tone?: OpsAlertTone;
  /** Tên ngắn của sự việc ("Đơn chưa lên Pancake"). */
  name: string;
  /** Số lượng và vài mã đơn; phần này bị cắt trước khi dòng quá dài. */
  detail?: string;
  /** Chỗ xử lý, thường là một giá trị của OPS_WHERE. */
  where?: string;
  max?: number;
}

/** `[Cảnh báo] <tên> · <chi tiết> · <chỗ xử lý>`, đã che bí mật, không quá `max` (mặc định OPS_ALERT_LINE_MAX). */
export function opsAlertLine(p: OpsAlertLineParts): string {
  const max = p.max ?? OPS_ALERT_LINE_MAX;
  const head = `${TONE_TAG[p.tone ?? 'ALERT']} ${opsText(p.name)}`;
  const tail = p.where ? `${SEP}${opsText(p.where)}` : '';
  const detail = p.detail ? opsText(p.detail) : '';
  if (!detail) return clipText(`${head}${tail}`, max);
  const room = max - head.length - tail.length - SEP.length;
  if (room < 12) return clipText(`${head}${SEP}${detail}${tail}`, max);
  return `${head}${SEP}${clipText(detail, room)}${tail}`;
}

/**
 * Phần lời điền vào mẫu thông báo đã có tiêu đề/biểu tượng ("💸 Hoàn tiền đơn {{order_code}}: {{message}}"): `<chi tiết> · <chỗ xử lý>`,
 * không nhãn [Cảnh báo] vì mẫu đã có, không quá `max` (mặc định OPS_ALERT_SLOT_MAX).
 */
export function opsAlertSlot(detail: string, where?: string, max = OPS_ALERT_SLOT_MAX): string {
  const tail = where ? `${SEP}${opsText(where)}` : '';
  const body = opsText(detail);
  if (!body) return clipText(opsText(where ?? ''), max);
  return `${clipText(body, Math.max(12, max - tail.length))}${tail}`;
}
