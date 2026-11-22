import { formatVnDateTime } from '../../common/vn-time';
import type { AlertMessage } from './ops-alerts';
import { clipText, OPS_ALERT_LINE_MAX, opsText, redactSensitive, scrubSecrets } from './ops-alert-line';

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

/**
 * Gạch đầu dòng email dùng cùng giới hạn với webhook/in-app: lời sự cố đã được rút gọn ở nơi tạo (ops-alert-line), đây chỉ là lưới an
 * toàn cho lỗi tự do (Pancake/Redis) lọt vào dài.
 */
const MESSAGE_MAX = OPS_ALERT_LINE_MAX;

/** Nhãn đặt tay (OPS_ALERT_ENV_LABEL) → NODE_ENV → development. */
export function emailEnvLabel(label: string | undefined, nodeEnv: string | undefined): string {
  return label?.trim() || nodeEnv?.trim() || 'development';
}

export { redactSensitive, scrubSecrets };

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const safeMessage = (s: string) => clipText(opsText(s), MESSAGE_MAX);

const subjectPrefix = (ctx: AlertEmailContext) => `[${ctx.appName} · ${ctx.envLabel}]`;
const WHERE_TO_HANDLE = 'vào trang quản trị Tubu Tree → mục "Sức khoẻ hệ thống"';
const FOOTER = 'Email tự động từ hệ thống vận hành, không cần trả lời.';

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
