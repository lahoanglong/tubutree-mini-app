import { vi } from '../../i18n/vi';
import type { RepurchaseResponse } from '../../services/shop-api';
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
    return { addedLines: selections.length, skippedLines: 0, addedUnits: units, hasProblems: false, message: vi.reorder.addedGeneric };
  }
  const nameOf = (key: string) => lines.find((l) => l.key === key)?.productName ?? vi.reorder.unknownProduct;
  const addedUnits = res.results.reduce((s, r) => s + r.addedQuantity, 0);
  const addedLines = res.results.filter((r) => r.status !== 'skipped').length;
  const skippedLines = res.results.filter((r) => r.status === 'skipped').length;
  const problems = res.results
    .filter((r) => r.status !== 'added')
    .map((r) => `${nameOf(r.orderItemId)} (${r.status === 'partial' ? vi.reorder.partial(r.addedQuantity) : vi.reorder.reasons[r.reason ?? 'OUT_OF_STOCK']})`);
  const message =
    addedUnits > 0
      ? problems.length > 0
        ? `${vi.reorder.added(addedUnits)}. ${vi.reorder.notFullyAdded}: ${problems.join(', ')}`
        : vi.reorder.added(addedUnits)
      : `${vi.reorder.nothingAdded}: ${problems.join(', ')}`;
  return { addedLines, skippedLines, addedUnits, hasProblems: problems.length > 0, message };
}
