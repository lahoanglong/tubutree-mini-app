import { trimInvisible } from '../../common/text-trim';
import type { SystemConfigService } from './system-config.service';

export const COMPANY_KEYS = {
  legalName: 'company.legal_name',
  taxCode: 'company.tax_code',
  address: 'company.address',
  bctNoticeUrl: 'company.bct_notice_url',
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

export interface CompanyIdentity {
  legalName: string | null;
  taxCode: string | null;
  address: string | null;
  bctNoticeUrl: string | null;
}

export function toCompanyIdentity(raw: { legalName: unknown; taxCode: unknown; address: unknown; bctNoticeUrl: unknown }): CompanyIdentity {
  return { legalName: text(raw.legalName), taxCode: text(raw.taxCode), address: text(raw.address), bctNoticeUrl: bctNoticeUrl(raw.bctNoticeUrl) };
}

export async function readCompanyIdentity(config: SystemConfigService): Promise<CompanyIdentity> {
  const [legalName, taxCode, address, bctNoticeUrl] = await Promise.all([
    config.get<unknown>(COMPANY_KEYS.legalName, ''),
    config.get<unknown>(COMPANY_KEYS.taxCode, ''),
    config.get<unknown>(COMPANY_KEYS.address, ''),
    config.get<unknown>(COMPANY_KEYS.bctNoticeUrl, ''),
  ]);
  return toCompanyIdentity({ legalName, taxCode, address, bctNoticeUrl });
}
