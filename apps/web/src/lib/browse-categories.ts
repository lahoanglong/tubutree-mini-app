import { Baby, Coffee, Droplets, Flower2, HeartHandshake, LayoutGrid, Recycle, Smile, Sparkles, SprayCan, Wheat, type LucideIcon } from 'lucide-react';
import type { CategoryDTO } from '@tubutree/app-core/api/catalog';
import { browseText } from './browse-text';

export interface CategoryEntry {
  kind: 'category' | 'segment';
  key: string;
  label: string;
  icon: LucideIcon;
  /** Ảnh danh mục do quản trị đặt; có thì ô lưới vẽ ảnh thay icon. */
  image?: string | null;
}

/** Icon theo slug danh mục chuẩn; slug lạ lùi về LayoutGrid. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'my-pham-thien-nhien': Flower2,
  'tay-rua-sinh-hoc': Sparkles,
  'cho-be': Baby,
  'cho-me-bau': HeartHandshake,
  'cham-soc-ca-nhan': Smile,
  'ca-phe-do-uong': Coffee,
  'nong-san-thuc-pham': Wheat,
};

/** 4 phân khúc (forSegment) — luôn có hàng trên prod vì sync Pancake suy ra từ tên sản phẩm. */
export const SEGMENT_ENTRIES: CategoryEntry[] = [
  { kind: 'segment', key: 'mom_baby', label: browseText.segments.mom_baby, icon: Baby, image: null },
  { kind: 'segment', key: 'home_clean', label: browseText.segments.home_clean, icon: SprayCan, image: null },
  { kind: 'segment', key: 'skincare', label: browseText.segments.skincare, icon: Droplets, image: null },
  { kind: 'segment', key: 'eco', label: browseText.segments.eco, icon: Recycle, image: null },
];

export function segmentLabel(key: string): string | undefined {
  return SEGMENT_ENTRIES.find((e) => e.key === key)?.label;
}

/**
 * Danh mục thật CÓ HÀNG; không còn danh mục nào dùng được thì lùi về 4 phân khúc (như use-categories của Mini App).
 * - `productCount` là số → ẩn khi = 0.
 * - `productCount` thiếu (API cũ) → không tự coi là rỗng để ẩn từng danh mục lẻ; nhưng nếu không danh mục nào có số liệu
 *   thì không biết danh mục nào có hàng → dùng phân khúc.
 */
export function categoryEntries(categories: CategoryDTO[] | undefined): CategoryEntry[] {
  const all = categories ?? [];
  if (!all.some((c) => typeof c.productCount === 'number')) return SEGMENT_ENTRIES;
  const real = all.filter((c) => typeof c.productCount !== 'number' || c.productCount > 0);
  if (real.length === 0) return SEGMENT_ENTRIES;
  return real.map((c) => ({ kind: 'category', key: c.id, label: c.name, icon: CATEGORY_ICONS[c.slug] ?? LayoutGrid, image: c.image }));
}
