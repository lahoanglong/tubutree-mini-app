import { DEALER_MAX_DISCOUNT_KEY, DEFAULT_DEALER_MAX_DISCOUNT } from '../admin/dealer-price-import';

export { DEALER_MAX_DISCOUNT_KEY, DEFAULT_DEALER_MAX_DISCOUNT };

/** Cột Int (INT4) của dealer_tiers: tiền đồng, chặn dưới mức tràn để không ra lỗi DB thô. */
export const TIER_MAX_VND = 2_000_000_000;
export const TIER_NAME_MAX = 60;
/** Mã bậc dùng làm khoá trong user.metadata.dealerTierId và Variation.dealerPrices nên không đổi được sau khi tạo. */
export const TIER_ID_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/;
/** Quy ước sẵn có của dữ liệu: PREPAID, NET 15, NET 30 (chỉ để hiển thị cho đại lý, hạn mức thật nằm ở creditLimit). */
export const TIER_PAYMENT_TERMS_PATTERN = /^(PREPAID|NET (?:[1-9]\d?|[12]\d\d|3[0-5]\d|36[0-5]))$/;

export interface TierInput {
  name: string;
  minOrderVolume: number;
  /** Phần trăm (30 = 30%), tối đa 2 chữ số thập phân. DB lưu phân số trong discountRules.default (0,3). */
  discountPct: number;
  creditLimit: number;
  paymentTerms?: string | null;
}

/** Trần chiết khấu đại lý (phân số). Khoá hỏng rơi về mặc định, đúng như DealerService.dealerContext và dealerPriceFloor. */
export function resolveMaxDiscount(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : DEFAULT_DEALER_MAX_DISCOUNT;
}

export const discountPctToFraction = (pct: number): number => Math.round(pct * 100) / 10_000;
export const discountFractionToPct = (fraction: number): number => Math.round(fraction * 10_000) / 100;

const isVnd = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= TIER_MAX_VND;
const fmtPct = (pct: number) => `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0$/, '')}%`;

/** Mọi lỗi của một bậc, tiếng Việt, để admin sửa một lượt. Rỗng = hợp lệ. */
export function tierProblems(input: TierInput, maxDiscount: number): string[] {
  const out: string[] = [];
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) out.push('Tên bậc không được để trống.');
  else if (name.length > TIER_NAME_MAX) out.push(`Tên bậc tối đa ${TIER_NAME_MAX} ký tự.`);

  const pct = input.discountPct;
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0) {
    out.push('Chiết khấu phải là số lớn hơn 0 (30 nghĩa là 30%).');
  } else if (Math.abs(pct * 100 - Math.round(pct * 100)) > 1e-9) {
    out.push('Chiết khấu tối đa 2 chữ số thập phân.');
  } else if (Math.round(pct * 100) > Math.round(maxDiscount * 10_000)) {
    out.push(
      `Chiết khấu ${fmtPct(pct)} vượt trần ${fmtPct(maxDiscount * 100)} (khoá cấu hình ${DEALER_MAX_DISCOUNT_KEY}). Muốn cao hơn thì nâng trần ở tab Cấu hình trước.`,
    );
  }

  if (!isVnd(input.creditLimit)) out.push(`Hạn mức công nợ phải là số đồng nguyên từ 0 đến ${TIER_MAX_VND.toLocaleString('vi-VN')}.`);
  if (!isVnd(input.minOrderVolume)) out.push(`Doanh số tối thiểu phải là số đồng nguyên từ 0 đến ${TIER_MAX_VND.toLocaleString('vi-VN')}.`);

  const terms = input.paymentTerms;
  if (terms !== undefined && terms !== null && terms !== '' && !TIER_PAYMENT_TERMS_PATTERN.test(terms)) {
    out.push('Điều kiện thanh toán là PREPAID (trả trước) hoặc NET <số ngày>, ví dụ NET 30.');
  }
  return out;
}
