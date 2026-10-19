/** MST cá nhân 10 số (hoặc 10-3), hoặc số CCCD 12 số — cùng luật affiliate.service PERSONAL_TAX_ID_PATTERN. */
export const PERSONAL_TAX_ID_PATTERN = /^(\d{10}|\d{10}-\d{3}|\d{12})$/;

/** Thuế TNCN giữ lại cho một lần rút — cùng công thức affiliate.service.personalIncomeTax. */
export function payoutTax(gross: number, pit: { pct: number; threshold: number } | undefined): number {
  if (!pit || !(pit.pct > 0) || gross < pit.threshold) return 0;
  return Math.round(gross * Math.min(pit.pct, 1));
}

/**
 * % thanh tiến độ lên bậc — mirror milestoneProgressPct của backend: chưa tới ngưỡng thì tối đa 99
 * (Math.round làm 9,99tr/10tr hiện 100% trong khi vẫn "Còn … để lên bậc").
 */
export function progressPct(revenue: number, threshold: number): number {
  if (threshold <= 0 || revenue >= threshold) return 100;
  return Math.max(0, Math.min(99, Math.floor((revenue / threshold) * 100)));
}

/**
 * SĐT người nhận CTV gõ tay, cùng luật máy chủ (common/phone.ts parseTypedVnPhone): bỏ khoảng trắng, chấm, gạch, ngoặc;
 * nhận 0, +84 hoặc 84 rồi 9 số (số đầu không phải 0); trả 0xxxxxxxxx. Không hợp lệ → null.
 */
export function parseTypedVnPhone(raw: string): string | null {
  const compact = raw.replace(/[\s.\-()]/g, '');
  const m = /^(?:0|\+?84)([1-9]\d{8})$/.exec(compact);
  return m ? `0${m[1]}` : null;
}

/** Từ khoá đủ dài để gọi /search/suggest: API gấp dấu rồi trả [] cho dưới 2 ký tự. */
export const SUGGEST_MIN_CHARS = 2;
export const isSuggestable = (s: string): boolean =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/\s+/g, ' ')
    .trim().length >= SUGGEST_MIN_CHARS;

export interface WithdrawInput {
  /** Toàn bộ hoa hồng có thể rút: máy chủ chỉ nhận rút trọn số này. */
  max: number;
  method: 'BANK' | 'WALLET_BALANCE';
  pit: { pct: number; threshold: number } | undefined;
  taxIdOnFile: string | null;
  taxId: string;
  minBank: number;
  cfgLoaded: boolean;
  /** false khi dashboard lỗi: `max` tạm bằng 0, không phải số dư thật. */
  knownMax: boolean;
  bank: { bankName: string; accountNumber: string; accountName: string };
  pending?: boolean;
}

export interface WithdrawView {
  amount: number;
  tax: number;
  net: number;
  askTaxId: boolean;
  taxIdValid: boolean;
  bankValid: boolean;
  valid: boolean;
}

/** Điều kiện gửi lệnh rút hoa hồng: cùng luật nút "Rút" của Mini App, để web và Mini App chặn đúng chỗ máy chủ chặn. */
export function withdrawView(i: WithdrawInput): WithdrawView {
  const amount = i.max;
  const tax = payoutTax(amount, i.pit);
  // Lần rút bị khấu trừ thuế TNCN cần MST/CCCD để kê khai và cấp chứng từ (máy chủ trả PIT_TAX_ID_REQUIRED nếu thiếu).
  const askTaxId = tax > 0 && !i.taxIdOnFile;
  const taxIdValid = !askTaxId || PERSONAL_TAX_ID_PATTERN.test(i.taxId.trim());
  const bankValid =
    i.method !== 'BANK' ||
    (i.bank.bankName.trim().length > 0 && i.bank.accountNumber.trim().length >= 6 && i.bank.accountName.trim().length > 0);
  // Chờ config thật: mức tối thiểu mặc định và thuế TNCN đều lấy từ config, chưa có thì số nhận trên nút có thể lệch số được cộng.
  const valid =
    i.knownMax &&
    i.cfgLoaded &&
    amount > 0 &&
    (i.method !== 'BANK' || amount >= i.minBank) &&
    bankValid &&
    taxIdValid &&
    !i.pending;
  return { amount, tax, net: amount - tax, askTaxId, taxIdValid, bankValid, valid };
}
