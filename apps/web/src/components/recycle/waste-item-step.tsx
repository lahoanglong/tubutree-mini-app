'use client';

import { dropOffDayLimitText, itemQtyMax } from '@tubutree/app-core/waste-copy';
import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import type { WasteMeItemDTO } from '@tubutree/shared-types';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { QuantitySelector } from '@/components/ui/quantity-selector';
import { ui } from '@/lib/guest-ui';
import { QUICK_QTY_STEPS, wasteRulesSheetCopy } from '@tubutree/app-core/waste-copy';
import { WasteItemThumb } from './waste-item-thumb';
import { WasteRulesSheet } from './waste-steps';
import { UNCAPPED_QTY_MAX, groupProgressText, itemRuleNotes, monthRemainingText, ruleText } from './recycle-labels';

/** Trang Thể lệ đầy đủ (lối ở cuối sheet ⓘ Thể lệ), như trang đích /doi-rac. */
const RULES_HREF = '/doi-rac/quy-dinh';

interface WasteItemStepProps {
  items: readonly WasteMeItemDTO[];
  lines: Readonly<Record<string, number>>;
  onChange: (itemId: string, qty: number) => void;
  /** Số lượng đã khai ở yêu cầu đang sửa, cộng lại vào trần còn lại. */
  allowance?: Readonly<Record<string, number>>;
  /** Sai khi sửa một yêu cầu không tạo hôm nay: máy chủ tính trần ngày theo ngày của yêu cầu nên khách không áp trần ngày. */
  dayCap?: boolean;
}

/**
 * Bước chọn món (như Mini `WasteItemStep`): mỗi thẻ chỉ còn hình, tên, tỉ lệ đổi và bộ đếm; điều kiện nhận (chuẩn bị, chỉ kho nhận, trần tháng/ngày)
 * nằm trong một sheet "ⓘ Thể lệ" ở đầu danh sách. Dòng trạng thái (còn bao nhiêu trong tháng, trần hôm nay) vẫn ở thẻ vì nó giải thích bộ đếm bị chặn.
 * Món sắp nhận mờ đi và không có bộ đếm.
 */
export function WasteItemStep({ items, lines, onChange, allowance, dayCap = true }: WasteItemStepProps) {
  const sorted = useMemo(() => items.filter((i) => i.status !== 'HIDDEN').sort((a, b) => a.sortOrder - b.sortOrder), [items]);
  const notes = useMemo(() => itemRuleNotes(sorted), [sorted]);
  const [rulesOpen, setRulesOpen] = useState(false);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {notes.length > 0 && (
        <div className="-mb-1 -mt-2 flex justify-end md:col-span-2">
          <button type="button" onClick={() => setRulesOpen(true)} className={`${ui.btnText} flex-none gap-1.5 text-forest-700 no-underline`}>
            <Info className="h-4 w-4" aria-hidden="true" />
            {wasteRulesSheetCopy.button}
          </button>
        </div>
      )}
      <WasteRulesSheet open={rulesOpen} onClose={() => setRulesOpen(false)} items={notes} rulesHref={RULES_HREF} />
      {sorted.map((item) => {
        const qty = lines[item.id] ?? 0;
        const dayLine = dropOffDayLimitText(item, allowance?.[item.id] ?? 0, dayCap);
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
              {monthLeft && <p className={`text-xs max-md:text-[length:var(--type-caption-size)] max-md:leading-[var(--type-caption-lh)] ${item.monthRemainingQty === 0 ? 'text-warning-fg' : 'text-stone-600'}`}>{monthLeft}</p>}
              {dayLine && item.status === 'ACTIVE' && <p className="text-xs text-warning-fg max-md:text-[length:var(--type-caption-size)] max-md:leading-[var(--type-caption-lh)]">{dayLine}</p>}
              {item.status === 'ACTIVE' && (
                <div className="mt-1 flex flex-col gap-2">
                  <div>
                    <QuantitySelector
                      size="sm"
                      itemLabel={item.name}
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
