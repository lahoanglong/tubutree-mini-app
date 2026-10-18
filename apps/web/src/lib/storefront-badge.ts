/**
 * Nhãn tin cậy của gian hàng, hoặc null khi không được phép hiện. Tick xanh và chữ "CTV tuyển chọn" chỉ dành cho gian hàng admin
 * đã duyệt (`approved`); API cũ chưa trả cờ thì coi như chưa duyệt. Gian hàng đối tác chỉ nói điều đúng: là đối tác của Tubu Tree,
 * không hứa "chính hãng".
 */
export function storefrontBadgeLabel(sf: { type?: string | null; approved?: boolean }): string | null {
  if (!sf.approved) return null;
  if (sf.type === 'MERCHANT') return 'Đối tác của Tubu Tree';
  if (sf.type === 'BRAND') return 'Nhãn hàng trên Tubu Tree';
  return 'CTV tuyển chọn';
}
