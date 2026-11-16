import { trimInvisible } from '../../common/text-trim';
import type { SystemConfigService } from './system-config.service';

export const COMPANY_KEYS = {
  legalName: 'company.legal_name',
  taxCode: 'company.tax_code',
  address: 'company.address',
  bctNoticeUrl: 'company.bct_notice_url',
  representative: 'company.representative',
  registrationNumber: 'company.business_registration_number',
  registrationDate: 'company.business_registration_date',
  registrationPlace: 'company.business_registration_place',
} as const;

/** Rỗng hoặc sai kiểu thì null để FE ẩn dòng, không hiện thông tin giả. */
function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = trimInvisible(v);
  return t === '' ? null : t;
}

/**
 * Link huy hiệu Bộ Công Thương: https tới online.gov.vn hoặc một tên miền *.gov.vn, không tên đăng nhập, không cổng lạ. Giá trị sửa
 * tay trong DB không được thành javascript:, http hay trang ngoài để khách không thấy huy hiệu khi chưa có xác nhận thật.
 * Cùng luật với isBctNoticeUrl của app-core (API không phụ thuộc app-core nên giữ một bản ở đây).
 */
function bctNoticeUrl(v: unknown): string | null {
  const t = text(v);
  if (!t || t.length > 500) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    return u.hostname === 'online.gov.vn' || u.hostname.endsWith('.gov.vn') ? t : null;
  } catch {
    return null;
  }
}

/** Trường văn bản ngắn của hồ sơ pháp lý (người đại diện, nơi cấp ĐKDN): quá dài thì bỏ hẳn, không cắt ngang tên. */
const LEGAL_TEXT_MAX = 200;
function legalText(v: unknown): string | null {
  const t = text(v);
  return t && t.length <= LEGAL_TEXT_MAX ? t : null;
}

/** Số Giấy chứng nhận ĐKDN: chữ số, chữ cái không dấu, gạch ngang, gạch chéo, chấm, khoảng trắng; tối đa 40 ký tự. */
function registrationNumber(v: unknown): string | null {
  const t = text(v);
  return t && t.length <= 40 && /^[0-9A-Za-z./\- ]+$/.test(t) ? t : null;
}

/**
 * Ngày cấp ĐKDN: nhận dd/mm/yyyy, d/m/yyyy hoặc yyyy-mm-dd, trả dd/mm/yyyy. Ngày không có trên lịch, trước 1990 hoặc ở tương lai là
 * null (chân trang ẩn thay vì in một ngày vô lý). Cùng luật với normalizeRegistrationDate của app-core (API không phụ thuộc app-core).
 */
export function registrationDate(v: unknown, now: Date = new Date()): string | null {
  const t = text(v);
  if (!t) return null;
  const vn = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const [d, m, y] = vn ? [Number(vn[1]), Number(vn[2]), Number(vn[3])] : iso ? [Number(iso[3]), Number(iso[2]), Number(iso[1])] : [NaN, NaN, NaN];
  if (!Number.isInteger(d) || y < 1990) return null;
  const at = new Date(Date.UTC(y, m - 1, d));
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d) return null;
  if (at.getTime() > now.getTime() + 24 * 3_600_000) return null;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export interface CompanyIdentity {
  legalName: string | null;
  taxCode: string | null;
  address: string | null;
  bctNoticeUrl: string | null;
  /** Người đại diện theo pháp luật. */
  representative: string | null;
  /** Giấy chứng nhận đăng ký doanh nghiệp: số, ngày cấp (dd/mm/yyyy), nơi cấp. Trường chưa nhập hoặc không hợp lệ là null, không bao giờ suy ra từ trường khác (kể cả MST). */
  registrationNumber: string | null;
  registrationDate: string | null;
  registrationPlace: string | null;
}

export function toCompanyIdentity(raw: {
  legalName: unknown;
  taxCode: unknown;
  address: unknown;
  bctNoticeUrl: unknown;
  representative?: unknown;
  registrationNumber?: unknown;
  registrationDate?: unknown;
  registrationPlace?: unknown;
}): CompanyIdentity {
  return {
    legalName: text(raw.legalName),
    taxCode: text(raw.taxCode),
    address: text(raw.address),
    bctNoticeUrl: bctNoticeUrl(raw.bctNoticeUrl),
    representative: legalText(raw.representative),
    registrationNumber: registrationNumber(raw.registrationNumber),
    registrationDate: registrationDate(raw.registrationDate),
    registrationPlace: legalText(raw.registrationPlace),
  };
}

export async function readCompanyIdentity(config: SystemConfigService): Promise<CompanyIdentity> {
  const [legalName, taxCode, address, bctNoticeUrl, representative, regNumber, regDate, regPlace] = await Promise.all([
    config.get<unknown>(COMPANY_KEYS.legalName, ''),
    config.get<unknown>(COMPANY_KEYS.taxCode, ''),
    config.get<unknown>(COMPANY_KEYS.address, ''),
    config.get<unknown>(COMPANY_KEYS.bctNoticeUrl, ''),
    config.get<unknown>(COMPANY_KEYS.representative, ''),
    config.get<unknown>(COMPANY_KEYS.registrationNumber, ''),
    config.get<unknown>(COMPANY_KEYS.registrationDate, ''),
    config.get<unknown>(COMPANY_KEYS.registrationPlace, ''),
  ]);
  return toCompanyIdentity({ legalName, taxCode, address, bctNoticeUrl, representative, registrationNumber: regNumber, registrationDate: regDate, registrationPlace: regPlace });
}
