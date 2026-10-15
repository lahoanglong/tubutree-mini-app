const spendLabel = (spend: number): string => {
  if (spend >= 1_000_000) return `${String(spend / 1_000_000).replace('.', ',')} triệu`;
  return `${spend / 1_000} nghìn`;
};

/**
 * Tên thân thiện cho mã tự cấp (`<lý do>-<id khách>`: chào mừng, sinh nhật, quay lại, đơn thứ hai, mốc chi tiêu).
 * Mã thường (khách đổi điểm, mã công khai) trả null để thẻ vẫn hiện mã như cũ.
 */
export function autoCouponName(code: string): string | null {
  const c = code.toUpperCase();
  const milestone = /^MILESTONE(\d+)-\d{4}-\d{2}-/.exec(c);
  if (milestone) return `Quà mốc chi tiêu ${spendLabel(Number(milestone[1]))}`;
  if (/^WELCOME-/.test(c)) return 'Quà chào mừng thành viên mới';
  if (/^BIRTHDAY-\d{4}-\d{2}-/.test(c)) return 'Quà sinh nhật';
  if (/^WINBACK-\d{4}-\d{2}(-\d{2})?-/.test(c)) return 'Quà chào mừng quay lại';
  if (/^SECOND-ORDER-/.test(c)) return 'Quà cho đơn thứ hai';
  return null;
}
