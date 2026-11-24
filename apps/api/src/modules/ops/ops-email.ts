import { formatVndText } from '../../common/format-vnd';
import { formatVnDateTime } from '../../common/vn-time';
import { DIGEST_LOW_STOCK_MAX, DIGEST_STUCK_HOURS, digestDayLabel, type DailyDigest } from './daily-digest';
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

type Block = { p: string; small?: boolean } | { ul: string[] } | { h: string };

function page(title: string, blocks: Block[]): string {
  const body = blocks.map((b) => {
    if ('h' in b) return `<h3 style="margin:16px 0 6px;font-size:15px">${escapeHtml(b.h)}</h3>`;
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

const DIGEST_NAME_MAX = 60;
const DIGEST_TERM_MAX = 40;
const DIGEST_NO_DATA = 'Chưa đọc được số liệu mục này (lỗi truy vấn), xem trực tiếp trên trang quản trị.';
const DIGEST_WHERE = 'Xem chi tiết: trang quản trị Tubu Tree → "Báo cáo" (doanh thu), "Đơn hàng" và "Sức khoẻ hệ thống".';
const STUCK_STATUS_LABEL: Record<string, string> = { CONFIRMED: 'đã xác nhận', PACKED: 'đã đóng gói' };

const oneLine = (s: string, max: number) => clipText(s.replace(/\s+/g, ' ').trim(), max);
const more = (total: number, shown: number, unit: string): string[] => (total > shown ? [`Và ${total - shown} ${unit} khác.`] : []);

/**
 * Bản tin sáng cho chủ shop (DailyDigestService): đơn và doanh thu của ngày hôm qua, chuyển khoản còn chờ, đơn kẹt, hàng sắp hết, từ khoá
 * tìm không ra và số lỗi 5xx. Mục có số `null` (truy vấn lỗi) vẫn có tiêu đề kèm lời báo thiếu, để người đọc không tưởng là 0.
 */
export function dailyDigestEmail(d: DailyDigest, ctx: AlertEmailContext): AlertEmail {
  const dayLabel = digestDayLabel(d.day);
  const title = `Bản tin sáng: số liệu ngày ${dayLabel}`;
  const sections: Array<{ h: string; lines: string[] }> = [];

  const o = d.orders;
  sections.push({
    h: 'Đơn và doanh thu',
    lines: o
      ? [
          `Đơn đặt: ${o.placed} (nay đã huỷ hoặc trả: ${o.cancelled}).`,
          `Doanh thu đã thu: ${formatVndText(o.revenue)} từ ${o.paidOrders} đơn.`,
          `Giá trị đơn đang xử lý và đã giao: ${formatVndText(o.gmv)}.`,
        ]
      : [DIGEST_NO_DATA],
  });

  const u = d.unpaidTransfers;
  sections.push({
    h: 'Chuyển khoản chưa trả (lúc gửi bản tin)',
    lines: !u
      ? [DIGEST_NO_DATA]
      : u.count === 0
        ? ['Không có đơn nào chờ chuyển khoản.']
        : [
            `${u.count} đơn chờ chuyển khoản, tổng ${formatVndText(u.amount)}.`,
            ...u.oldest.map((x) => `${x.code}: ${formatVndText(x.total)}, đặt lúc ${formatVnDateTime(new Date(x.createdAt))}.`),
            ...more(u.count, u.oldest.length, 'đơn'),
          ],
  });

  const s = d.stuckOrders;
  sections.push({
    h: `Đơn kho Tubu kẹt quá ${DIGEST_STUCK_HOURS} giờ`,
    lines: !s
      ? [DIGEST_NO_DATA]
      : s.count === 0
        ? [`Không có đơn nào đã xác nhận hoặc đóng gói mà đứng yên quá ${DIGEST_STUCK_HOURS} giờ.`]
        : [
            `${s.count} đơn đã xác nhận hoặc đóng gói nhưng chưa giao cho vận chuyển sau ${DIGEST_STUCK_HOURS} giờ.`,
            ...s.oldest.map((x) => `${x.code}: ${STUCK_STATUS_LABEL[x.status] ?? x.status} từ ${formatVnDateTime(new Date(x.since))}.`),
            ...more(s.count, s.oldest.length, 'đơn'),
          ],
  });

  const l = d.lowStock;
  sections.push({
    h: `Hàng sắp hết (kho Tubu, tồn từ ${DIGEST_LOW_STOCK_MAX} trở xuống)`,
    lines: !l
      ? [DIGEST_NO_DATA]
      : l.count === 0
        ? ['Không có mã hàng nào.']
        : [
            `${l.count} mã hàng, trong đó ${l.outOfStock} mã đã hết.`,
            ...l.items.map((x) => `${oneLine(x.name, DIGEST_NAME_MAX)} (${x.sku}): còn ${x.stock}.`),
            ...more(l.count, l.items.length, 'mã'),
          ],
  });

  const z = d.zeroResults;
  sections.push({
    h: 'Từ khoá khách tìm không ra',
    lines: !z ? [DIGEST_NO_DATA] : z.length === 0 ? ['Không có lượt tìm nào ra trống.'] : z.map((x) => `"${oneLine(x.term, DIGEST_TERM_MAX)}": ${x.count} lượt.`),
  });

  const e = d.serverErrors;
  sections.push({
    h: 'Lỗi máy chủ (5xx)',
    lines: e === null ? [DIGEST_NO_DATA] : e === 0 ? ['Không có lượt nào.'] : [`${e} lượt trả lỗi 5xx. Chi tiết lỗi xem ở log máy chủ hoặc Sentry.`],
  });

  const sentAt = `Gửi lúc ${formatVnDateTime(new Date(d.generatedAt))} (giờ Việt Nam). Bản tin tự gửi lúc 8:00 mỗi sáng tới địa chỉ nhận báo động vận hành.`;
  const subject = o
    ? `${subjectPrefix(ctx)} Bản tin sáng ${dayLabel.slice(0, 5)}: ${o.placed} đơn, doanh thu ${formatVndText(o.revenue)}`
    : `${subjectPrefix(ctx)} Bản tin sáng ${dayLabel.slice(0, 5)}`;
  const text = [title, ...sections.flatMap((x) => ['', x.h, ...x.lines.map((line) => `• ${line}`)]), '', DIGEST_WHERE, '', sentAt, FOOTER].join('\n');
  const blocks: Block[] = [
    ...sections.flatMap((x): Block[] => [{ h: x.h }, { ul: x.lines }]),
    { p: DIGEST_WHERE },
    { p: sentAt, small: true },
    { p: FOOTER, small: true },
  ];
  return { subject, text, html: page(title, blocks) };
}
