/**
 * Cờ `growth.referral_viral_enabled` từ cấu hình công khai: chỉ boolean true thật mới bật. Module riêng, không nhập gì: trang Tài khoản và Sổ tay
 * Xanh nhập tĩnh hàm này, còn phần vẽ thẻ (`./green-card`, kéo theo `commerce/money`) chỉ nằm trong chunk tải lười. Nhập `green-card.ts` tĩnh làm
 * webpack dời module tiền giữa các chunk dùng chung và /vuon-xanh vượt web-budget.
 */
export function referralViralOn(cfg: unknown): boolean {
  return typeof cfg === 'object' && cfg !== null && (cfg as Record<string, unknown>).referralViralEnabled === true;
}
