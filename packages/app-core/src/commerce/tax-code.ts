/** Cùng luật với API (checkout.dto.ts): MST 10 số (chi nhánh thêm -3 số) hoặc CCCD 12 số. */
const TAX_CODE_RE = /^(\d{10}(-\d{3})?|\d{12})$/;

/** Bỏ khoảng trắng, dấu chấm, gạch; MST chi nhánh gõ liền 13 số thì chèn lại '-' trước 3 số cuối. */
export function normalizeTaxCode(raw: string): string {
  const compact = raw.replace(/[\s.\-]/g, '');
  if (/^\d{13}$/.test(compact)) return `${compact.slice(0, 10)}-${compact.slice(10)}`;
  return /^\d+$/.test(compact) ? compact : raw.trim();
}

export function isTaxCodeValid(raw: string): boolean {
  return TAX_CODE_RE.test(normalizeTaxCode(raw));
}
