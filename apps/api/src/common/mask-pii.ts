/**
 * Che dữ liệu cá nhân trước khi ghi log máy chủ: log container được giữ và đọc qua GitHub Actions (logs.yml), nên
 * SĐT khách không được nằm nguyên văn ở đó. Cùng quy ước 3 số đầu + 3 số cuối với màn CTV/thành viên.
 */

/** 3 ký tự đầu + "****" + 3 ký tự cuối, KHÔNG chặn chuỗi ngắn (chuỗi <= 6 ký tự sẽ lộ gần hết). */
export function maskPhoneEnds(phone: string): string {
  return `${phone.slice(0, 3)}****${phone.slice(-3)}`;
}

/** Như `maskPhoneEnds` nhưng chuỗi <= 6 ký tự ra "***"; SĐT trống trả `null` (dùng trong payload API). */
export function maskPhoneOrNull(phone: string | null | undefined): string | null {
  if (!phone) return null;
  if (phone.length <= 6) return '***';
  return maskPhoneEnds(phone);
}

export function maskPhone(phone: string | null | undefined): string {
  return maskPhoneOrNull(phone) ?? '(không có SĐT)';
}
