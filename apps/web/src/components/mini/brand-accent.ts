// Nguồn: apps/miniapp/src/utils/brands.ts (brandAccent); giá trị màu --color-brand-* ở mini.css
const BRAND_IDS: Record<string, string> = {
  visante: 'visante',
  polang: 'polang',
  'pơlang': 'polang',
  cobote: 'cobote',
  fuwa3e: 'fuwa3e',
  babycare: 'babycare',
  umikai: 'umikai',
  'bh.nong': 'bhnong',
  bhnong: 'bhnong',
  sokfram: 'sokfram',
  leplateau: 'leplateau',
  leplateaucoffee: 'leplateau',
  themoshav: 'moshav',
  moshav: 'moshav',
  hector: 'hector',
};

export function brandAccent(brand: string): string {
  const id = BRAND_IDS[brand.normalize('NFC').toLowerCase().replace(/\s+/g, '')];
  return id ? `var(--color-brand-${id})` : 'var(--color-action-primary-bg)';
}
