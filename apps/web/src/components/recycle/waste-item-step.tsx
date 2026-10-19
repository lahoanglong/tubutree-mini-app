'use client';

import { useMemo } from 'react';
import type { WasteMeItemDTO } from '@tubutree/shared-types';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { QuantitySelector } from '@/components/ui/quantity-selector';
import { ProductThumb } from '@/components/mini';
import { UNCAPPED_QTY_MAX, capSentence, groupProgressText, monthRemainingText, ruleText } from './recycle-labels';

interface WasteItemStepProps {
  items: readonly WasteMeItemDTO[];
  lines: Readonly<Record<string, number>>;
  onChange: (itemId: string, qty: number) => void;
  /** Số lượng đã khai ở yêu cầu đang sửa, cộng lại vào trần còn lại. */
  allowance?: Readonly<Record<string, number>>;
}

/** Bước chọn món: thẻ từng món với quy tắc điểm, hạn mức và bộ đếm; món sắp nhận mờ đi và không có bộ đếm. */
export function WasteItemStep({ items, lines, onChange, allowance }: WasteItemStepProps) {
  const sorted = useMemo(() => items.filter((i) => i.status !== 'HIDDEN').sort((a, b) => a.sortOrder - b.sortOrder), [items]);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {sorted.map((item) => {
        const qty = lines[item.id] ?? 0;
        const cap = capSentence(item);
        const monthLeft = monthRemainingText(item);
        const progress = groupProgressText(qty, item);
        const comingSoon = item.status === 'COMING_SOON';
        return (
          <div
            key={item.id}
            data-item
            data-status={item.status}
            className={`flex gap-3 rounded-card border border-stone-200 bg-stone-0 p-3 ${comingSoon ? 'opacity-[.55]' : ''}`}
          >
            <span data-item-media>
              <ProductThumb src={item.imageUrl} alt="" size={48} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-stone-900 max-md:text-[length:var(--type-body-md-size)]">{item.name}</span>
                {comingSoon && <Badge>Sắp nhận</Badge>}
              </div>
              <p className="text-xs text-stone-700 max-md:text-[length:var(--type-caption-size)] max-md:leading-[var(--type-caption-lh)]">{ruleText(item)}</p>
              {item.prepInstructions && <p className="text-xs text-stone-600 max-md:text-[length:var(--type-caption-size)] max-md:leading-[var(--type-caption-lh)]">{item.prepInstructions}</p>}
              {cap && <p className="text-xs text-stone-600 max-md:text-[length:var(--type-caption-size)] max-md:leading-[var(--type-caption-lh)]">{cap}</p>}
              {monthLeft && <p className={`text-xs max-md:text-[length:var(--type-caption-size)] max-md:leading-[var(--type-caption-lh)] ${item.monthRemainingQty === 0 ? 'text-warning-fg' : 'text-stone-600'}`}>{monthLeft}</p>}
              {item.status === 'ACTIVE' && (
                <div className="mt-1 flex flex-col gap-2">
                  <div>
                    <QuantitySelector
                      size="sm"
                      min={0}
                      max={(item.monthRemainingQty ?? UNCAPPED_QTY_MAX) + (allowance?.[item.id] ?? 0)}
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
