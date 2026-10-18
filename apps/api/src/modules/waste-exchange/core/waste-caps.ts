import type { WasteLineInput } from '@tubutree/shared-types';
import type { WasteCapUsage } from './waste-hold.service';

export interface WasteCapItem { id: string; name: string; unitLabel: string; dailyCapQty: number | null; monthlyCapQty: number | null }

export type WasteCapViolation =
  | { code: 'ITEM_DAY_CAP' | 'ITEM_MONTH_CAP'; itemId: string; remaining: number }
  | { code: 'POINTS_MONTH_CAP'; remaining: number };

export function remainingQty(cap: number | null, used: number): number | null {
  return cap === null ? null : Math.max(0, cap - used);
}

export function checkCaps(a: {
  lines: WasteLineInput[];
  items: Map<string, WasteCapItem>;
  usage: WasteCapUsage;
  estimatedPoints: number;
  monthlyCapPoints: number;
  checkDay: boolean;
}): WasteCapViolation[] {
  const out: WasteCapViolation[] = [];
  const over = (kind: 'ITEM_DAY_CAP' | 'ITEM_MONTH_CAP', cap: (i: WasteCapItem) => number | null, used: Map<string, number>) => {
    for (const line of a.lines) {
      const item = a.items.get(line.itemId);
      const limit = item ? cap(item) : null;
      if (limit === null) continue;
      const u = used.get(line.itemId) ?? 0;
      if (u + line.declaredQty > limit) out.push({ code: kind, itemId: line.itemId, remaining: remainingQty(limit, u) as number });
    }
  };
  if (a.checkDay) over('ITEM_DAY_CAP', (i) => i.dailyCapQty, a.usage.itemDay);
  over('ITEM_MONTH_CAP', (i) => i.monthlyCapQty, a.usage.itemMonth);
  const pointsLeft = Math.max(0, a.monthlyCapPoints - a.usage.pointsMonth);
  if (a.estimatedPoints > pointsLeft) out.push({ code: 'POINTS_MONTH_CAP', remaining: pointsLeft });
  return out;
}
