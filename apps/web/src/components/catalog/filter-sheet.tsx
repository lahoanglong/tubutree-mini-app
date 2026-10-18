'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CatalogPage } from '@tubutree/app-core/api/catalog';
import { catalogCountQuery } from '@tubutree/app-core/queries/catalog';
import { browseText } from '@/lib/browse-text';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import {
  MIN_RATING_OPTION, PRICE_RANGES, draftFromState, parseSearchState, priceRangeLabel, serializeSearchState, toCatalogQuery,
  type FilterDraft, type SearchState,
} from '@/lib/search-state';
import { useDebounced } from '@/lib/use-debounced';
import { Sheet } from '@/components/ui/sheet';
import { Chip } from './chip';

export const FILTER_COUNT_DEBOUNCE_MS = 250;

/** Nhãn nút áp dụng: không bao giờ vô hiệu nút. Chưa có số đếm đáng tin (đang hỏi, lỗi, API cũ bỏ qua bộ lọc) thì không ghi số. */
export function applyLabel(p: { settled: boolean; data?: CatalogPage; isError: boolean }): string {
  if (!p.settled) return browseText.filter.applyLoading;
  if (p.data && !p.data.filtersIgnored) return browseText.filter.apply(p.data.meta.total);
  if (p.isError || p.data?.filtersIgnored) return browseText.filter.applyFallback;
  return browseText.filter.applyLoading;
}

/**
 * Bộ lọc trong Sheet: khoảng giá, chỉ còn hàng, đánh giá từ 4 sao, thương hiệu; áp dụng bằng nút có số kết quả. Nháp khởi
 * tạo ngay trong lượt render mở sheet (không lộ một khung hình nháp cũ) và giữ nguyên khi đóng.
 * `onApply` được gọi đúng một lần cho mỗi nháp (bấm đúp không gửi hai lần).
 */
export function FilterSheet({
  open,
  onClose,
  state,
  brands,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  state: SearchState;
  brands: { brand: string; count: number }[];
  onApply: (draft: FilterDraft) => void;
}) {
  const [draft, setDraft] = useState<FilterDraft>(() => draftFromState(state));
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(draftFromState(state));
  }

  // Khoá đếm theo URL chuẩn của nháp: phản hồi trễ của nháp cũ rơi vào khoá cũ, không ghi đè số của nháp mới.
  const previewKey = serializeSearchState({ ...state, ...draft }).toString();
  const countKey = useDebounced(previewKey, FILTER_COUNT_DEBOUNCE_MS);
  const count = useQuery({
    ...catalogCountQuery(coreHttp, countKey, toCatalogQuery(parseSearchState(new URLSearchParams(countKey)), 1, 1)),
    enabled: open,
    staleTime: 30_000,
    retry: false,
  });
  const label = applyLabel({ settled: countKey === previewKey, data: count.data, isError: count.isError });

  const toggleBrand = (b: string) =>
    setDraft((d) => ({ ...d, brands: d.brands.includes(b) ? d.brands.filter((x) => x !== b) : [...d.brands, b] }));

  const appliedDraft = useRef<FilterDraft | null>(null);
  const apply = () => {
    if (appliedDraft.current === draft) return;
    appliedDraft.current = draft;
    onApply(draft);
  };

  const hasPrice = draft.minPrice != null || draft.maxPrice != null;
  const presetSelected = PRICE_RANGES.some((r) => draft.minPrice === r.min && draft.maxPrice === r.max);
  const clearPrice = () => setDraft((d) => ({ ...d, minPrice: undefined, maxPrice: undefined }));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={browseText.filter.title}
      footer={
        <div className="flex gap-2">
          <button type="button" onClick={() => setDraft({ brands: [], inStock: false })} className={ui.btnText}>
            {browseText.filter.reset}
          </button>
          <button type="button" onClick={apply} className={`${ui.btnPrimary} min-w-0 flex-1`}>
            {label}
          </button>
        </div>
      }
    >
      <FilterGroup title={browseText.filter.price}>
        {PRICE_RANGES.map((r) => {
          const selected = draft.minPrice === r.min && draft.maxPrice === r.max;
          return (
            <Chip key={r.key} selected={selected} onPress={() => (selected ? clearPrice() : setDraft((d) => ({ ...d, minPrice: r.min, maxPrice: r.max })))}>
              {priceRangeLabel(r.min, r.max)}
            </Chip>
          );
        })}
        {/* Khoảng giá tuỳ ý (từ liên kết) không trùng khoảng định sẵn: vẫn hiện để thấy và bỏ được. */}
        {hasPrice && !presetSelected && (
          <Chip selected onPress={clearPrice}>
            {priceRangeLabel(draft.minPrice, draft.maxPrice)}
          </Chip>
        )}
      </FilterGroup>
      <FilterGroup title={browseText.filter.availability}>
        <Chip selected={draft.inStock} onPress={() => setDraft((d) => ({ ...d, inStock: !d.inStock }))}>
          {browseText.filter.inStock}
        </Chip>
      </FilterGroup>
      <FilterGroup title={browseText.filter.rating}>
        <Chip
          selected={draft.minRating === MIN_RATING_OPTION}
          onPress={() => setDraft((d) => ({ ...d, minRating: d.minRating === MIN_RATING_OPTION ? undefined : MIN_RATING_OPTION }))}
        >
          {browseText.filter.rating4}
        </Chip>
      </FilterGroup>
      {brands.length > 0 && (
        <FilterGroup title={browseText.filter.brand} scroll>
          {brands.map((b) => (
            <Chip key={b.brand} selected={draft.brands.includes(b.brand)} onPress={() => toggleBrand(b.brand)}>
              {b.brand}
            </Chip>
          ))}
        </FilterGroup>
      )}
    </Sheet>
  );
}

/** Nhóm chip; danh sách thương hiệu có thể rất dài nên nằm trong khung cuộn riêng để nút áp dụng ở chân sheet luôn thấy. */
function FilterGroup({ title, children, scroll }: { title: string; children: ReactNode; scroll?: boolean }) {
  return (
    <div role="group" aria-label={title} className="pt-3">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-600">{title}</div>
      <div data-testid={scroll ? 'filter-brand-scroll' : undefined} className={`flex flex-wrap gap-2 py-1 ${scroll ? 'max-h-[30vh] overflow-y-auto overscroll-contain' : ''}`}>
        {children}
      </div>
    </div>
  );
}
