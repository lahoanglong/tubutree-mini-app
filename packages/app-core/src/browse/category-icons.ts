/**
 * Icon của danh mục chuẩn theo slug, một nguồn cho Mini App và web: mỗi app chỉ ánh xạ khoá sang icon của nền tảng mình
 * (`ICON_BY_KEY: Record<CategoryIconKey, LucideIcon>`, thiếu khoá là lỗi tsc). Slug lạ không có khoá: app tự lùi về icon lưới.
 */
export type CategoryIconKey = 'flower' | 'sparkles' | 'baby' | 'heart-handshake' | 'smile' | 'coffee' | 'wheat';

export const CATEGORY_ICON_KEYS: Readonly<Record<string, CategoryIconKey>> = {
  'my-pham-thien-nhien': 'flower',
  'tay-rua-sinh-hoc': 'sparkles',
  'cho-be': 'baby',
  'cho-me-bau': 'heart-handshake',
  'cham-soc-ca-nhan': 'smile',
  'ca-phe-do-uong': 'coffee',
  'nong-san-thuc-pham': 'wheat',
};

export function categoryIconKey(slug: string | null | undefined): CategoryIconKey | null {
  if (!slug || !Object.prototype.hasOwnProperty.call(CATEGORY_ICON_KEYS, slug)) return null;
  return CATEGORY_ICON_KEYS[slug] ?? null;
}
