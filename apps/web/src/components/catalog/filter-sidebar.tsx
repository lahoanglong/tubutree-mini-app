'use client';

import type { ReactNode } from 'react';
import { browseText } from '@/lib/browse-text';
import type { CategoryEntry } from '@/lib/browse-categories';
import { MIN_RATING_OPTION, PRICE_RANGES, activeFilterCount, priceRangeLabel, type SearchState } from '@/lib/search-state';

const ROW =
  'flex min-h-11 w-full items-center gap-2 rounded-control px-2 text-left text-sm transition hover:bg-forest-50';

/**
 * Cột lọc bên trái của trang Danh mục/Tìm kiếm từ lg: danh mục dạng danh sách, khoảng giá, còn hàng, đánh giá, thương hiệu.
 * Dùng đúng bộ lọc sẵn có (cùng `update` với hộp thoại Bộ lọc của điện thoại, cùng tham số URL), nhưng áp dụng ngay khi chọn
 * thay vì chờ nút "Xem kết quả". Dưới lg khung ẩn (display:none) và khách dùng hộp thoại như cũ.
 */
export function FilterSidebar({
  state,
  entries,
  brands,
  onPickCategory,
  onClearCategory,
  onPatch,
}: {
  state: SearchState;
  entries: CategoryEntry[];
  brands: { brand: string; count: number }[];
  onPickCategory: (e: CategoryEntry) => void;
  onClearCategory: () => void;
  onPatch: (patch: Partial<SearchState>) => void;
}) {
  const hasCategory = Boolean(state.category || state.segment);
  const toggleBrand = (b: string) =>
    onPatch({ brands: state.brands.includes(b) ? state.brands.filter((x) => x !== b) : [...state.brands, b] });
  const filterCount = activeFilterCount(state);

  return (
    <aside
      aria-label={browseText.filter.title}
      data-testid="filter-sidebar"
      className="hidden lg:sticky lg:top-[calc(var(--header-h)+16px)] lg:block lg:max-h-[calc(100vh-var(--header-h)-32px)] lg:self-start lg:overflow-y-auto lg:pr-1"
    >
      <Group title={browseText.categories}>
        <button type="button" aria-pressed={!hasCategory} onClick={onClearCategory} className={`${ROW} ${!hasCategory ? 'bg-forest-50 font-semibold text-forest-800' : 'text-stone-800'}`}>
          {browseText.sidebar.all}
        </button>
        {entries.map((e) => {
          const active = e.kind === 'category' ? state.category === e.key : state.segment === e.key;
          return (
            <button
              key={`${e.kind}:${e.key}`}
              type="button"
              aria-pressed={active}
              onClick={() => onPickCategory(e)}
              className={`${ROW} ${active ? 'bg-forest-50 font-semibold text-forest-800' : 'text-stone-800'}`}
            >
              <e.icon className="h-4 w-4 flex-none text-forest-600" aria-hidden="true" />
              <span className="min-w-0 break-words">{e.label}</span>
            </button>
          );
        })}
      </Group>

      <Group title={browseText.filter.price}>
        {PRICE_RANGES.map((r) => {
          const selected = state.minPrice === r.min && state.maxPrice === r.max;
          return (
            <Check key={r.key} checked={selected} onChange={() => onPatch(selected ? { minPrice: undefined, maxPrice: undefined } : { minPrice: r.min, maxPrice: r.max })}>
              {priceRangeLabel(r.min, r.max)}
            </Check>
          );
        })}
      </Group>

      <Group title={browseText.filter.availability}>
        <Check checked={state.inStock} onChange={() => onPatch({ inStock: !state.inStock })}>
          {browseText.filter.inStock}
        </Check>
        <Check checked={state.minRating === MIN_RATING_OPTION} onChange={() => onPatch({ minRating: state.minRating === MIN_RATING_OPTION ? undefined : MIN_RATING_OPTION })}>
          {browseText.filter.rating4}
        </Check>
      </Group>

      {brands.length > 0 && (
        <Group title={browseText.filter.brand}>
          <div className="max-h-56 overflow-y-auto overscroll-contain">
            {brands.map((b) => (
              <Check key={b.brand} checked={state.brands.includes(b.brand)} onChange={() => toggleBrand(b.brand)}>
                {b.brand}
              </Check>
            ))}
          </div>
        </Group>
      )}

      {filterCount > 0 && (
        <button
          type="button"
          onClick={() => onPatch({ brands: [], minPrice: undefined, maxPrice: undefined, inStock: false, minRating: undefined })}
          className="mt-3 inline-flex min-h-11 items-center px-2 text-sm font-semibold text-forest-700 underline"
        >
          {browseText.filter.reset}
        </button>
      )}
    </aside>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="border-b border-stone-200 py-3 first:pt-0">
      <h2 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-stone-600">{title}</h2>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className={`${ROW} cursor-pointer text-stone-800`}>
      <input type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 flex-none accent-forest-600" />
      <span className="min-w-0 break-words">{children}</span>
    </label>
  );
}
