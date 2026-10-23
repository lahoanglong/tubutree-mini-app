import { createHash, timingSafeEqual } from 'node:crypto';

// So sánh băm để hai chuỗi khác độ dài vẫn đi qua timingSafeEqual (nó ném lỗi nếu độ dài khác).
function digest(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

export function isAuthorized(header: string | undefined, secret: string): boolean {
  if (!header || !header.startsWith('Bearer ')) return false;
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}
