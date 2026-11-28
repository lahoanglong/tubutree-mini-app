'use client';

import { apiFetch } from '@/lib/client-api';

export type EcoFactKind = 'REFILL_PACK' | 'PLASTIC_AVOIDED' | 'RETURNABLE_PACKAGING' | 'CERTIFICATION' | 'INGREDIENT_ORIGIN';
export type EcoFactStatus = 'DRAFT' | 'APPROVED' | 'RETIRED';

export const ECO_KIND_LABEL: Record<EcoFactKind, string> = {
  REFILL_PACK: 'Can refill',
  PLASTIC_AVOIDED: 'Giảm nhựa (gam mỗi món)',
  RETURNABLE_PACKAGING: 'Vỏ trả lại được',
  CERTIFICATION: 'Giấy tờ chứng nhận',
  INGREDIENT_ORIGIN: 'Vùng nguyên liệu',
};
export const ECO_KINDS = Object.keys(ECO_KIND_LABEL) as EcoFactKind[];

export const ECO_STATUS_LABEL: Record<EcoFactStatus, string> = { DRAFT: 'Nháp', APPROVED: 'Đã duyệt', RETIRED: 'Ngừng dùng' };

/** Một dòng của `GET /admin/eco-facts` (`AdminEcoFact` ở `apps/api/src/modules/eco-impact/eco-facts-admin.service.ts`). */
export interface AdminEcoFact {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  variationId: string | null;
  variationName: string | null;
  variationSku: string | null;
  kind: EcoFactKind;
  valueGrams: number | null;
  baselineText: string | null;
  label: string | null;
  co2Grams: number | null;
  sourceUrl: string;
  /** `internal_sheet`: phiếu cân nội bộ ở tubutree.com; `external`: nguồn ngoài; null: chưa có link https hợp lệ. */
  sourceKind: 'internal_sheet' | 'external' | null;
  sourceNote: string;
  status: EcoFactStatus;
  approvedById: string | null;
  approvedAt: string | null;
  updatedAt: string;
  blockers: { code: string; message: string }[];
}

export interface EcoFactForm {
  productSlug: string;
  variationSku: string;
  kind: EcoFactKind;
  valueGrams: string;
  baselineText: string;
  label: string;
  co2Grams: string;
  sourceUrl: string;
  sourceNote: string;
}

export interface EcoImportResult {
  created: number;
  updated: number;
  skippedApproved: number;
  errors: { line: number; message: string }[];
}

export interface EcoBatchApproveResult {
  approved: string[];
  skipped: { id: string; reason: 'not_found' | 'conflict' | 'not_draft' | 'blocked'; message: string }[];
}

export interface EcoRefillDraftResult {
  refillProducts: number;
  created: number;
  skippedExisting: number;
}

/** Số dòng tối đa một lần duyệt hàng loạt; bằng `APPROVE_BATCH_MAX` của eco-facts-admin.service.ts. */
export const ECO_APPROVE_BATCH_MAX = 50;

/** Giới hạn độ dài, cùng số với cột của bảng `product_eco_facts` (schema.prisma). */
export const ECO_FIELD_MAX = { baselineText: 120, label: 80, sourceUrl: 500, sourceNote: 300 } as const;

export const EMPTY_FORM: EcoFactForm = { productSlug: '', variationSku: '', kind: 'REFILL_PACK', valueGrams: '', baselineText: '', label: '', co2Grams: '', sourceUrl: '', sourceNote: '' };

export const formOf = (f: AdminEcoFact): EcoFactForm => ({
  productSlug: f.productSlug,
  variationSku: f.variationSku ?? '',
  kind: f.kind,
  valueGrams: f.valueGrams == null ? '' : String(f.valueGrams),
  baselineText: f.baselineText ?? '',
  label: f.label ?? '',
  co2Grams: f.co2Grams == null ? '' : String(f.co2Grams),
  sourceUrl: f.sourceUrl,
  sourceNote: f.sourceNote,
});

/** Ô số để trống gửi null; chữ không đọc được thành số gửi nguyên để máy chủ báo lỗi đúng trường. */
const num = (s: string): number | string | null => {
  const t = s.trim();
  if (t === '') return null;
  return /^\d+$/.test(t) ? Number(t) : t;
};

export const bodyOf = (f: EcoFactForm) => ({
  productSlug: f.productSlug.trim(),
  variationSku: f.variationSku.trim() || null,
  kind: f.kind,
  valueGrams: f.kind === 'PLASTIC_AVOIDED' ? num(f.valueGrams) : null,
  baselineText: f.baselineText.trim() || null,
  label: f.label.trim() || null,
  co2Grams: num(f.co2Grams),
  sourceUrl: f.sourceUrl.trim(),
  sourceNote: f.sourceNote.trim(),
});

export const listEcoFacts = (status: EcoFactStatus | 'ALL') =>
  apiFetch<{ items: AdminEcoFact[] }>(`/admin/eco-facts${status === 'ALL' ? '' : `?status=${status}`}`);
export const createEcoFact = (f: EcoFactForm) => apiFetch<AdminEcoFact>('/admin/eco-facts', { method: 'POST', body: bodyOf(f) });
export const updateEcoFact = (id: string, f: EcoFactForm, expectedUpdatedAt: string) =>
  apiFetch<AdminEcoFact>(`/admin/eco-facts/${encodeURIComponent(id)}`, { method: 'PATCH', body: { ...bodyOf(f), expectedUpdatedAt } });
export const approveEcoFact = (row: AdminEcoFact) =>
  apiFetch<AdminEcoFact>(`/admin/eco-facts/${encodeURIComponent(row.id)}/approve`, { method: 'POST', body: { expectedUpdatedAt: row.updatedAt } });
export const retireEcoFact = (id: string) => apiFetch<AdminEcoFact>(`/admin/eco-facts/${encodeURIComponent(id)}/retire`, { method: 'POST' });
export const importEcoFacts = (csv: string) => apiFetch<EcoImportResult>('/admin/eco-facts/import', { method: 'POST', body: { csv } });
export const approveEcoFactsBatch = (rows: Pick<AdminEcoFact, 'id' | 'updatedAt'>[]) =>
  apiFetch<EcoBatchApproveResult>('/admin/eco-facts/approve-batch', { method: 'POST', body: { items: rows.map((r) => ({ id: r.id, expectedUpdatedAt: r.updatedAt })) } });
export const createRefillDrafts = (sheetUrl: string, sourceNote: string) =>
  apiFetch<EcoRefillDraftResult>('/admin/eco-facts/refill-drafts', { method: 'POST', body: { sheetUrl: sheetUrl.trim() || null, sourceNote: sourceNote.trim() || null } });
