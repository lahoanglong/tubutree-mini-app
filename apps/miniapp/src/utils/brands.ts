/**
 * Brand accent colors theo Design Brief §4.2 — dùng cho chip/tag/brand carousel.
 * Key chuẩn hóa: lowercase, bỏ dấu cách. Brand lạ → fallback primary.
 */
const BRAND_ACCENTS: Record<string, string> = {
  visante: '#8B3A3A',
  polang: '#D4843E',
  'pơlang': '#D4843E',
  cobote: '#C9B280', // chỉnh từ #E8D9B5 để đạt contrast khi làm dot
  fuwa3e: '#E8B72C',
  babycare: '#7CC0DB', // chỉnh từ #A8D8E8 cùng lý do contrast
  umikai: '#6B8CAE',
  'bh.nong': '#7A5C3A',
  bhnong: '#7A5C3A',
  sokfram: '#DCA84A',
  'leplateau': '#4A2C20',
  'leplateaucoffee': '#4A2C20',
  themoshav: '#7A8B5C',
  moshav: '#7A8B5C',
  hector: '#6B6B6B',
};

export function brandAccent(brand: string): string {
  const key = brand.toLowerCase().replace(/\s+/g, '');
  return BRAND_ACCENTS[key] ?? 'var(--primary-600)';
}
