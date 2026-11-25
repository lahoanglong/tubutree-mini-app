import { formatVndDigits } from '../../../common/format-vnd';

/**
 * Email xác nhận đơn dự phòng khi tin Zalo của MSS không tới khách (PO A3, wave tubu-w38-01). Hàm thuần: không đọc DB, không gửi.
 * Không pixel theo dõi, không SĐT, không địa chỉ: chỉ mã đơn, món, tổng tiền, cách trả, link xem đơn và lời mời kết bạn Zalo Tubu Tree.
 */

/** `templateCode` của dòng `notification_logs` kênh EMAIL. Hộp tin trong app chỉ đọc kênh INAPP nên dòng này không hiện ở chuông. */
export const ORDER_CONFIRM_EMAIL_TEMPLATE = 'ORDER_CONFIRM_EMAIL';
export const ORDER_EMAIL_CHANNEL = 'EMAIL';
/** Một email mỗi đơn: tin đặt đơn và tin đã nhận tiền cùng rơi vào đường lui chỉ gửi một. */
export const orderEmailDedupeKey = (code: string) => `order-email:${code}`;

/** Số dòng món tối đa trong email; còn lại gom thành "và N sản phẩm khác". */
export const ORDER_EMAIL_LINES_MAX = 10;
const NAME_MAX = 80;

export interface OrderConfirmEmailItem {
  name: string;
  variant: string | null;
  quantity: number;
  gift: boolean;
}

export interface OrderConfirmEmailInput {
  code: string;
  eventType: 'order.created' | 'order.payment_confirmed';
  items: readonly OrderConfirmEmailItem[];
  totalVnd: number;
  paymentMethod: string;
  /** Đơn đã nhận đủ tiền (sự kiện đã thanh toán, hoặc đơn trả trước đã PAID lúc gửi). */
  paid: boolean;
  /** Link xem đơn (`orderDetailUrl`); null thì chỉ dẫn vào mục Đơn của tôi. */
  link: string | null;
  /** Số Zalo Tubu Tree `0xxxxxxxxx` (`support.tubu_zalo_phone`). */
  zaloPhone: string;
}

export interface OrderConfirmEmail {
  subject: string;
  text: string;
  html: string;
}

const PAYMENT_LABEL: Record<string, string> = {
  COD: 'Thanh toán khi nhận hàng (COD)',
  BANK_TRANSFER: 'Chuyển khoản',
  ZALOPAY: 'ZaloPay',
  VNPAY: 'VNPAY',
  WALLET: 'Ví Tubu',
  XU: 'Xu',
};

export const ORDER_EMAIL_FOOTER = 'Email tự động từ Tubu Tree, không cần trả lời.';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export const formatEmailVnd = (n: number) => `${formatVndDigits(n)}₫`;

/** `ab•••@gmail.com`: đủ để đối soát dòng log mà không lưu nguyên địa chỉ. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  return `${email.slice(0, Math.min(2, at))}•••${email.slice(at)}`;
}

export function zaloFriendCta(zaloPhone: string): { label: string; url: string } {
  return { label: `Kết bạn Zalo Tubu Tree (${zaloPhone})`, url: `https://zalo.me/${zaloPhone}` };
}

function itemLine(it: OrderConfirmEmailItem): string {
  const name = oneLine(it.variant ? `${it.name} (${it.variant})` : it.name, NAME_MAX);
  return `${name} × ${it.quantity}${it.gift ? ' (quà tặng)' : ''}`;
}

export function buildOrderConfirmEmail(i: OrderConfirmEmailInput): OrderConfirmEmail {
  const subject = `Tubu Tree xác nhận đơn ${i.code}`;
  const status = i.paid ? `Tubu Tree đã nhận đủ thanh toán cho đơn ${i.code}.` : `Tubu Tree đã nhận đơn ${i.code} của bạn.`;
  const waiting = !i.paid && i.paymentMethod === 'BANK_TRANSFER' ? 'Đơn đang chờ bạn chuyển khoản.' : null;
  const shown = i.items.slice(0, ORDER_EMAIL_LINES_MAX).map(itemLine);
  const more = i.items.length > ORDER_EMAIL_LINES_MAX ? `và ${i.items.length - ORDER_EMAIL_LINES_MAX} sản phẩm khác` : null;
  const total = `Tổng: ${formatEmailVnd(i.totalVnd)}`;
  const payment = `Thanh toán: ${PAYMENT_LABEL[i.paymentMethod] ?? i.paymentMethod}`;
  const linkLine = i.link ? `Xem đơn: ${i.link}` : 'Xem đơn ở mục Đơn của tôi trong Tubu Tree.';
  const cta = zaloFriendCta(i.zaloPhone);
  const ctaText = `${cta.label} để nhận Bill & theo dõi đơn miễn phí: ${cta.url}`;

  const text = [
    'Chào bạn,',
    '',
    status,
    ...(waiting ? [waiting] : []),
    '',
    'Sản phẩm:',
    ...shown.map((l) => `- ${l}`),
    ...(more ? [`- ${more}`] : []),
    '',
    total,
    payment,
    '',
    linkLine,
    '',
    ctaText,
    '',
    ORDER_EMAIL_FOOTER,
  ].join('\n');

  const p = (s: string, style = 'margin:0 0 12px') => `<p style="${style}">${s}</p>`;
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1c1917;max-width:560px">',
    p('Chào bạn,'),
    p(escapeHtml(status) + (waiting ? `<br>${escapeHtml(waiting)}` : '')),
    '<ul style="margin:0 0 12px;padding-left:20px">',
    ...shown.map((l) => `<li style="margin:0 0 4px">${escapeHtml(l)}</li>`),
    ...(more ? [`<li style="margin:0 0 4px">${escapeHtml(more)}</li>`] : []),
    '</ul>',
    p(`<strong>${escapeHtml(total)}</strong><br>${escapeHtml(payment)}`),
    i.link ? p(`<a href="${escapeHtml(i.link)}" style="color:#2f6b3a">Xem đơn ${escapeHtml(i.code)}</a>`) : p(escapeHtml(linkLine)),
    p(
      `<a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2f6b3a;color:#ffffff;text-decoration:none;font-weight:bold">${escapeHtml(cta.label)}</a>`,
      'margin:16px 0 6px',
    ),
    p('để nhận Bill &amp; theo dõi đơn miễn phí.', 'margin:0 0 16px;font-size:13px;color:#57534e'),
    p(escapeHtml(ORDER_EMAIL_FOOTER), 'margin:0;font-size:12px;color:#78716c'),
    '</div>',
  ].join('');

  return { subject, text, html };
}
