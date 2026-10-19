'use client';

import { Clock, MapPin, Navigation, Phone } from 'lucide-react';
import type { WastePointDTO } from '@tubutree/shared-types';
import { platformBridge } from '@/lib/platform-bridge';
import { formatPhoneDisplay } from '@/lib/phone-display';
import { ui } from '@/lib/guest-ui';
import { Badge } from '@/components/ui/badge';
import { isOpenNow, mapsUrl, pointAddress } from './recycle-labels';

export interface WastePointPickerProps {
  points: readonly WastePointDTO[];
  value: string | null;
  onChange: (pointId: string) => void;
  /** Các món đang bật, liệt kê trên từng thẻ. */
  items: readonly { id: string; name: string }[];
  selectedItemIds: readonly string[];
  now?: Date;
}

/** Thẻ khoá chỉ mờ phần chọn và tên; lý do, chỉ đường và gọi vẫn dùng được nên giữ nguyên độ đậm. */
const DIMMED = 'opacity-[.55]';

function missingItemIds(p: WastePointDTO, selectedItemIds: readonly string[]): string[] {
  return selectedItemIds.filter((id) => !p.acceptedItemIds.includes(id));
}

/** Điểm nhận đủ món đã chọn xếp trước, rồi giữ thứ tự đầu vào (web không có khoảng cách vì không dùng vị trí). */
export function sortWastePoints(points: readonly WastePointDTO[], selectedItemIds: readonly string[]): WastePointDTO[] {
  return points
    .map((p, index) => ({ p, index, partial: missingItemIds(p, selectedItemIds).length > 0 }))
    .sort((a, b) => (a.partial !== b.partial ? (a.partial ? 1 : -1) : a.index - b.index))
    .map((x) => x.p);
}

/**
 * Khách chọn điểm nhận. Mỗi điểm là một ô chọn (role=radio) toàn chữ; dòng khoá, ưu đãi riêng và nút gọi, chỉ đường
 * nằm NGOÀI ô chọn vì trình đọc màn hình gộp phần tử con vào radio và bỏ rơi nút.
 */
export function WastePointPicker({ points, value, onChange, items, selectedItemIds, now }: WastePointPickerProps) {
  const sorted = sortWastePoints(points, selectedItemIds);
  const clock = now ?? new Date();
  const isLocked = (p: WastePointDTO) => p.quotaFull || missingItemIds(p, selectedItemIds).length > 0;

  return (
    <div role="radiogroup" aria-label="Chọn điểm nhận" className="grid gap-2 md:grid-cols-2">
      {sorted.map((p) => {
        const selected = p.id === value;
        const locked = isLocked(p);
        const missing = missingItemIds(p, selectedItemIds);
        const missingNames = items.filter((it) => missing.includes(it.id)).map((it) => it.name);
        return (
          <div
            key={p.id}
            className={`overflow-hidden rounded-control border-[1.5px] ${selected ? 'border-forest-600 bg-forest-50' : 'border-stone-200 bg-stone-0'}`}
          >
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={locked}
              onClick={() => {
                if (locked || selected) return;
                onChange(p.id);
              }}
              className={`flex min-h-11 w-full items-start gap-2.5 p-3 text-left ${locked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span
                aria-hidden="true"
                className={`mt-px grid h-5 w-5 flex-none place-items-center rounded-full border-2 ${selected ? 'border-forest-600' : 'border-stone-450'} ${locked ? DIMMED : ''}`}
              >
                {selected && <span className="h-2.5 w-2.5 rounded-full bg-forest-600" />}
              </span>
              <span data-point-body className={`flex min-w-0 flex-1 flex-col gap-1.5 ${locked ? DIMMED : ''}`}>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold text-stone-900">{p.name}</span>
                  <Badge tone={p.kind === 'WAREHOUSE' ? 'info' : 'brand'} size="sm">
                    {p.kind === 'WAREHOUSE' ? 'Kho Tubu' : 'Đại lý'}
                  </Badge>
                </span>
                <span className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 flex-none text-forest-600" aria-hidden="true" />
                  <span className="min-w-0 text-sm text-stone-800">{pointAddress(p)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Clock className="h-4 w-4 flex-none text-forest-600" aria-hidden="true" />
                  <span className="text-sm text-stone-800">{isOpenNow(p.openingHours, clock) ? 'Đang mở' : 'Đang đóng'}</span>
                </span>
                <span className="flex flex-wrap gap-x-2 gap-y-1">
                  {items.map((it) =>
                    p.acceptedItemIds.includes(it.id) ? (
                      <Badge key={it.id} tone="neutral" size="sm">
                        {it.name}
                      </Badge>
                    ) : (
                      <span key={it.id} className="inline-flex items-center gap-1">
                        <s className="text-sm text-stone-800">{it.name}</s>
                        <Badge tone="neutral" size="sm">
                          Không nhận
                        </Badge>
                      </span>
                    ),
                  )}
                </span>
              </span>
            </button>
            <div className="flex flex-col gap-2 px-3 pb-3 pl-[42px]">
              {locked && (
                <div>
                  <span className="inline-block rounded-control bg-warning-bg px-2 py-[3px] text-xs font-semibold text-warning-fg">
                    {p.quotaFull ? 'Tạm hết hạn mức tháng này' : `Điểm này không nhận: ${missingNames.join(', ')}`}
                  </span>
                </div>
              )}
              {p.perkText && (
                <p className="text-sm text-stone-800">
                  {`Ưu đãi riêng của cửa hàng (cửa hàng tự chịu, không qua Điểm Xanh, Tubu không đảm bảo): ${p.perkText}`}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={ui.btnSecondary} onClick={() => platformBridge.openExternal(mapsUrl(p))}>
                  <Navigation className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Chỉ đường
                </button>
                {p.phone && (
                  <button type="button" className={ui.btnSecondary} onClick={() => platformBridge.callPhone(p.phone as string)}>
                    <Phone className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {`Gọi ${formatPhoneDisplay(p.phone)}`}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
