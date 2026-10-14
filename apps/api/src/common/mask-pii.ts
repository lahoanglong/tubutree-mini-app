/**
 * Che dữ liệu cá nhân trước khi ghi log máy chủ: log container được giữ và đọc qua GitHub Actions (logs.yml), nên
 * SĐT khách không được nằm nguyên văn ở đó. Cùng quy ước 3 số đầu + 3 số cuối với màn CTV/thành viên.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '(không có SĐT)';
  if (phone.length <= 6) return '***';
  return `${phone.slice(0, 3)}****${phone.slice(-3)}`;
}

