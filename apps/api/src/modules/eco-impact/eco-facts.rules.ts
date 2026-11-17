import { claimsIn } from '@tubutree/shared-types';

export const ECO_BADGES_KEY = 'eco.product_badges_enabled';
export const ECO_PASSPORT_KEY = 'eco.passport_enabled';

export const ECO_FACT_KINDS = ['REFILL_PACK', 'PLASTIC_AVOIDED', 'RETURNABLE_PACKAGING', 'CERTIFICATION', 'INGREDIENT_ORIGIN'] as const;
export type EcoFactKindName = (typeof ECO_FACT_KINDS)[number];
export const ECO_FACT_STATUSES = ['DRAFT', 'APPROVED', 'RETIRED'] as const;
export type EcoFactStatusName = (typeof ECO_FACT_STATUSES)[number];

/** Loại được đưa lên thẻ sản phẩm (app-core chọn tối đa một nhãn theo thứ tự này, sau "Mới"). INGREDIENT_ORIGIN chỉ ở trang sản phẩm. */
export const CARD_FACT_KINDS: readonly EcoFactKindName[] = ['REFILL_PACK', 'PLASTIC_AVOIDED', 'RETURNABLE_PACKAGING', 'CERTIFICATION'];

export const ECO_LIMITS = {
  baselineText: 120,
  label: 80,
  sourceUrl: 500,
  sourceNote: 300,
  maxGrams: 1_000_000,
  /** Số sự thật tối đa trên khối "Điểm cộng xanh" của trang sản phẩm. */
  pdpFacts: 4,
} as const;

/** Dạng công khai của một sự thật đã duyệt (trang sản phẩm). Không có `sourceNote`, người duyệt, mốc giờ. */
export interface PublicEcoFact {
  kind: EcoFactKindName;
  variationId: string | null;
  valueGrams: number | null;
  baselineText: string | null;
  label: string | null;
  co2Grams: number | null;
  sourceUrl: string;
}

/** Dạng gọn trên thẻ sản phẩm: đủ để app-core chọn và viết nhãn, không có link. */
export interface CardEcoFact {
  kind: EcoFactKindName;
  valueGrams: number | null;
  label: string | null;
}

export type FactRow = {
  kind: string;
  variationId: string | null;
  valueGrams: number | null;
  baselineText: string | null;
  label: string | null;
  co2Grams: number | null;
  sourceUrl: string;
};

export const isEcoFactKind = (v: unknown): v is EcoFactKindName => typeof v === 'string' && (ECO_FACT_KINDS as readonly string[]).includes(v);
export const isEcoFactStatus = (v: unknown): v is EcoFactStatusName => typeof v === 'string' && (ECO_FACT_STATUSES as readonly string[]).includes(v);

const kindRank = (k: string): number => {
  const i = (ECO_FACT_KINDS as readonly string[]).indexOf(k);
  return i < 0 ? ECO_FACT_KINDS.length : i;
};

/**
 * Sự thật áp cho một phân loại: dòng cấp sản phẩm (`variationId` null) cộng dòng của đúng phân loại đó; cùng loại thì dòng của phân loại
 * thắng (cụ thể hơn), nên một món không bị tính hai lần. `variationId` null: chỉ dòng cấp sản phẩm.
 */
export function factsForVariation<T extends { kind: string; variationId: string | null }>(rows: readonly T[], variationId: string | null | undefined): T[] {
  const byKind = new Map<string, T>();
  for (const r of rows) {
    if (r.variationId !== null && r.variationId !== variationId) continue;
    const prev = byKind.get(r.kind);
    if (!prev || (prev.variationId === null && r.variationId !== null)) byKind.set(r.kind, r);
  }
  return [...byKind.values()].sort((a, b) => kindRank(a.kind) - kindRank(b.kind));
}

export function publicFact(r: FactRow): PublicEcoFact {
  return {
    kind: r.kind as EcoFactKindName,
    variationId: r.variationId,
    valueGrams: r.valueGrams,
    baselineText: r.baselineText,
    label: r.label,
    co2Grams: r.co2Grams,
    sourceUrl: r.sourceUrl,
  };
}

/** Sự thật lên thẻ của một sản phẩm (phân loại đại diện của thẻ), theo thứ tự ưu tiên; rỗng thì thẻ không có trường. */
export function cardFacts(rows: readonly FactRow[], repVariationId: string | null | undefined): CardEcoFact[] {
  return factsForVariation(rows, repVariationId ?? null)
    .filter((r) => (CARD_FACT_KINDS as readonly string[]).includes(r.kind))
    .map((r) => ({ kind: r.kind as EcoFactKindName, valueGrams: r.valueGrams, label: r.label }));
}

/** Chỉ link https không kèm user:pass, dài tối đa ECO_LIMITS.sourceUrl; trả dạng chuẩn hoá hoặc null. */
export function httpsSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw === '' || raw.length > ECO_LIMITS.sourceUrl) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null;
    const out = u.toString();
    return out.length > ECO_LIMITS.sourceUrl ? null : out;
  } catch {
    return null;
  }
}

/**
 * Nhãn tuyên bố của chữ công khai. `label` của CERTIFICATION/INGREDIENT_ORIGIN được phép nêu tên giấy tờ hay vùng nguyên liệu (nhóm `proof`)
 * vì dòng đó chỉ duyệt được khi có `sourceUrl`; các nhóm còn lại (y tế, "tự nhiên", tre) vẫn chặn. Mốc so sánh bị xét đủ mọi nhóm.
 */
export function factClaims(f: { kind: string; baselineText: string | null; label: string | null }): string[] {
  const out = new Set<string>();
  if (f.baselineText) for (const c of claimsIn(f.baselineText, 'strict')) out.add(c);
  if (f.label) {
    const proofAllowed = f.kind === 'CERTIFICATION' || f.kind === 'INGREDIENT_ORIGIN';
    for (const c of claimsIn(f.label, 'strict')) if (!(proofAllowed && c === 'proof')) out.add(c);
  }
  return [...out];
}

export type ApprovalBlocker = 'source_url' | 'source_note' | 'value_grams' | 'label' | 'claims';

/** Lý do chưa duyệt được một dòng; rỗng là duyệt được. */
export function approvalBlockers(f: {
  kind: string;
  valueGrams: number | null;
  baselineText: string | null;
  label: string | null;
  sourceUrl: string;
  sourceNote: string;
}): ApprovalBlocker[] {
  const out: ApprovalBlocker[] = [];
  if (!httpsSourceUrl(f.sourceUrl)) out.push('source_url');
  if (f.sourceNote.trim() === '') out.push('source_note');
  if (f.kind === 'PLASTIC_AVOIDED' && !(typeof f.valueGrams === 'number' && f.valueGrams > 0)) out.push('value_grams');
  if ((f.kind === 'CERTIFICATION' || f.kind === 'INGREDIENT_ORIGIN') && !(f.label && f.label.trim())) out.push('label');
  if (factClaims(f).length > 0) out.push('claims');
  return out;
}

export const BLOCKER_TEXT: Record<ApprovalBlocker, string> = {
  source_url: 'Thiếu link nguồn https.',
  source_note: 'Thiếu ghi chú nguồn (trang, bảng số).',
  value_grams: 'Giảm nhựa cần số gam lớn hơn 0.',
  label: 'Loại này cần chữ hiển thị (tên giấy tờ hoặc vùng nguyên liệu).',
  claims: 'Chữ dính bộ chặn tuyên bố (y tế, "tự nhiên", tre, hoặc con số/chứng nhận không thuộc loại giấy tờ).',
};
