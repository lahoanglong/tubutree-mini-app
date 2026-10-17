import { createHmac } from 'node:crypto';

/**
 * Chỉ dùng khi chưa cấu hình bí mật (máy dev, test). Production luôn có JWT_ACCESS_SECRET (env.validation đòi tối thiểu 16 ký tự)
 * nên nhánh này không bao giờ chạy ở đó.
 */
const DEV_SECRET = 'dev-only-ip-hash-secret';

/**
 * Mã băm IP để lưu thay cho IP thô. Dùng HMAC với khoá riêng của máy chủ chứ không phải sha256 trần: không gian IPv4 chỉ ~4,3 tỷ
 * giá trị nên sha256 trần của một IP đảo ngược được bằng vét cạn trong vài phút, còn HMAC thì không khi không có khoá.
 * Khoá của từng mục đích được suy ra từ bí mật gốc (`purpose` làm nhãn) để một mã băm không dùng chéo sang mục đích khác.
 */
export function hashIp(ip: string, secret: string | undefined, purpose: string): string {
  const key = createHmac('sha256', secret || DEV_SECRET)
    .update(`ip-hash|${purpose}`)
    .digest();
  return createHmac('sha256', key).update(ip).digest('hex');
}
