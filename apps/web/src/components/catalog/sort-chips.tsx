import type { CatalogSort } from '@tubutree/app-core/api/catalog';
import { browseText } from '@/lib/browse-text';
import { Chip } from './chip';

export const SORT_OPTIONS: { key: CatalogSort | undefined; label: string }[] = [
  { key: undefined, label: browseText.sort.suggested },
  { key: 'best_seller', label: browseText.sort.best_seller },
  { key: 'newest', label: browseText.sort.newest },
  { key: 'price_asc', label: browseText.sort.price_asc },
  { key: 'price_desc', label: browseText.sort.price_desc },
];

/** Hàng chip sắp xếp; đệm dọc để viền focus của chip không bị khung cuộn ngang cắt. */
export function SortChips({ value, onChange }: { value?: CatalogSort; onChange: (sort: CatalogSort | undefined) => void }) {
  return (
    <div role="group" aria-label={browseText.sortGroup} className="flex items-center gap-2 overflow-x-auto py-1.5 max-md:-mx-4 max-md:px-4">
      {SORT_OPTIONS.map((o) => (
        <Chip
          key={o.label}
          selected={value === o.key}
          onPress={() => {
            if (value !== o.key) onChange(o.key);
          }}
        >
          {o.label}
        </Chip>
      ))}
    </div>
  );
}
