import { resolveSmtpSenderConfig } from '../../../config/ops-email-config';

type EnvLike = Record<string, string | undefined>;

/** Nút "Đăng nhập với Google" chỉ hiện khi máy chủ có đủ cả hai khoá; thiếu một là tắt hẳn (/auth/google/* trả lỗi). */
export function googleLoginConfigured(env: EnvLike = process.env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

/** Đăng nhập bằng mã email cần SMTP gửi được thư (cùng SMTP_* với email báo động vận hành). */
export function emailLoginConfigured(env: EnvLike = process.env): boolean {
  return resolveSmtpSenderConfig(env).state === 'ready';
}
