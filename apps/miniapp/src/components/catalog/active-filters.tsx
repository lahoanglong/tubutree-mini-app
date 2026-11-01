import { X } from 'lucide-react';
import { vi } from '../../i18n/vi';
import type { ActiveFilterChip, SearchState } from '../../utils/search-state';
import { Chip } from '../ui/chip';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';

export interface ActiveFiltersProps {
  chips: ActiveFilterChip[];
  filtersIgnored: boolean;
  onPatch: (patch: Partial<SearchState>) => void;
}

/** Chip "đang lọc" gỡ được từng cái + câu báo khi API cũ bỏ qua bộ lọc. Không có gì để nói thì không vẽ gì (không để khoảng trống). */
export function ActiveFilters({ chips, filtersIgnored, onPatch }: ActiveFiltersProps) {
  if (chips.length === 0 && !filtersIgnored) return null;
  return (
    <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {chips.length > 0 && (
        <div role="group" aria-label={vi.browse.activeFilters} className="scroll-x" style={{ gap: 8, padding: '6px 0' }}>
          {chips.map((c) => (
            <Chip key={c.key} selected ariaLabel={vi.browse.removeFilter(c.label)} onPress={() => onPatch(c.patch)}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
              <Icon icon={X} size="sm" tone="inverse" style={{ flexShrink: 0 }} />
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
