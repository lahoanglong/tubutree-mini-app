/**
 * Số điện thoại để HIỂN THỊ cho khách đọc/đối chiếu (nút Gọi, hotline): tổng đài 1800/1900 tách đầu số ("1800 1234"), di động
 * 10 số nhóm 4-3-3 ("0899 149 229"), bàn có mã vùng nhóm 3-4-4 ("028 3822 1234"), +84 đổi về 0. Chuỗi không khớp dạng nào thì
 * giữ nguyên (chỉ cắt khoảng trắng đầu cuối), không đoán. Chỉ để hiển thị: số đưa vào `tel:`/callPhone phải là số gốc.
 */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  const text = (raw ?? '').trim();
  if (!text) return '';
  if (/[^\d\s.\-+()]/.test(text)) return text;

  let digits = text.replace(/\D/g, '');
  if (/^\+\s*84/.test(text) || (/^84\d{9}$/.test(digits) && !text.startsWith('0'))) {
    digits = `0${digits.replace(/^84/, '')}`;
  }

  if (/^1[89]00\d{4}(\d{2})?$/.test(digits)) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  if (/^0\d{9}$/.test(digits) && !digits.startsWith('02')) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  if (/^02\d{9}$/.test(digits)) return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
  return text;
}
