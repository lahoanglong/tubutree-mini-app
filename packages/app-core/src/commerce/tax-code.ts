/** Cùng luật với API (checkout.dto.ts): MST 10 số (chi nhánh thêm -3 số) hoặc CCCD 12 số. */
const TAX_CODE_RE = /^(\d{10}(-\d{3})?|\d{12})$/;

/**
 * Bỏ khoảng trắng và dấu chấm. Dấu '-' chỉ được giữ đúng dạng 10 số + '-' + 3 số (không đoán/ghép số);
 * MST chi nhánh gõ liền 13 số thì chèn lại '-' trước 3 số cuối.
 */
export function normalizeTaxCode(raw: string): string {
  const compact = raw.replace(/[\s.]/g, '');
  if (compact.includes('-')) return compact;
  if (/^\d{13}$/.test(compact)) return `${compact.slice(0, 10)}-${compact.slice(10)}`;
  return /^\d+$/.test(compact) ? compact : raw.trim();
}

export function isTaxCodeValid(raw: string): boolean {
  return TAX_CODE_RE.test(normalizeTaxCode(raw));
}

/** Chỉ báo lỗi khi khách đã gõ tới độ dài đáng kể (>= 10 chữ số) hoặc có ký tự lạ, để không đỏ ô từ phím đầu tiên. */
export function shouldShowTaxCodeError(raw: string): boolean {
  if (!raw.trim() || isTaxCodeValid(raw)) return false;
  // Còn là tiền tố của mã hợp lệ (CCCD 12 số, MST chi nhánh 10-3): khách đang gõ dở, chưa báo đỏ.
  if (/^(\d{11}|\d{10}-\d{0,2})$/.test(raw.replace(/[\s.]/g, ''))) return false;
  const digits = raw.replace(/\D/g, '').length;
  return digits >= 10 || /[^\d\s.\-]/.test(raw);
}
