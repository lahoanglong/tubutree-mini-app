'use client';

import { apiFetch } from './client-api';
import type { Tone } from './recycling';

/** % hoa hồng CTV của biến thể là PHẦN TRĂM (10 = 10%), NULL = chưa đặt (CTV nhận 0đ). */
export interface CommissionVariation {
  id: string;
  sku: string;
  name: string;
  retailPrice: number;
  salePrice: number | null;
  isActive: boolean;
  affiliateRate: number | null;
  /** Giá sỉ theo bậc đại lý { tierId: đồng }. */
  dealerPrices: Record<string, number> | null;
}
export interface CommissionProduct {
  id: string;
  name: string;
  thumbnail: string | null;
  brand: string;
  isActive: boolean;
  affiliateBlocked: boolean;
  approvalStatus: string;
  /** Hàng gian hàng đối tác tự đăng — không áp hàng loạt. */
  isPartner: boolean;
  variations: CommissionVariation[];
}
export interface CommissionRatesPage {
  items: CommissionProduct[];
  nextCursor: string | null;
  maxRate: number;
  /** missing: biến thể đang bán chưa có %; missingTubu: phần hàng Tubu (phần "áp cho chưa có %" sẽ đổi). */
  summary: { missing: number; missingTubu: number };
}

export type RateImportStatus = 'OK' | 'UNCHANGED' | 'NOT_FOUND' | 'INVALID' | 'OVER_CAP' | 'DUPLICATE';
export interface RateImportRow {
  line: number;
  sku: string;
  input: string;
  status: RateImportStatus;
  rate: number | null;
  currentRate: number | null;
  productName: string | null;
  variationName: string | null;
  message: string | null;
}
export interface RateImportPreview {
  rows: RateImportRow[];
  counts: Record<RateImportStatus, number>;
  blocking: number;
  maxRate: number;
  canApply: boolean;
}

export type CommissionStatus = 'PENDING' | 'LOCKED' | 'APPROVED' | 'PAID' | 'REJECTED';
export interface OrderReferral {
  orderCode: string;
  referrer: { id: string; fullName: string | null; phone: string | null; referralCode: string; role: string } | null;
  selfReferral: boolean;
  placedForCustomer: boolean;
  source: string | null;
  storefront: { id: string; slug: string; title: string; type: string } | null;
  storefrontSlug: string | null;
  commissions: {
    id: string;
    affiliateUserId: string;
    affiliateName: string | null;
    amount: number;
    rate: number;
    commissionableTotal: number;
    status: CommissionStatus;
    createdAt: string;
    lockedAt: string | null;
    approvedAt: string | null;
    paidAt: string | null;
  }[];
}

export const COMMISSION_PAGE_SIZE = 20;

export const listCommissionRates = (p: { q?: string; missing?: boolean; cursor?: string }) => {
  const sp = new URLSearchParams({ take: String(COMMISSION_PAGE_SIZE) });
  if (p.q?.trim()) sp.set('q', p.q.trim());
  if (p.missing) sp.set('missing', '1');
  if (p.cursor) sp.set('cursor', p.cursor);
  return apiFetch<CommissionRatesPage>(`/admin/commission-rates?${sp.toString()}`);
};
export const setVariationRate = (variationId: string, rate: number) =>
  apiFetch<{ id: string; sku: string; affiliateRate: number }>(`/admin/commission-rates/variations/${encodeURIComponent(variationId)}`, {
    method: 'PUT',
    body: { rate },
  });
export const setProductRate = (productId: string, rate: number) =>
  apiFetch<{ productId: string; updated: number; affiliateRate: number }>(`/admin/commission-rates/products/${encodeURIComponent(productId)}`, {
    method: 'PUT',
    body: { rate },
  });
export const fillMissingRates = (rate: number) =>
  apiFetch<{ updated: number; affiliateRate: number }>('/admin/commission-rates/fill-missing', { method: 'POST', body: { rate } });
export const previewRateImport = (csv: string) =>
  apiFetch<RateImportPreview>('/admin/commission-rates/import/preview', { method: 'POST', body: { csv } });
export const applyRateImport = (csv: string) =>
  apiFetch<{ updated: number; unchanged: number; notFound: string[] }>('/admin/commission-rates/import/apply', {
    method: 'POST',
    body: { csv },
  });
export const getOrderReferral = (orderIdOrCode: string) =>
  apiFetch<OrderReferral>(`/admin/orders/${encodeURIComponent(orderIdOrCode)}/referral`);

/** Như API (commission-rate-csv.ts): mức % chỉ là số nguyên — chặn gõ 0.1 thay vì 10. */
export const RATE_MAX_DECIMALS = 0;
const RATE_INPUT_HINT = 'Nhập số nguyên, vd 10 cho 10%.';

/**
 * Đọc ô % admin gõ (giống luật API): nhận `10`, `10%`; chỉ số nguyên; 0 ≤ % ≤ trần.
 * Trả số hoặc câu lỗi tiếng Việt. API vẫn kiểm lại — đây chỉ để báo sớm.
 */
export function parseRateInput(text: string, max: number): { rate: number } | { error: string } {
  const t = text.trim().replace(/%$/, '').trim().replace(',', '.');
  if (!t) return { error: 'Nhập % hoa hồng.' };
  if (!/^\d+(\.\d+)?$/.test(t)) return { error: `Chỉ nhập số. ${RATE_INPUT_HINT}` };
  const rate = Number(t);
  if (Math.round(rate * 10 ** RATE_MAX_DECIMALS) / 10 ** RATE_MAX_DECIMALS !== rate) {
    return { error: `Không phải số nguyên. ${RATE_INPUT_HINT}` };
  }
  if (rate > max) return { error: `Tối đa ${formatRate(max)} (trần cấu hình).` };
  return { rate };
}

/** 7.5 → "7,5%"; null → "Chưa có %". */
export function formatRate(rate: number | null): string {
  return rate === null ? 'Chưa có %' : `${rate.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`;
}

export const RATE_IMPORT_STATUS: Record<RateImportStatus, { label: string; tone: Tone }> = {
  OK: { label: 'Khớp — sẽ đổi', tone: 'success' },
  UNCHANGED: { label: 'Không đổi', tone: 'neutral' },
  NOT_FOUND: { label: 'Không khớp SKU', tone: 'warning' },
  INVALID: { label: 'Sai định dạng', tone: 'danger' },
  OVER_CAP: { label: 'Vượt trần', tone: 'danger' },
  DUPLICATE: { label: 'SKU lặp', tone: 'danger' },
};

/** Cùng chữ CTV thấy trong miniapp (pages/affiliate.tsx) để CSKH và CTV nói cùng một trạng thái. */
export const COMMISSION_STATUS: Record<CommissionStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Đang chờ · đơn chưa giao', tone: 'info' },
  LOCKED: { label: 'Đang chờ · đang giữ', tone: 'warning' },
  APPROVED: { label: 'Có thể rút', tone: 'success' },
  PAID: { label: 'Đã trả', tone: 'neutral' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
};
