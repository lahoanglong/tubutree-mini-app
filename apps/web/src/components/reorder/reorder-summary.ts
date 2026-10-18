import type { RepurchaseResponse } from '@tubutree/app-core/api/orders';
import { reorderText } from '@/lib/home-text';
import type { ReorderLine, ReorderSelection } from './reorder-types';

export interface ReorderSummary {
  addedLines: number;
  skippedLines: number;
  addedUnits: number;
  hasProblems: boolean;
  message: string;
}

/** Câu báo kết quả mua lại — nêu rõ dòng nào không thêm được và vì sao (spec §3.3, §9). */
export function summarizeReorder(res: RepurchaseResponse, lines: ReorderLine[], selections: ReorderSelection[]): ReorderSummary {
  if (res.legacy) {
    const units = selections.reduce((s, x) => s + x.quantity, 0);
    return { addedLines: selections.length, skippedLines: 0, addedUnits: units, hasProblems: false, message: reorderText.addedGeneric };
  }
  // Cùng tên sản phẩm lặp lại trong đơn (khác phân loại) → kèm tên phân loại để biết dòng nào bị bỏ.
  const nameOf = (key: string) => {
    const l = lines.find((x) => x.key === key);
    if (!l) return reorderText.unknownProduct;
    const repeated = lines.filter((x) => x.productName === l.productName).length > 1;
    return repeated && l.variationName ? `${l.productName} - ${l.variationName}` : l.productName;
  };
  const addedUnits = res.results.reduce((s, r) => s + r.addedQuantity, 0);
  const addedLines = res.results.filter((r) => r.status !== 'skipped').length;
  const skippedLines = res.results.filter((r) => r.status === 'skipped').length;
  const problems = res.results
    .filter((r) => r.status !== 'added')
    .map((r) => `${nameOf(r.orderItemId)} (${r.status === 'partial' ? reorderText.partial(r.addedQuantity) : reorderText.reasons[r.reason ?? 'OUT_OF_STOCK']})`);
  const message =
    addedUnits > 0
      ? problems.length > 0
        ? `${reorderText.added(addedUnits)}. ${reorderText.notFullyAdded}: ${problems.join(', ')}`
        : reorderText.added(addedUnits)
      : problems.length > 0
        ? `${reorderText.nothingAdded}: ${problems.join(', ')}`
        : reorderText.nothingAdded;
  // Không thêm được đơn vị nào thì luôn là "có vấn đề", kể cả khi server không nêu dòng lỗi.
  return { addedLines, skippedLines, addedUnits, hasProblems: problems.length > 0 || addedUnits === 0, message };
}
