import { createHash, createHmac, randomInt } from 'node:crypto';

/** Mã 6 số, sống 10 phút, sai 5 lần thì huỷ; gửi lại sau 60 giây. */
export const EMAIL_OTP_LENGTH = 6;
export const EMAIL_OTP_TTL_MS = 10 * 60_000;
export const EMAIL_OTP_RESEND_COOLDOWN_MS = 60_000;
export const EMAIL_OTP_MAX_WRONG = 5;
/** Số lần đoán sai mỗi hộp thư trong một giờ, cộng dồn qua mọi mã: đủ thì không cấp mã mới tới hết giờ (xin mã mới không xoá được lượt sai). */
export const EMAIL_OTP_WRONG_PER_HOUR = 10;

/**
 * Trần gửi thư trong Redis (bền qua khởi động lại, chung mọi replica). Theo email là trần chặt; theo IP nới rộng hơn vì nhiều máy
 * chung wifi/CGNAT của nhà mạng (cùng quy ước AUTH_IDENTITY_LIMIT/AUTH_IP_LIMIT). Trần ngày bảo vệ tài khoản Gmail gửi thư: Gmail
 * thường chặn quá ~500 thư/ngày, và báo động vận hành cũng đi qua tài khoản đó.
 */
export const EMAIL_OTP_HOUR_MS = 60 * 60_000;
export const EMAIL_OTP_HOURLY_PER_EMAIL = 10;
export const EMAIL_OTP_HOURLY_PER_IP = 30;
export const EMAIL_OTP_DAY_MS = 24 * 60 * 60_000;
/** Trần mỗi IP trong ngày: một nguồn không tự tiêu hết trần chung của cả ngày. */
export const EMAIL_OTP_DAILY_PER_IP = 60;
export const EMAIL_OTP_DAILY_TOTAL = 400;

const EMAIL_MAX = 254;
// Đủ chặt để chặn chuỗi rác và ký tự xuống dòng (chèn header thư), đủ rộng cho địa chỉ thật: local@domain.tld.
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/;

/** Email khách gõ → dạng chuẩn để gửi thư và so khớp (cắt khoảng trắng, chữ thường); null khi không phải email. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (v.length === 0 || v.length > EMAIL_MAX || !EMAIL_RE.test(v)) return null;
  const local = v.slice(0, v.indexOf('@'));
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  return v;
}

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * Danh tính đăng nhập của một hộp thư: bỏ phần `+nhãn` ở mọi nhà cung cấp (Gmail, Outlook, iCloud… đều giao a+x@ về a@), Gmail bỏ
 * thêm dấu chấm (a.b@gmail.com và ab@gmail.com là một hộp thư). Để một hộp thư không tự tạo vô hạn tài khoản (mỗi tài khoản mới nhận
 * quà chào mừng).
 */
export function canonicalEmail(email: string): string {
  const at = email.lastIndexOf('@');
  const domain = email.slice(at + 1);
  const local = email.slice(0, at);
  const base = local.split('+')[0] || local;
  if (GMAIL_DOMAINS.has(domain)) return `${base.replace(/\./g, '')}@gmail.com`;
  return `${base}@${domain}`;
}

/** Khoá băm của hộp thư: dùng cho khoá Redis và cột zaloId, để log/Redis/màn admin không chứa email thô. */
export function emailIdentityHash(email: string): string {
  return createHash('sha256').update(`email-login:${canonicalEmail(email)}`).digest('hex');
}

/**
 * zaloId của tài khoản đăng nhập bằng email (chưa từng có Zalo). Không mang tiền tố `guest_` nên là "user thật" (real-user.ts);
 * cột zaloId là @unique nên hai lần xác minh đồng thời cùng email không tạo được hai tài khoản.
 */
export const EMAIL_LOGIN_ZALO_PREFIX = 'email_';
export function emailLoginZaloId(email: string): string {
  return `${EMAIL_LOGIN_ZALO_PREFIX}${emailIdentityHash(email)}`;
}

/** Mã 6 số ngẫu nhiên mật mã (randomInt dùng CSPRNG, không lệch phân phối). */
export function generateEmailOtp(): string {
  return randomInt(0, 10 ** EMAIL_OTP_LENGTH).toString().padStart(EMAIL_OTP_LENGTH, '0');
}

/**
 * Băm mã trước khi cất: HMAC-SHA256 khoá bằng bí mật máy chủ, gắn với hộp thư. SHA-256 trơn của 6 số dò ngược được ngay
 * (1 triệu khả năng) nếu Redis bị lộ; có khoá bí mật thì không.
 */
export function hashEmailOtp(secret: string, email: string, code: string): string {
  return createHmac('sha256', secret).update(`email-otp:v1:${emailIdentityHash(email)}:${code}`).digest('hex');
}

/** Che email khi ghi log: `ab***@gmail.com`. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 0) return '***';
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}
