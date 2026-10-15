import type { Env } from './types';

export function envValue(env: Env, key: string): string {
  return (env[key] ?? '').trim();
}

/** Mô tả một bí mật mà không lộ nó: chỉ "chưa đặt" hoặc "đã đặt" kèm nhóm độ dài, không bao giờ in ký tự nào của giá trị. */
export function describeSecret(value: string): string {
  if (!value) return 'chưa đặt';
  if (value.length < 16) return 'đã đặt (ngắn, dưới 16 ký tự)';
  if (value.length < 32) return 'đã đặt (16 đến 31 ký tự)';
  return 'đã đặt (từ 32 ký tự)';
}

const PLACEHOLDER = /change[-_ ]?me|replace[-_ ]?(me|this)|your[-_ ]|example|placeholder|dev-(access|refresh)|^(secret|password|test|todo|xxx+)$/i;

/** Mẫu giá trị điền sẵn trong .env.example hoặc tài liệu: còn nguyên thì chưa ai đặt khoá thật. */
export function looksLikePlaceholder(value: string): boolean {
  return PLACEHOLDER.test(value);
}

/**
 * Chỉ lấy mã lỗi hoặc tên lỗi: thông điệp lỗi của Prisma và ioredis có thể chứa tên user hoặc địa chỉ kết nối,
 * mà báo cáo này được dán vào chat và log.
 */
export function describeError(err: unknown): string {
  if (err && typeof err === 'object') {
    const { code, errorCode } = err as { code?: unknown; errorCode?: unknown };
    if (typeof code === 'string' && code) return code;
    if (typeof errorCode === 'string' && errorCode) return errorCode;
    const name = (err as { name?: unknown }).name;
    if (typeof name === 'string' && name) return name;
  }
  return 'lỗi không rõ';
}
