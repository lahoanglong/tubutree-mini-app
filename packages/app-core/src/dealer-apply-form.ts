import { isTaxCodeValid, normalizeTaxCode, shouldShowTaxCodeError } from './commerce/tax-code';

/**
 * Biểu mẫu đăng ký đại lý: nháp chữ trong phiên (sessionStorage) và lời gợi ý ngay dưới ô MST, SĐT. Luật kiểm theo API
 * (`apps/api/src/modules/dealer/dto/dealer.dto.ts`): MST 10 số, chi nhánh 10-3, hoặc 12 số; SĐT di động 0[35789] + 8 số hoặc số bàn 02 + 9 số.
 */

/** Khoá sessionStorage của nháp; chỉ sống trong tab đang mở, đóng tab là mất. */
export const DEALER_APPLY_DRAFT_KEY = 'tubu_dealer_apply_draft';

/** Chỉ lưu ô chữ. Ảnh CCCD không vào nháp: giấy tờ tuỳ thân không nằm lại trong trình duyệt, và ảnh base64 quá nặng cho sessionStorage. */
export const DEALER_DRAFT_FIELDS = ['businessName', 'taxCode', 'ownerName', 'phone', 'address'] as const;
export type DealerDraftField = (typeof DEALER_DRAFT_FIELDS)[number];
export type DealerApplyDraft = Partial<Record<DealerDraftField, string>>;

/** Trần mỗi ô khi đọc lại nháp (cao hơn trần DTO): chuỗi lạ trong storage không làm phình ô nhập. */
const DRAFT_FIELD_MAX = 300;

/**
 * Nháp để ghi; mọi ô trống thì null (nơi gọi xoá khoá thay vì lưu một nháp rỗng). `owner` là id tài khoản đang gõ: người khác đăng nhập cùng tab
 * thì không thấy tên doanh nghiệp, MST, SĐT của người trước.
 */
export function serializeDealerApplyDraft(form: Partial<Record<DealerDraftField, string | null | undefined>>, owner = ''): string | null {
  const draft: DealerApplyDraft = {};
  for (const k of DEALER_DRAFT_FIELDS) {
    const v = form[k];
    if (typeof v === 'string' && v.trim()) draft[k] = v.slice(0, DRAFT_FIELD_MAX);
  }
  if (Object.keys(draft).length === 0) return null;
  return JSON.stringify(owner ? { ...draft, owner } : draft);
}

/** Đọc nháp của đúng `owner`: nháp của tài khoản khác, JSON hỏng, sai kiểu hay ô lạ đều bị bỏ, không bao giờ ném lỗi. */
export function parseDealerApplyDraft(raw: string | null | undefined, owner = ''): DealerApplyDraft {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const savedOwner = (data as Record<string, unknown>).owner;
  if ((typeof savedOwner === 'string' ? savedOwner : '') !== owner) return {};
  const out: DealerApplyDraft = {};
  for (const k of DEALER_DRAFT_FIELDS) {
    const v = (data as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.slice(0, DRAFT_FIELD_MAX);
  }
  return out;
}

const VN_BUSINESS_PHONE = /^(?:0[35789]\d{8}|02\d{9})$/;

/** SĐT doanh nghiệp đúng luật API thì trả dạng `0…` máy chủ sẽ lưu, không thì null (cùng cách chuẩn hoá `normalizeBusinessPhone`). */
export function parseVnBusinessPhone(raw: string): string | null {
  const local = raw.replace(/\D/g, '').replace(/^84/, '0');
  return VN_BUSINESS_PHONE.test(local) ? local : null;
}

export const DEALER_TAX_CODE_HINT = 'Mã số thuế gồm 10 số (chi nhánh thêm -3 số) hoặc 12 số.';
export const DEALER_PHONE_HINT = 'Số điện thoại chưa đúng: di động 10 số (03, 05, 07, 08, 09) hoặc số bàn bắt đầu bằng 02.';

/** MST bỏ trống là hợp lệ (ô tuỳ chọn). */
export const isDealerTaxCodeOk = (raw: string): boolean => !raw.trim() || isTaxCodeValid(raw);

/**
 * Lời gợi ý dưới ô MST. Báo sớm khi đã gõ đủ dài hoặc có ký tự lạ (luật `shouldShowTaxCodeError`); sau khi rời ô (`touched`) thì báo mọi giá trị sai,
 * để nút gửi bị khoá luôn có lý do hiện trên màn.
 */
export function dealerTaxCodeHint(raw: string, touched: boolean): string | null {
  if (isDealerTaxCodeOk(raw)) return null;
  return touched || shouldShowTaxCodeError(raw) ? DEALER_TAX_CODE_HINT : null;
}

/** Lời gợi ý dưới ô SĐT: báo sớm khi đã gõ từ 10 số hoặc có chữ cái; sau khi rời ô thì báo mọi giá trị sai. Ô trống để kiểm bắt buộc lo. */
export function dealerPhoneHint(raw: string, touched: boolean): string | null {
  if (!raw.trim() || parseVnBusinessPhone(raw)) return null;
  // Đếm số sau khi đổi đầu 84 thành 0 (như máy chủ): "+84 912 345 67" mới 9 số nội địa, còn đang gõ dở.
  const early = raw.replace(/\D/g, '').replace(/^84/, '0').length >= 10 || /[^\d\s.+()\-]/.test(raw);
  return touched || early ? DEALER_PHONE_HINT : null;
}

/** MST gửi lên máy chủ: bỏ khoảng trắng/dấu chấm (DTO so khuôn trên chuỗi đã cắt hai đầu, không bỏ dấu cách giữa). Trống thì không gửi. */
export function dealerTaxCodeForSubmit(raw: string): string | undefined {
  return raw.trim() ? normalizeTaxCode(raw) : undefined;
}
