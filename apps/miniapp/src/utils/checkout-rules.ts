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
