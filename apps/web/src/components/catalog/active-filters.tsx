'use client';

import { X } from 'lucide-react';
import { browseText } from '@/lib/browse-text';
import type { ActiveFilterChip, SearchState } from '@/lib/search-state';
import { Chip } from '@/components/mini/chip';
import { Icon } from '@/components/mini/icon';
import { Text } from '@/components/mini/text';

export interface ActiveFiltersProps {
  chips: ActiveFilterChip[];
  filtersIgnored: boolean;
  onPatch: (patch: Partial<SearchState>) => void;
}

/** Chip "đang lọc" gỡ được từng cái + câu báo khi API cũ bỏ qua bộ lọc. Không có gì để nói thì không vẽ gì (không để khoảng trống). */
export function ActiveFilters({ chips, filtersIgnored, onPatch }: ActiveFiltersProps) {
  if (chips.length === 0 && !filtersIgnored) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {chips.length > 0 && (
        <div role="group" aria-label={browseText.activeFilters} className="scroll-x -mx-4 px-4 md:mx-0 md:px-0" style={{ gap: 8, paddingTop: 6, paddingBottom: 6 }}>
          {chips.map((c) => (
            <Chip key={c.key} selected ariaLabel={browseText.removeFilter(c.label)} onPress={() => onPatch(c.patch)}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
              <Icon icon={X} size="sm" tone="inverse" style={{ flexShrink: 0 }} />
            </Chip>
          ))}
        </div>
      )}
      {filtersIgnored && (
        <p role="status" style={{ margin: 0 }}>
          <Text variant="caption" tone="warning">
            {browseText.filtersIgnored}
          </Text>
        </p>
      )}
    </div>
  );
}
