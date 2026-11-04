import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (v: string): Buffer => createHash('sha256').update(v, 'utf8').digest();

/**
 * So hai chuỗi bí mật/token trong thời gian không đổi. So băm sha256 (luôn 32 byte) nên thời gian phản hồi
 * không lộ độ dài secret. Chuỗi rỗng không bao giờ khớp: secret chưa đặt không được "mở cổng" cho token rỗng.
 */
export function safeEqualStrings(given: string, expected: string): boolean {
  if (given.length === 0 || expected.length === 0) return false;
  return timingSafeEqual(digest(given), digest(expected));
}
