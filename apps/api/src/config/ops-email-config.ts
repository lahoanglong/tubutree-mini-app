import { z } from 'zod';

export const OPS_EMAIL_KEYS = ['OPS_ALERT_EMAIL_TO', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'] as const;
export type OpsEmailKey = (typeof OPS_EMAIL_KEYS)[number];

export interface OpsEmailIssue {
  key: OpsEmailKey;
  message: string;
}

export interface OpsEmailSender {
  name?: string;
  address: string;
}

export type OpsEmailConfig =
  | { state: 'disabled' }
  | { state: 'misconfigured'; issues: OpsEmailIssue[] }
  | {
      state: 'ready';
      recipients: string[];
      from: OpsEmailSender;
      smtp: { host: string; port: number; secure: boolean; requireTLS: boolean; auth?: { user: string; pass: string } };
    };

const emailSchema = z.string().max(254).email();
const isEmail = (v: string) => emailSchema.safeParse(v).success;

/** Người nhận: tách theo dấu phẩy hoặc chấm phẩy; mục sai trả riêng để báo đúng chỗ thay vì lặng lẽ bỏ. */
export function parseEmailRecipients(raw: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,;]/)) {
    const v = part.trim();
    if (!v) continue;
    if (!isEmail(v)) {
      invalid.push(v);
      continue;
    }
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    valid.push(v);
  }
  return { valid, invalid };
}

/** `ops@x.com` hoặc `Tên hiển thị <ops@x.com>`; null nếu không đúng dạng nào. */
function parseSender(raw: string): OpsEmailSender | null {
  if (isEmail(raw)) return { address: raw };
  const m = /^(.*?)\s*<([^<>\s]+)>$/.exec(raw);
  const address = m?.[2];
  if (!address || !isEmail(address)) return null;
  const name = (m[1] ?? '').trim().replace(/^"(.*)"$/, '$1').trim();
  if (/[\r\n<>]/.test(name)) return null;
  return name ? { name, address } : { address };
}

export const SMTP_SECURE_TRUE = ['true', 'yes', '1', 'on'] as const;
export const SMTP_SECURE_FALSE = ['false', 'no', '0', 'off'] as const;
const BOOL_TRUE: ReadonlySet<string> = new Set(SMTP_SECURE_TRUE);
const BOOL_FALSE: ReadonlySet<string> = new Set(SMTP_SECURE_FALSE);
const SMTP_SECURE_HELP =
  `SMTP_SECURE chỉ nhận ${[...SMTP_SECURE_TRUE, ...SMTP_SECURE_FALSE].join(', ')} (không phân biệt hoa thường): ` +
  `${SMTP_SECURE_TRUE.join('/')} = TLS ngay từ đầu (thường cổng 465), ${SMTP_SECURE_FALSE.join('/')} = STARTTLS (thường cổng 587); để trống thì theo cổng.`;
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$|^\[[0-9A-Fa-f:.]+\]$/;

/**
 * Đọc cấu hình email báo động vận hành từ env. Không đặt biến nào = kênh tắt (ứng dụng chạy bình thường). Đặt dở
 * dang hoặc sai = `misconfigured` kèm từng lỗi theo khoá, để env.validation chặn lúc boot/deploy và màn Sức khoẻ hệ
 * thống nêu rõ — không để người vận hành tưởng đã có kênh email mà thực ra không gửi được.
 */
export function resolveOpsEmailConfig(env: Partial<Record<OpsEmailKey, unknown>>): OpsEmailConfig {
  const v = (k: OpsEmailKey) => (typeof env[k] === 'string' ? (env[k] as string).trim() : '');
  if (OPS_EMAIL_KEYS.every((k) => !v(k))) return { state: 'disabled' };

  const issues: OpsEmailIssue[] = [];
  const bad = (key: OpsEmailKey, message: string) => issues.push({ key, message });

  const to = parseEmailRecipients(v('OPS_ALERT_EMAIL_TO'));
  if (!v('OPS_ALERT_EMAIL_TO')) {
    bad('OPS_ALERT_EMAIL_TO', 'OPS_ALERT_EMAIL_TO còn trống: đã đặt cấu hình email nhưng chưa có địa chỉ nhận báo động (cách nhau bằng dấu phẩy hoặc chấm phẩy).');
  } else if (to.invalid.length > 0) {
    bad('OPS_ALERT_EMAIL_TO', `OPS_ALERT_EMAIL_TO có địa chỉ không hợp lệ: ${to.invalid.slice(0, 3).join(', ')}${to.invalid.length > 3 ? '…' : ''}.`);
  } else if (to.valid.length === 0) {
    bad('OPS_ALERT_EMAIL_TO', 'OPS_ALERT_EMAIL_TO không có địa chỉ nào (chỉ có dấu phân cách).');
  }

  const host = v('SMTP_HOST');
  if (!host) bad('SMTP_HOST', 'SMTP_HOST còn trống: đã đặt cấu hình email nhưng chưa có máy chủ SMTP.');
  else if (!HOST_RE.test(host)) bad('SMTP_HOST', 'SMTP_HOST chỉ gồm tên máy chủ hoặc IP (vd smtp.gmail.com), không kèm smtp://, cổng hay đường dẫn.');

  const portRaw = v('SMTP_PORT');
  const portNum = Number(portRaw);
  if (portRaw && !(/^\d+$/.test(portRaw) && portNum >= 1 && portNum <= 65535)) bad('SMTP_PORT', 'SMTP_PORT phải là số nguyên từ 1 đến 65535 (vd 587 hoặc 465).');
  const port = portRaw && /^\d+$/.test(portRaw) ? portNum : undefined;

  const secureRaw = v('SMTP_SECURE').toLowerCase();
  let secure: boolean | undefined;
  if (secureRaw) {
    if (BOOL_TRUE.has(secureRaw)) secure = true;
    else if (BOOL_FALSE.has(secureRaw)) secure = false;
    else bad('SMTP_SECURE', SMTP_SECURE_HELP);
  }

  const user = v('SMTP_USER');
  const pass = v('SMTP_PASS');
  if (user && !pass) bad('SMTP_PASS', 'SMTP_PASS còn trống: đã đặt SMTP_USER nhưng thiếu mật khẩu.');
  if (pass && !user) bad('SMTP_USER', 'SMTP_USER còn trống: đã đặt SMTP_PASS nhưng thiếu tài khoản.');

  const fromRaw = v('SMTP_FROM') || (isEmail(user) ? user : '');
  const from = fromRaw ? parseSender(fromRaw) : null;
  if (!fromRaw) {
    bad('SMTP_FROM', 'SMTP_FROM còn trống và SMTP_USER không phải địa chỉ email để dùng thay: đặt địa chỉ gửi (vd alerts@tubutree.com).');
  } else if (!from) {
    bad('SMTP_FROM', 'SMTP_FROM phải là địa chỉ email, dạng alerts@tubutree.com hoặc Tubu Tree <alerts@tubutree.com>.');
  }

  if (issues.length > 0 || !from) return { state: 'misconfigured', issues };

  const resolvedSecure = secure ?? port === 465;
  return {
    state: 'ready',
    recipients: to.valid,
    from,
    smtp: {
      host,
      port: port ?? (resolvedSecure ? 465 : 587),
      secure: resolvedSecure,
      requireTLS: !resolvedSecure && Boolean(user),
      ...(user ? { auth: { user, pass } } : {}),
    },
  };
}
