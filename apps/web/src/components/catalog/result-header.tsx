import { SlidersHorizontal, X } from 'lucide-react';
import { browseText } from '@/lib/browse-text';
import type { ActiveFilterChip, SearchState } from '@/lib/search-state';
import { ui } from '@/lib/guest-ui';
import { phoneSecondary } from '@/lib/phone-ui';
import { Chip } from './chip';

/**
 * Số kết quả + nút "Bộ lọc" + chip đang lọc gỡ được. Số kết quả là vùng `aria-live="polite"`: lúc đang tải chỉ có khoảng
 * trắng không-ngắt (giữ chiều cao một dòng, không phát gì), khi có số mới trình đọc màn hình đọc đúng một lần.
 */
export function ResultHeader({
  total,
  isLoading,
  chips,
  filterCount,
  filtersIgnored,
  onOpenFilters,
  onPatch,
}: {
  /** Thiếu số (lần tải đầu lỗi) thì không in "0 sản phẩm": khách sẽ hiểu nhầm cửa hàng hết hàng. */
  total?: number;
  isLoading: boolean;
  chips: ActiveFilterChip[];
  filterCount: number;
  filtersIgnored: boolean;
  onOpenFilters: () => void;
  onPatch: (patch: Partial<SearchState>) => void;
}) {
  return (
    <div className="flex flex-col gap-1 pb-2 pt-1">
      <div className="flex items-center justify-between gap-2">
        <p aria-live="polite" aria-atomic="true" data-testid="result-count" className="min-w-0 text-sm text-stone-600">
          {isLoading || total === undefined ? ' ' : browseText.resultCount(total)}
        </p>
        <button type="button" onClick={onOpenFilters} className={`${ui.btnSecondary} ${phoneSecondary} flex-none gap-2 lg:hidden`}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {filterCount > 0 ? browseText.filterButtonCount(filterCount) : browseText.filterButton}
        </button>
      </div>
      {chips.length > 0 && (
        <div role="group" aria-label={browseText.activeFilters} className="flex items-center gap-2 overflow-x-auto py-1.5">
          {chips.map((c) => (
            <Chip key={c.key} selected ariaLabel={browseText.removeFilter(c.label)} onPress={() => onPatch(c.patch)}>
              {c.label}
              <X className="h-4 w-4" aria-hidden="true" />
            </Chip>
          ))}
        </div>
      )}
      {filtersIgnored && (
        <p role="status" className="text-xs text-warning-fg">
          {browseText.filtersIgnored}
        </p>
      )}
    </div>
  );
}
