'use client';

import { dropOffDayLimitText, itemQtyMax } from '@tubutree/app-core/waste-copy';
import { useMemo } from 'react';
import type { WasteMeItemDTO } from '@tubutree/shared-types';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { QuantitySelector } from '@/components/ui/quantity-selector';
import { QUICK_QTY_STEPS, WAREHOUSE_ONLY_TEXT } from '@tubutree/app-core/waste-copy';
import { WasteItemThumb } from './waste-item-thumb';
import { UNCAPPED_QTY_MAX, capSentence, groupProgressText, monthRemainingText, ruleText } from './recycle-labels';

interface WasteItemStepProps {
  items: readonly WasteMeItemDTO[];
  lines: Readonly<Record<string, number>>;
  onChange: (itemId: string, qty: number) => void;
  /** Số lượng đã khai ở yêu cầu đang sửa, cộng lại vào trần còn lại. */
  allowance?: Readonly<Record<string, number>>;
  /** Sai khi sửa một yêu cầu không tạo hôm nay: máy chủ tính trần ngày theo ngày của yêu cầu nên khách không áp trần ngày. */
  dayCap?: boolean;
}

/** Bước chọn món: thẻ từng món với quy tắc điểm, hạn mức và bộ đếm; món sắp nhận mờ đi và không có bộ đếm. */
export function WasteItemStep({ items, lines, onChange, allowance, dayCap = true }: WasteItemStepProps) {
  const sorted = useMemo(() => items.filter((i) => i.status !== 'HIDDEN').sort((a, b) => a.sortOrder - b.sortOrder), [items]);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {sorted.map((item) => {
        const qty = lines[item.id] ?? 0;
        const dayLine = dropOffDayLimitText(item, allowance?.[item.id] ?? 0, dayCap);
        const cap = capSentence(item, dayLine !== null);
        const monthLeft = monthRemainingText(item);
        const progress = groupProgressText(qty, item);
        const comingSoon = item.status === 'COMING_SOON';
        return (
          <div
            key={item.id}
            data-item
            data-status={item.status}
            aria-disabled={comingSoon || undefined}
            className="flex gap-3 rounded-card border border-stone-200 bg-stone-0 p-3"
          >
            <span data-item-media>
              <WasteItemThumb item={item} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold max-md:text-[length:var(--type-body-md-size)] ${comingSoon ? 'text-stone-500' : 'text-stone-900'}`}>{item.name}</span>
                {comingSoon && <Badge>Sắp nhận</Badge>}
              </div>
              <p className={`text-xs max-md:text-[length:var(--type-caption-size)] max-md:leading-[var(--type-caption-lh)] ${comingSoon ? 'text-stone-500' : 'text-stone-700'}`}>{ruleText(item)}</p>
              {item.warehouseOnly && (
                <div>
                  <Badge tone="info" size="sm">{WAREHOUSE_ONLY_TEXT}</Badge>
                </div>
              )}
              {item.prepInstructions && <p className="text-xs text-stone-600 max-md:text-[length:var(--type-caption-size)] max-md:leading-[var(--type-caption-lh)]">{item.prepInstructions}</p>}
              {cap && <p className="text-xs text-stone-600 max-md:text-[length:var(--type-caption-size)] max-md:leading-[var(--type-caption-lh)]">{cap}</p>}
              {monthLeft && <p className={`text-xs max-md:text-[length:var(--type-caption-size)] max-md:leading-[var(--type-caption-lh)] ${item.monthRemainingQty === 0 ? 'text-warning-fg' : 'text-stone-600'}`}>{monthLeft}</p>}
              {dayLine && item.status === 'ACTIVE' && <p className="text-xs text-warning-fg max-md:text-[length:var(--type-caption-size)] max-md:leading-[var(--type-caption-lh)]">{dayLine}</p>}
              {item.status === 'ACTIVE' && (
                <div className="mt-1 flex flex-col gap-2">
                  <div>
                    <QuantitySelector
                      size="sm"
                      editable
                      quickSteps={QUICK_QTY_STEPS}
                      min={0}
                      max={itemQtyMax(item, allowance?.[item.id] ?? 0, UNCAPPED_QTY_MAX, dayCap)}
                      value={qty}
                      onChange={(n) => onChange(item.id, n)}
                    />
                  </div>
                  {progress && <ProgressBar value={qty % item.unitsPerPoint} max={item.unitsPerPoint} label={progress} />}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
