import { DEFAULT_LEGAL_VARS, type LegalSlug, type LegalVars } from '@tubutree/app-core/legal';
import { api } from './api';

export type { LegalSlug };

const nonNegativeOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

/** Nội dung đã duyệt do admin nhập (cùng nguồn với web /chinh-sach/<loại>); null khi chưa nhập, kèm số liệu để dựng bản nháp. */
export async function fetchLegalDoc(slug: LegalSlug): Promise<{ content: string | null; vars: LegalVars }> {
  const { data } = await api.get<{ content?: unknown; vars?: Record<string, unknown> }>(`/config/legal/${slug}`);
  const v = data?.vars;
  const legalName = text(v?.legalName);
  const taxCode = text(v?.taxCode);
  const address = text(v?.address);
  return {
    content: typeof data?.content === 'string' && data.content.trim() !== '' ? data.content : null,
    vars: {
      returnWindowDays: nonNegativeOr(v?.returnWindowDays, DEFAULT_LEGAL_VARS.returnWindowDays),
      freeshipThreshold: nonNegativeOr(v?.freeshipThreshold, DEFAULT_LEGAL_VARS.freeshipThreshold),
      shippingFlatFee: nonNegativeOr(v?.shippingFlatFee, DEFAULT_LEGAL_VARS.shippingFlatFee ?? 0),
      ...(legalName ? { legalName } : {}),
      ...(taxCode ? { taxCode } : {}),
      ...(address ? { address } : {}),
    },
  };
}
