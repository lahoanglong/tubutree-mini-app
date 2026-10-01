import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCatalog, type CatalogPage } from '../../services/shop-api';
import { vi } from '../../i18n/vi';
import { useDebounced } from '../../utils/use-debounced';
import {
  MIN_RATING_OPTION, PRICE_RANGES, draftFromState, parseSearchState, priceRangeLabel, serializeSearchState, toCatalogQuery,
  type FilterDraft, type SearchState,
} from '../../utils/search-state';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { Text } from '../ui/text';

export const FILTER_COUNT_DEBOUNCE_MS = 250;

/** Nhãn nút áp dụng (plan 4b Ruling 18) — không bao giờ disable nút. */
export function applyLabel(p: { settled: boolean; data?: CatalogPage; isError: boolean }): string {
  if (!p.settled) return vi.browse.filter.applyLoading;
  if (p.data && !p.data.filtersIgnored) return vi.browse.filter.apply(p.data.meta.total);
  if (p.isError || p.data?.filtersIgnored) return vi.browse.filter.applyFallback;
  return vi.browse.filter.applyLoading;
}

export interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  state: SearchState;
  brands: { brand: string; count: number }[];
  onApply: (draft: FilterDraft) => void;
}

/**
 * Bộ lọc trong BottomSheet (spec 5b.2): khoảng giá, chỉ còn hàng, đánh giá ≥4, thương hiệu; áp dụng
 * bằng nút có số kết quả. Nháp khởi tạo NGAY trong lượt render mở sheet (bài học ReorderSheet 4a:
 * không lộ 1 khung hình nháp cũ) và GIỮ NGUYÊN khi đóng (nội dung không trống lúc trượt xuống).
 *
 * Sự kiện `filter_applied` do trang Browse bắn trong `onApply` (nó có `state` trước khi đổi);
 * sheet chỉ bảo đảm `onApply` được gọi đúng MỘT lần cho mỗi nháp (chạm đúp không gửi hai lần).
 */
export function FilterSheet({ open, onClose, state, brands, onApply }: FilterSheetProps) {
  const [draft, setDraft] = useState<FilterDraft>(() => draftFromState(state));
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(draftFromState(state));
  }

  // Khoá đếm theo URL chuẩn của nháp: mỗi nháp một khoá → phản hồi trễ của nháp cũ rơi vào khoá cũ,
  // không bao giờ ghi đè số của nháp mới.
  const previewKey = serializeSearchState({ ...state, ...draft }).toString();
  const countKey = useDebounced(previewKey, FILTER_COUNT_DEBOUNCE_MS);
  const count = useQuery({
    queryKey: ['products', 'count', countKey],
    // queryFn suy ra từ CHÍNH khoá → số đếm luôn khớp đúng bộ lọc của khoá đó.
    queryFn: () => fetchCatalog(toCatalogQuery(parseSearchState(new URLSearchParams(countKey)), 1, 1)),
    enabled: open,
    staleTime: 30_000,
    retry: false,
  });
  const label = applyLabel({ settled: countKey === previewKey, data: count.data, isError: count.isError });

  const toggleBrand = (b: string) =>
    setDraft((d) => ({ ...d, brands: d.brands.includes(b) ? d.brands.filter((x) => x !== b) : [...d.brands, b] }));

  // Chống chạm đúp ĐỒNG BỘ: cùng một nháp (cùng tham chiếu) chỉ áp dụng một lần; sửa nháp → tham chiếu mới.
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
    <BottomSheet
      open={open}
      onClose={onClose}
      title={vi.browse.filter.title}
      size="auto"
      footer={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onPress={() => setDraft({ brands: [], inStock: false })} style={{ minWidth: 0 }}>
            {vi.browse.filter.reset}
          </Button>
          <Button onPress={apply} style={{ minWidth: 0, flex: 1 }}>
            {label}
          </Button>
        </div>
      }
    >
      <FilterGroup title={vi.browse.filter.price}>
        {PRICE_RANGES.map((r) => {
          const selected = draft.minPrice === r.min && draft.maxPrice === r.max;
          return (
            <Chip
              key={r.key}
              selected={selected}
              onPress={() => (selected ? clearPrice() : setDraft((d) => ({ ...d, minPrice: r.min, maxPrice: r.max })))}
            >
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
      <FilterGroup title={vi.browse.filter.availability}>
        <Chip selected={draft.inStock} onPress={() => setDraft((d) => ({ ...d, inStock: !d.inStock }))}>
          {vi.browse.filter.inStock}
        </Chip>
      </FilterGroup>
      <FilterGroup title={vi.browse.filter.rating}>
        <Chip
          selected={draft.minRating === MIN_RATING_OPTION}
          onPress={() => setDraft((d) => ({ ...d, minRating: d.minRating === MIN_RATING_OPTION ? undefined : MIN_RATING_OPTION }))}
        >
          {vi.browse.filter.rating4}
        </Chip>
      </FilterGroup>
      {brands.length > 0 && (
        <FilterGroup title={vi.browse.filter.brand} scrollMaxHeight="30vh">
          {brands.map((b) => (
            <Chip key={b.brand} selected={draft.brands.includes(b.brand)} onPress={() => toggleBrand(b.brand)}>
              {b.brand}
            </Chip>
          ))}
        </FilterGroup>
      )}
    </BottomSheet>
  );
}

/**
 * Nhóm chip; đệm dọc 4px để vùng chạm 44px của Chip không bị khung cuộn cắt. Với `scrollMaxHeight`
 * (danh sách thương hiệu có thể rất dài) chip nằm trong khung cuộn riêng để nút áp dụng ở chân sheet
 * luôn nằm trong màn hình.
 */
function FilterGroup({ title, children, scrollMaxHeight }: { title: string; children: ReactNode; scrollMaxHeight?: string }) {
  return (
    <div role="group" aria-label={title} style={{ paddingTop: 12 }}>
      <Text variant="label" tone="secondary" as="div" style={{ marginBottom: 4 }}>
        {title}
      </Text>
      <div
        data-testid={scrollMaxHeight ? 'filter-brand-scroll' : undefined}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          padding: '4px 0',
          ...(scrollMaxHeight ? { maxHeight: scrollMaxHeight, overflowY: 'auto', overscrollBehavior: 'contain' } : null),
        }}
      >
        {children}
      </div>
    </div>
  );
}
