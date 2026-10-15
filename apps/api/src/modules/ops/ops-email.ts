import { formatVnDateTime } from '../../common/vn-time';
import type { AlertMessage } from './ops-alerts';

export const OPS_EMAIL_APP_NAME = 'Tubu Tree';

export interface AlertEmailContext {
  appName: string;
  envLabel: string;
}

export interface AlertEmail {
  subject: string;
  text: string;
  html: string;
}

/** Một thông điệp sự cố dài hơn chừng này bị cắt: lỗi tự do từ Pancake/Redis có thể kèm cả thân phản hồi. */
const MESSAGE_MAX = 500;
const MIN_SECRET_LEN = 4;

/** Nhãn đặt tay (OPS_ALERT_ENV_LABEL) → NODE_ENV → development. */
export function emailEnvLabel(label: string | undefined, nodeEnv: string | undefined): string {
  return label?.trim() || nodeEnv?.trim() || 'development';
}

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
 * điện thoại, thông tin đăng nhập trong URL, khoá/token trước khi ra khỏi hệ thống. Mã đơn (TUBU…), #id Pancake và tên
 * hàng đợi không khớp các mẫu này nên giữ nguyên. Chuỗi dài giống khoá/token được che trước số điện thoại để một khoá có
 * lẫn dãy số không bị chẻ đôi, lộ nửa còn lại.
 */
export function redactSensitive(text: string): string {
  return maskPhones(
    text
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
      .replace(/\b(api[_-]?key|token|secret|password|passwd|authorization)\b(\s*[:=]\s*)\S+/gi, '$1$2***')
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

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const clip = (s: string) => (s.length > MESSAGE_MAX ? `${s.slice(0, MESSAGE_MAX - 1)}…` : s);
const safeMessage = (s: string) => clip(redactSensitive(s));

const subjectPrefix = (ctx: AlertEmailContext) => `[${ctx.appName} · ${ctx.envLabel}]`;
const WHERE_TO_HANDLE = 'vào trang quản trị Tubu Tree → mục "Sức khoẻ hệ thống"';
const FOOTER = 'Email tự động từ hệ thống vận hành, vui lòng không trả lời.';

type Block = { p: string; small?: boolean } | { ul: string[] };

function page(title: string, blocks: Block[]): string {
  const body = blocks.map((b) => {
    if ('ul' in b) return `<ul style="margin:0 0 12px;padding-left:20px">${b.ul.map((x) => `<li style="margin:0 0 6px">${escapeHtml(x)}</li>`).join('')}</ul>`;
    return `<p style="${b.small ? 'margin:0 0 6px;font-size:12px;color:#57534e' : 'margin:0 0 12px'}">${escapeHtml(b.p)}</p>`;
  });
  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1c1917">',
    `<h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(title)}</h2>`,
    ...body,
    '</div>',
  ].join('');
}

/** Email cho đúng một lần báo của webhook: sự cố (ALERT) hoặc đã ổn (RECOVERED). */
export function alertEmail(m: AlertMessage, ctx: AlertEmailContext): AlertEmail {
  const checkedAt = `Kiểm lúc ${formatVnDateTime(new Date(m.generatedAt))} (giờ Việt Nam).`;
  if (m.status === 'RECOVERED') {
    const summary = safeMessage(m.summary);
    const where = `Xem lại tình trạng: ${WHERE_TO_HANDLE}.`;
    return {
      subject: `${subjectPrefix(ctx)} Vận hành đã ổn trở lại`,
      text: [m.title, '', summary, '', where, '', checkedAt, FOOTER].join('\n'),
      html: page(m.title, [{ p: summary }, { p: where }, { p: checkedAt, small: true }, { p: FOOTER, small: true }]),
    };
  }
  const n = m.problems.length;
  const intro = `${ctx.appName} (${ctx.envLabel}) đang có ${n} vấn đề vượt ngưỡng:`;
  const bullets = m.problems.map((p) => safeMessage(p.message));
  const where = `Cách xử lý: ${WHERE_TO_HANDLE} để xem đủ danh sách, chạy lại webhook lỗi hoặc đánh dấu đã xử lý.`;
  const repeat = 'Sự cố chưa hết sẽ được nhắc lại theo chu kỳ cài đặt ở Cấu hình → ops.';
  return {
    subject: `${subjectPrefix(ctx)} Sự cố vận hành: ${n} vấn đề cần xử lý`,
    text: [m.title, '', intro, ...bullets.map((b) => `• ${b}`), '', where, repeat, '', checkedAt, FOOTER].join('\n'),
    html: page(m.title, [{ p: intro }, { ul: bullets }, { p: where }, { p: repeat }, { p: checkedAt, small: true }, { p: FOOTER, small: true }]),
  };
}

/** Email thử (hành động admin): không mang dữ liệu sự cố. */
export function testEmail(ctx: AlertEmailContext, now: Date): AlertEmail {
  const title = 'Email thử báo động vận hành';
  const body = `Đây là email thử từ ${ctx.appName} (${ctx.envLabel}). Đọc được email này nghĩa là kênh email báo động vận hành đã hoạt động; sự cố thật sẽ được gửi tới đúng các địa chỉ nhận này.`;
  const sentAt = `Gửi lúc ${formatVnDateTime(now)} (giờ Việt Nam).`;
  return {
    subject: `${subjectPrefix(ctx)} ${title}`,
    text: [title, '', body, '', sentAt, FOOTER].join('\n'),
    html: page(title, [{ p: body }, { p: sentAt, small: true }, { p: FOOTER, small: true }]),
  };
}
