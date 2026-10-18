'use client';

import { apiFetch } from './client-api';
import { formatVnd } from './format-vnd';

export interface DealerAccountRow {
  userId: string;
  fullName: string | null;
  phone: string | null;
  tier: { id: string; name: string | null } | null;
  creditLimit: number;
  /** Dư nợ (đồng): dương = đang nợ. */
  debt: number;
  overLimit: boolean;
  /** Doanh số tháng này đã chốt (đã thanh toán hoặc ghi công nợ, đã đóng gói). */
  monthSales: number;
  monthPending: number;
  monthOrders: number;
}
export interface DealerAccountsPage {
  data: DealerAccountRow[];
  meta: { page: number; limit: number; total: number };
  /** 'YYYY-MM' giờ VN. */
  month: string;
  summary: { totalDebt: number; debtors: number };
}
export const DEALER_ACCOUNTS_PAGE_SIZE = 20;

export const listDealerAccounts = (p: { page: number; search?: string; tierId?: string; debtOnly?: boolean }) => {
  const sp = new URLSearchParams({ page: String(p.page), limit: String(DEALER_ACCOUNTS_PAGE_SIZE) });
  if (p.search?.trim()) sp.set('search', p.search.trim());
  if (p.tierId) sp.set('tierId', p.tierId);
  if (p.debtOnly) sp.set('debtOnly', '1');
  return apiFetch<DealerAccountsPage>(`/admin/dealers/accounts?${sp.toString()}`);
};

export interface DealerTierRow {
  id: string;
  name: string;
  minOrderVolume: number;
  /** Phần trăm: 30 là 30%. */
  discountPct: number;
  creditLimit: number;
  paymentTerms: string | null;
  dealerCount: number;
}
export interface DealerTiersView {
  tiers: DealerTierRow[];
  /** Trần chiết khấu (phần trăm) theo khoá dealer.max_discount_pct. */
  maxDiscountPct: number;
  dealersWithoutTier: number;
}
export const listDealerTiersForEdit = () => apiFetch<DealerTiersView>('/admin/dealer-tiers/manage');

export interface TierValues {
  name: string;
  minOrderVolume: number;
  discountPct: number;
  creditLimit: number;
  paymentTerms: string | null;
}
export const createDealerTier = (input: TierValues & { id: string }) =>
  apiFetch<TierValues & { id: string }>('/admin/dealer-tiers', { method: 'POST', body: input });
export const updateDealerTier = (id: string, input: TierValues) =>
  apiFetch<TierValues & { id: string }>(`/admin/dealer-tiers/${encodeURIComponent(id)}`, { method: 'PUT', body: input });

export interface DealerTierHistoryRow {
  id: string;
  tierId: string;
  action: 'CREATE' | 'UPDATE' | string;
  oldValue: TierValues | null;
  newValue: TierValues;
  changedAt: string;
  changedBy: { id: string; fullName: string | null; phone: string | null };
}
export const listDealerTierHistory = () => apiFetch<DealerTierHistoryRow[]>('/admin/dealer-tiers/history');

// ── Ô nhập: chuỗi admin gõ → số, kiểm sớm đúng luật API (API vẫn kiểm lại và là chốt chặn cuối) ──
export interface TierFormInput {
  id: string;
  name: string;
  minOrderVolume: string;
  discountPct: string;
  creditLimit: string;
  paymentTerms: string;
}
export const emptyTierForm = (): TierFormInput => ({ id: '', name: '', minOrderVolume: '0', discountPct: '', creditLimit: '0', paymentTerms: '' });
export const tierToForm = (t: Omit<DealerTierRow, 'dealerCount'> & { dealerCount?: number }): TierFormInput => ({
  id: t.id,
  name: t.name,
  minOrderVolume: String(t.minOrderVolume),
  discountPct: String(t.discountPct),
  creditLimit: String(t.creditLimit),
  paymentTerms: t.paymentTerms ?? '',
});

const TIER_MAX_VND = 2_000_000_000;
const TIER_ID_RE = /^[A-Z][A-Z0-9_]{1,31}$/;
const TERMS_RE = /^(PREPAID|NET (?:[1-9]\d?|[12]\d\d|3[0-5]\d|36[0-5]))$/;

export function parseTierForm(
  f: TierFormInput,
  maxDiscountPct: number,
  creating: boolean,
): { value: TierValues & { id: string } } | { errors: string[] } {
  const errors: string[] = [];
  const id = f.id.trim();
  if (creating && !TIER_ID_RE.test(id)) errors.push('Mã bậc gồm chữ in hoa, số, gạch dưới, bắt đầu bằng chữ, dài 2–32 ký tự (vd DEALER_1).');
  const name = f.name.trim();
  if (!name) errors.push('Nhập tên bậc.');
  else if (name.length > 60) errors.push('Tên bậc tối đa 60 ký tự.');

  const pctText = f.discountPct.trim().replace(/%$/, '').trim().replace(',', '.');
  const pct = /^\d+(\.\d+)?$/.test(pctText) ? Number(pctText) : Number.NaN;
  if (!Number.isFinite(pct) || pct <= 0) errors.push('Chiết khấu phải là số lớn hơn 0 (30 nghĩa là 30%).');
  else if (Math.abs(pct * 100 - Math.round(pct * 100)) > 1e-9) errors.push('Chiết khấu tối đa 2 chữ số thập phân.');
  else if (Math.round(pct * 100) > Math.round(maxDiscountPct * 100)) {
    errors.push(`Chiết khấu tối đa ${maxDiscountPct}% (trần cấu hình dealer.max_discount_pct).`);
  }

  const vnd = (text: string, label: string): number => {
    const t = text.trim();
    const n = /^\d+$/.test(t) ? Number(t) : Number.NaN;
    if (!Number.isInteger(n) || n < 0 || n > TIER_MAX_VND) {
      errors.push(`${label} phải là số đồng nguyên từ 0 đến ${TIER_MAX_VND.toLocaleString('vi-VN')}.`);
      return 0;
    }
    return n;
  };
  const minOrderVolume = vnd(f.minOrderVolume, 'Doanh số tối thiểu');
  const creditLimit = vnd(f.creditLimit, 'Hạn mức công nợ');

  const terms = f.paymentTerms.trim();
  if (terms && !TERMS_RE.test(terms)) errors.push('Điều kiện thanh toán là PREPAID (trả trước) hoặc NET <số ngày>, ví dụ NET 30.');

  if (errors.length > 0) return { errors };
  return { value: { id, name, minOrderVolume, discountPct: pct, creditLimit, paymentTerms: terms || null } };
}

export function formatTerms(terms: string | null | undefined): string {
  if (!terms) return 'Chưa đặt';
  if (terms === 'PREPAID') return 'Trả trước';
  const m = /^NET (\d+)$/.exec(terms);
  return m ? `Công nợ ${m[1]} ngày` : terms;
}

const pctText = (n: number) => `${n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`;

/** Các trường khác nhau giữa hai ảnh chụp bậc (`before` null = tạo mới), mỗi dòng một câu tiếng Việt. */
export function diffTier(before: TierValues | null, after: TierValues): string[] {
  const out: string[] = [];
  const line = (label: string, a: string | null, b: string) => {
    if (a === null) out.push(`${label} ${b}`);
    else if (a !== b) out.push(`${label} ${a} → ${b}`);
  };
  line('Tên', before?.name ?? null, after.name);
  line('Doanh số tối thiểu', before ? formatVnd(before.minOrderVolume) : null, formatVnd(after.minOrderVolume));
  line('Chiết khấu', before ? pctText(before.discountPct) : null, pctText(after.discountPct));
  line('Hạn mức công nợ', before ? formatVnd(before.creditLimit) : null, formatVnd(after.creditLimit));
  line('Điều kiện thanh toán', before ? formatTerms(before.paymentTerms) : null, formatTerms(after.paymentTerms));
  return out;
}
