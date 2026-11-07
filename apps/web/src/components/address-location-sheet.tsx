'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import type { GeoOption } from '@/lib/geo-client';
import { includesFolded } from '@/lib/vn-fold';
import { ui } from '@/lib/guest-ui';
import { BottomSheet } from '@/components/mini/bottom-sheet';
import { SearchField } from '@/components/mini/search-field';

/** Lọc không dấu, không phân biệt hoa/thường; ô tìm trống giữ nguyên toàn bộ danh sách. */
export function filterGeoOptions(options: readonly GeoOption[], query: string): GeoOption[] {
  return query.trim() ? options.filter((o) => includesFolded(o.name, query)) : [...options];
}

export interface AddressLocationSheetProps {
  open: boolean;
  onClose: () => void;
  /** Tên bước ("Tỉnh/Thành phố", "Phường/Xã"): tiêu đề sheet và nhãn danh sách. */
  title: string;
  options: readonly GeoOption[];
  /** Mã đang chọn; dòng đó có dấu tích và aria-selected. */
  value: string;
  status: 'loading' | 'error' | 'ready';
  onRetry?: () => void;
  onSelect: (option: GeoOption) => void;
  /** id của danh sách, để nút mở sheet trỏ tới bằng aria-controls. */
  listId?: string;
}

/**
 * Chọn địa giới trong sheet (điện thoại) / hộp thoại gọn (từ md): ô tìm không dấu lọc tức thì ("ho chi minh", "binh thanh"),
 * dòng cao ≥ 44px, dòng đang chọn có dấu tích. Chọn xong thì đóng và gọi `onSelect`; Enter khi chỉ còn một kết quả chọn luôn
 * dòng đó. Hoạt ảnh mở là của `BottomSheet` (220ms theo --ease-drawer, giảm chuyển động thì hiện ngay).
 * Danh sách phường của thành phố lớn dài hàng trăm mục nên `<select>` gốc không đủ dùng trên điện thoại.
 */
export function AddressLocationSheet({
  open,
  onClose,
  title,
  options,
  value,
  status,
  onRetry,
  onSelect,
  listId,
}: AddressLocationSheetProps) {
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const shown = filterGeoOptions(options, query);
  const pick = (o: GeoOption) => {
    onSelect(o);
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={title} size="full">
      {/* Sự kiện React nổi bọt qua portal: không chặn thì Enter ở ô tìm gửi luôn form địa chỉ bao ngoài. */}
      <div onSubmit={(e) => e.stopPropagation()}>
        <SearchField
          value={query}
          onChange={setQuery}
          onSubmit={() => {
            if (shown.length === 1) pick(shown[0]!);
          }}
          label={`Tìm ${title.toLowerCase()}`}
          clearLabel="Xoá từ khoá"
          placeholder="Tìm theo tên, không cần gõ dấu"
        />
        <div
          id={listId}
          role="listbox"
          aria-label={title}
          data-testid="address-location-list"
          className="mt-2"
        >
          {status === 'loading' && <p className="px-1 py-3 text-sm text-stone-600">Đang tải…</p>}
          {status === 'error' && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-1 px-1 py-2 text-caption text-danger-fg"
            >
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
              <span>Không tải được danh sách {title.toLowerCase()}.</span>
              {onRetry && (
                <button type="button" onClick={onRetry} className={ui.btnText}>
                  Thử lại
                </button>
              )}
            </div>
          )}
          {status === 'ready' && shown.length === 0 && (
            <p className="px-1 py-3 text-sm text-stone-600">Không tìm thấy kết quả phù hợp</p>
          )}
          {status === 'ready' &&
            shown.map((o) => {
              const selected = o.code === value;
              return (
                <button
                  key={o.code}
                  type="button"
                  role="option"
                  data-code={o.code}
                  aria-selected={selected}
                  onClick={() => pick(o)}
                  className={`flex min-h-11 w-full items-center justify-between gap-2 border-b border-stone-200 px-1 py-2.5 text-left text-base text-stone-900 active:bg-stone-100 motion-reduce:transition-none ${selected ? 'font-semibold' : ''}`}
                >
                  <span className="min-w-0 break-words">{o.name}</span>
                  {selected && <Check className="h-4 w-4 shrink-0 text-forest-600" aria-hidden />}
                </button>
              );
            })}
        </div>
      </div>
    </BottomSheet>
  );
}
