import { fillTemplate } from '../copy-template';
import { ecoFactsFor, ecoGrams } from './facts';

/**
 * Chữ "Điểm cộng xanh" chỉ có ở web: link nguồn mở được (webview Zalo chặn link ngoài), thẻ so sánh, hàng của bảng "So với món tương tự" và
 * dòng dẫn sang Hộ chiếu Xanh. Tách khỏi
 * `ECO_COPY` (nằm trong gói đầu Mini qua `SHOP_COPY`) vì gói Mini chỉ còn 4.000 B cho cả đợt; `eco.spec.ts` chạy `FORBIDDEN_TERMS`, bộ chặn
 * tuyên bố và ngân sách `ECO_WEB_COPY_MAX` trên từng khoá.
 */
export const ECO_WEB_COPY = {
  newTab: 'mở trang mới',
  passportLink: 'Xem Hộ chiếu Xanh của bạn',
  cmpThis: 'Món này',
  cmpSaved: 'Bớt ~{g} nhựa (ước tính)',
  cmpBottles: '≈ {n} chai',
  rowTitle: 'Điểm cộng xanh',
  rowCount: '{n} điểm cộng',
} as const;

export type EcoWebCopyKey = keyof typeof ECO_WEB_COPY;

/** Số ký tự tối đa khi điền giá trị xấu nhất; null = câu dài. Chỉ spec đọc. */
export const ECO_WEB_COPY_MAX: Record<EcoWebCopyKey, number | null> = {
  newTab: 14,
  passportLink: 28,
  cmpThis: 10,
  cmpSaved: 32,
  cmpBottles: 14,
  rowTitle: 16,
  rowCount: 14,
};

export function fillEcoWebCopy(key: EcoWebCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(ECO_WEB_COPY[key], vars, key);
}

export interface EcoCompareCard {
  saved: string;
  baseline: string;
  bottles: string | null;
}

/** Thẻ so sánh hai cột: chỉ khi Giảm nhựa có số gam và mốc so sánh. Số chai lấy từ mốc ("20 chai 500ml"), không có thì bỏ. */
export function ecoCompareCard(facts: unknown, variationId: string | null | undefined): EcoCompareCard | null {
  const f = ecoFactsFor(facts, variationId).find((x) => x.kind === 'PLASTIC_AVOIDED');
  const g = f ? ecoGrams(f.valueGrams) : null;
  const base = f && typeof f.baselineText === 'string' ? f.baselineText.trim() : '';
  if (!f || !g || !base) return null;
  const n = /(\d{1,4})\s*chai/i.exec(base)?.[1];
  return { saved: fillEcoWebCopy('cmpSaved', { g }), baseline: base.charAt(0).toUpperCase() + base.slice(1), bottles: n ? fillEcoWebCopy('cmpBottles', { n }) : null };
}

/**
 * Ô hàng "Điểm cộng xanh" của bảng so sánh: số loại sự thật đã duyệt (`CompareItem.ecoFactCount`, máy chủ chỉ gửi khi cờ nhãn xanh bật).
 * 0 hay thiếu thì null (ô ghi "—").
 */
export function ecoCountCell(raw: unknown): string | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? fillEcoWebCopy('rowCount', { n: raw }) : null;
}

/** Bảng so sánh có hàng "Điểm cộng xanh" khi máy chủ gửi số đếm cho ít nhất một món (cả hai cờ bật). */
export const hasEcoCounts = (items: readonly unknown[]): boolean => items.some((it) => typeof (it as { ecoFactCount?: unknown } | null)?.ecoFactCount === 'number');
