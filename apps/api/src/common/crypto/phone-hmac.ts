import { createHmac } from 'node:crypto';
import { toLocalPhone } from '../phone';

/** Biến môi trường giữ bí mật riêng cho mã băm SĐT. Không bắt buộc: thiếu thì dùng khoá suy ra từ JWT_ACCESS_SECRET (xem `phoneHmacSecret`). */
export const PHONE_HMAC_SECRET_ENV = 'PHONE_HMAC_SECRET';

/** Chỉ dùng khi không có bí mật nào (máy dev, test). Production luôn có JWT_ACCESS_SECRET (env.validation đòi từ 32 ký tự) nên không rơi vào đây. */
const DEV_SECRET = 'dev-only-phone-hmac-secret';

export type PhoneHmacKeySource = 'env' | 'jwt' | 'dev';

function readSecret(): { secret: string; source: PhoneHmacKeySource } {
  const own = process.env[PHONE_HMAC_SECRET_ENV]?.trim();
  if (own) return { secret: own, source: 'env' };
  const jwt = process.env.JWT_ACCESS_SECRET?.trim();
  // Không dùng thẳng khoá ký phiên: suy ra một khoá riêng, nên mã băm SĐT lộ ra cũng không giúp gì cho việc đoán khoá JWT.
  if (jwt) return { secret: createHmac('sha256', jwt).update('phone-hmac|from-jwt').digest('hex'), source: 'jwt' };
  return { secret: DEV_SECRET, source: 'dev' };
}

/** Nguồn bí mật đang dùng; kiểm go-live báo WARN khi không phải `env`. */
export function phoneHmacKeySource(): PhoneHmacKeySource {
  return readSecret().source;
}

/** Bí mật mặc định của `hmacPhone`, đọc môi trường mỗi lần gọi (test đổi biến môi trường giữa chừng vẫn đúng). */
export function phoneHmacSecret(): string {
  return readSecret().secret;
}

/**
 * Mã băm SĐT để lưu, đếm hay so (chống gian lận, chống trùng, khoá giới hạn) thay cho số thô. Số được chuẩn hoá về 0xxxxxxxxx trước
 * (mọi cách ghi 0…, +84…, 84… ra cùng một mã). Dùng HMAC-SHA256 có khoá chứ không sha256 trần: số di động Việt Nam chỉ khoảng 1 tỷ giá
 * trị nên sha256 trần đảo ngược được bằng vét cạn trong vài phút. Không có SĐT → null.
 */
export function hmacPhone(phone: string | null | undefined, secret: string = phoneHmacSecret()): string | null {
  const local = phone ? toLocalPhone(phone) : null;
  if (!local) return null;
  const key = createHmac('sha256', secret).update('phone-hmac|v1').digest();
  return createHmac('sha256', key).update(local).digest('hex');
}
