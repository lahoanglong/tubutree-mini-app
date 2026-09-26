export interface InvoiceInfo {
  taxCode: string;
  companyName: string;
  address: string;
  email: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Hoá đơn VAT hợp lệ khi không yêu cầu xuất, hoặc đủ 4 trường + email đúng định dạng. */
export function isInvoiceValid(wantInvoice: boolean, invoice: InvoiceInfo): boolean {
  if (!wantInvoice) return true;
  return (
    invoice.taxCode.trim().length > 0 &&
    invoice.companyName.trim().length > 0 &&
    invoice.address.trim().length > 0 &&
    EMAIL_RE.test(invoice.email.trim())
  );
}

/**
 * Đang chọn Ví/TubuXu mà số dư tương ứng không đủ trả tổng đơn → tự rơi về COD,
 * tránh đặt hàng thất bại (BE reject nếu thanh toán vượt số dư).
 */
export function shouldFallbackToCod(
  payment: string,
  walletBalance: number,
  coinsBalance: number,
  total: number,
): boolean {
  if (payment === 'WALLET' && walletBalance < total) return true;
  if (payment === 'XU' && coinsBalance < total) return true;
  return false;
}

/**
 * Điểm Xanh màn thanh toán được đề nghị dùng: số DÙNG ĐƯỢC (`redeemablePoints` của loyalty overview = số
 * dư − điểm đơn còn trong hạn đổi/trả hoặc đang chờ xử lý đổi/trả), KHÔNG phải số dư. Backend (báo giá +
 * đặt đơn) kẹp đúng theo luật này — hiện số dư sẽ hứa "Dùng 500 điểm" mà đơn chỉ trừ được 200.
 *  - API cũ chưa trả `redeemablePoints` → số dư − `lockedPoints` (≥ 0).
 *  - Chưa tải xong overview → số dư dự phòng (auth store); backend vẫn tự kẹp khi báo giá.
 * `label` = dòng mô tả khi công tắc đang tắt (null = chưa có điểm nào → màn hình hiện lời mời tích điểm);
 * `lockNote` = phần chưa dùng được, chỉ có khi vẫn còn điểm dùng được (không thì đã nằm trong `label`).
 */
export function checkoutPoints(
  ov: { pointsBalance: number; lockedPoints?: number; redeemablePoints?: number } | undefined,
  fallbackBalance: number,
): { balance: number; usable: number; label: string | null; lockNote: string | null } {
  const balance = Math.max(0, ov?.pointsBalance ?? fallbackBalance);
  const usable = Math.min(balance, Math.max(0, ov?.redeemablePoints ?? balance - (ov?.lockedPoints ?? 0)));
  const held = balance - usable;
  const heldText = `${held} điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được`;
  if (balance === 0) return { balance, usable, label: null, lockNote: null };
  if (usable === 0) return { balance, usable, label: heldText, lockNote: null };
  if (held === 0) return { balance, usable, label: `Bạn đang có ${usable} điểm`, lockNote: null };
  return { balance, usable, label: `Dùng được ${usable}/${balance} điểm`, lockNote: heldText };
}
