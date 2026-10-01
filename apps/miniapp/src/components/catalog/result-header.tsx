import { SlidersHorizontal, X } from 'lucide-react';
import { vi } from '../../i18n/vi';
import type { ActiveFilterChip, SearchState } from '../../utils/search-state';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';

export interface ResultHeaderProps {
  total: number;
  isLoading: boolean;
  chips: ActiveFilterChip[];
  filterCount: number;
  filtersIgnored: boolean;
  onOpenFilters: () => void;
  onPatch: (patch: Partial<SearchState>) => void;
}

/** Số kết quả + nút "Bộ lọc" + chip đang lọc gỡ được (spec 5b.2 "Hiển thị số kết quả").
 * Số kết quả là vùng `aria-live="polite"`: lúc đang tải chỉ có khoảng trắng không-ngắt (giữ chiều cao
 * 1 dòng, không phát gì), khi có số mới trình đọc màn hình đọc đúng 1 lần. */
export function ResultHeader({ total, isLoading, chips, filterCount, filtersIgnored, onOpenFilters, onPatch }: ResultHeaderProps) {
  return (
    <div style={{ padding: '4px 16px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <p aria-live="polite" aria-atomic="true" data-testid="result-count" style={{ margin: 0, minWidth: 0 }}>
          <Text variant="body-sm" tone="secondary">
            {isLoading ? ' ' : vi.browse.resultCount(total)}
          </Text>
        </p>
        <Button variant="secondary" icon={SlidersHorizontal} onPress={onOpenFilters} style={{ minWidth: 0, flex: '0 0 auto' }}>
          {filterCount > 0 ? vi.browse.filterButtonCount(filterCount) : vi.browse.filterButton}
        </Button>
      </div>
      {chips.length > 0 && (
        <div role="group" aria-label={vi.browse.activeFilters} className="scroll-x" style={{ gap: 8, padding: '6px 0' }}>
          {chips.map((c) => (
            <Chip key={c.key} selected ariaLabel={vi.browse.removeFilter(c.label)} onPress={() => onPatch(c.patch)}>
              {c.label}
              <Icon icon={X} size="sm" tone="inverse" />
            </Chip>
          ))}
        </div>
      )}
      {filtersIgnored && (
        <Text variant="caption" tone="warning" as="p">
          {vi.browse.filtersIgnored}
        </Text>
      )}
    </div>
  );
}
