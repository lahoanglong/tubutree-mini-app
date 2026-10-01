import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Baby, Droplets, LayoutGrid, Recycle, SprayCan, type LucideIcon } from 'lucide-react';
import { fetchCategories, type CategoryDTO } from '../services/shop-api';
import { vi } from '../i18n/vi';

export interface CategoryEntry {
  kind: 'category' | 'segment';
  key: string;
  label: string;
  icon: LucideIcon;
}

/** 4 phân khúc (forSegment) — luôn có hàng trên prod vì sync Pancake suy ra từ tên SP. */
export const SEGMENT_ENTRIES: CategoryEntry[] = [
  { kind: 'segment', key: 'mom_baby', label: vi.browse.segments.mom_baby, icon: Baby },
  { kind: 'segment', key: 'home_clean', label: vi.browse.segments.home_clean, icon: SprayCan },
  { kind: 'segment', key: 'skincare', label: vi.browse.segments.skincare, icon: Droplets },
  { kind: 'segment', key: 'eco', label: vi.browse.segments.eco, icon: Recycle },
];

export function segmentLabel(key: string): string | undefined {
  return SEGMENT_ENTRIES.find((e) => e.key === key)?.label;
}

/**
 * Danh mục thật CÓ HÀNG; không còn danh mục nào dùng được thì lùi về 4 phân khúc (spec 5b.2
 * "fallback 4 phân khúc nếu rỗng").
 * - `productCount` là số → ẩn khi = 0.
 * - `productCount` thiếu (API cũ) → KHÔNG tự coi là rỗng để ẩn từng danh mục lẻ; nhưng nếu không
 *   danh mục nào có số liệu (toàn bộ là API cũ) thì không biết danh mục nào có hàng → dùng phân khúc.
 */
export function categoryEntries(categories: CategoryDTO[] | undefined): CategoryEntry[] {
  const all = categories ?? [];
  if (!all.some((c) => typeof c.productCount === 'number')) return SEGMENT_ENTRIES;
  const real = all.filter((c) => typeof c.productCount !== 'number' || c.productCount > 0);
  if (real.length === 0) return SEGMENT_ENTRIES;
  return real.map((c) => ({ kind: 'category', key: c.id, label: c.name, icon: LayoutGrid }));
}

export const CATEGORIES_KEY = ['categories'] as const;

export function useCategories(): { entries: CategoryEntry[]; categories: CategoryDTO[]; isLoading: boolean } {
  // Danh mục đổi chậm (cache API 60s) — cùng staleTime với /brands.
  const q = useQuery({ queryKey: CATEGORIES_KEY, queryFn: fetchCategories, staleTime: 60_000, retry: false });
  const entries = useMemo(() => categoryEntries(q.data), [q.data]);
  return { entries, categories: q.data ?? [], isLoading: q.isLoading };
}
