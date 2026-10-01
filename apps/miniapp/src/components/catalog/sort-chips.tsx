import type { CatalogSort } from '../../services/shop-api';
import { vi } from '../../i18n/vi';
import { haptic } from '../../utils/haptic';
import { Chip } from '../ui/chip';

export const SORT_OPTIONS: { key: CatalogSort | undefined; label: string }[] = [
  { key: undefined, label: vi.browse.sort.suggested },
  { key: 'best_seller', label: vi.browse.sort.best_seller },
  { key: 'newest', label: vi.browse.sort.newest },
  { key: 'price_asc', label: vi.browse.sort.price_asc },
  { key: 'price_desc', label: vi.browse.sort.price_desc },
];

export interface SortChipsProps {
  value?: CatalogSort;
  onChange: (sort: CatalogSort | undefined) => void;
}

/** Hàng chip sắp xếp; đệm dọc 6px để vùng chạm 44px của Chip không bị `.scroll-x` cắt. */
export function SortChips({ value, onChange }: SortChipsProps) {
  return (
    <div role="group" aria-label={vi.browse.sortGroup} className="scroll-x" style={{ gap: 8, padding: '6px 16px' }}>
      {SORT_OPTIONS.map((o) => (
        <Chip
          key={o.label}
          selected={value === o.key}
          onPress={() => {
            if (value === o.key) return;
            haptic('light');
            onChange(o.key);
          }}
        >
          {o.label}
        </Chip>
      ))}
    </div>
  );
}
