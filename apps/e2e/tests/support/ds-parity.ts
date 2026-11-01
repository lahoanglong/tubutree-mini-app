import type { Page } from '@playwright/test';
import { TILE_METRICS } from '../../../../packages/app-core/src/commerce/tile-metrics';

/**
 * So số đo computed style 375px của Mini App và web (P17b, review/design-system.md C2 T9). Mỗi project đo trang của mình trên cùng dữ liệu mock rồi
 * so với bảng chuẩn `EXPECTED` dưới đây, nên hai bên bằng nhau nhờ cùng bằng bảng: `playwright.config.ts` tách server theo scope (Mini chỉ Vite, web cần
 * API thật) và CI chạy hai project song song, nên không thể bắt hai project so trực tiếp với nhau trong một lượt.
 * Bảng chuẩn lấy từ Mini 375px (bản gốc, DESIGN.md B0.4), kích thước thân thẻ từ `TILE_METRICS`; web lệch bảng là web hồi quy, không nới bảng để che.
 */
export type Side = 'miniapp' | 'web';
/** Phần tử đo: `root` là bộ chọn CSS (phần tử đầu tiên khớp), `target` là bộ chọn trong `root` ('' = chính `root`). */
export interface Probe {
  id: string;
  root: string;
  target: string;
  props: readonly string[];
}
export type Measure = Record<string, Record<string, string> | null>;

const TEXT = ['fontSize', 'lineHeight', 'fontWeight', 'letterSpacing', 'color', 'fontFamilyKind'] as const;
const FRAME = ['width', 'borderRadius', 'backgroundColor', 'boxShadow'] as const;
const PAD = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;
const COMPARE = ['fontSize', 'lineHeight', 'fontWeight', 'color', 'textDecorationLine'] as const;

const tile = (variant: 'flash' | 'line' | 'grid'): string => `[data-ds="product-tile"][data-ds-variant="${variant}"]`;
const PRICE_NUMBER = '[data-ds-part="price"] > span > span:nth-child(2)';
const PRICE_COMPARE = '[data-ds-part="price"] > span > span:nth-child(4)';
const NAME = '[data-ds-part="body"] [aria-describedby] > span';

function tileProbes(variant: 'flash' | 'line' | 'grid', extra: Probe[] = []): Probe[] {
  const root = tile(variant);
  return [
    { id: `tile-${variant}`, root, target: '', props: FRAME },
    variant === 'line'
      ? { id: 'tile-line-media', root, target: '[data-ds-part="media"]', props: ['width', 'height', 'borderRadius'] }
      : { id: `tile-${variant}-body`, root, target: '[data-ds-part="body"]', props: PAD },
    { id: `tile-${variant}-name`, root, target: NAME, props: TEXT },
    { id: `tile-${variant}-price`, root, target: PRICE_NUMBER, props: TEXT },
    { id: `tile-${variant}-compare`, root, target: PRICE_COMPARE, props: COMPARE },
    ...extra,
  ];
}

export const PROBES: readonly Probe[] = [
  // Tiêu đề khối: SectionHeader đầu tiên của trang Ưu đãi là khối Giờ vàng (Q1: Inter 16/700 -0,01em, chữ promo).
  { id: 'section-title', root: '[data-testid="section-header"]', target: 'h2', props: TEXT },
  { id: 'section-header', root: '[data-testid="section-header"]', target: '', props: ['height', 'display', 'justifyContent'] },
  ...tileProbes('flash'),
  ...tileProbes('line'),
  ...tileProbes('grid', [
    { id: 'tile-grid-brand', root: tile('grid'), target: '[data-ds-part="brand"]', props: TEXT },
    { id: 'tile-grid-meta', root: tile('grid'), target: '[data-ds-part="meta"]', props: TEXT },
  ]),
];

/** Dung sai 0,5px cho số đo px (làm tròn khác nhau của hai bộ dựng hình); mọi giá trị khác so đúng chuỗi. */
const PX = /^-?\d+(?:\.\d+)?px$/;
const same = (a: string, b: string): boolean => a === b || (PX.test(a) && PX.test(b) && Math.abs(parseFloat(a) - parseFloat(b)) <= 0.5);

/** Mỗi dòng nói rõ phần tử, thuộc tính, giá trị chuẩn và giá trị đo, để người sửa biết chỗ nào lệch mà không phải mở file số đo. */
export function diffMeasure(expected: Measure, actual: Measure): string[] {
  const out: string[] = [];
  for (const [id, props] of Object.entries(expected)) {
    const got = actual[id];
    if (!props) {
      out.push(`${id}: chưa có số đo chuẩn trong EXPECTED`);
      continue;
    }
    if (!got) {
      out.push(`${id}: không thấy phần tử`);
      continue;
    }
    for (const [prop, want] of Object.entries(props)) {
      if (!same(want, got[prop] ?? '(thiếu)')) out.push(`${id}.${prop}: chuẩn "${want}", đo "${got[prop] ?? '(thiếu)'}"`);
    }
  }
  return out;
}

/** Đo trong trang: phần tử không có thì ghi null (diffMeasure báo "không thấy phần tử"). `fontFamilyKind` thay cho tên họ chữ vì Next đặt tên font băm khác Mini. */
export function measure(page: Page, probes: readonly Probe[]): Promise<Measure> {
  return page.evaluate((list) => {
    const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    const kind = (family: string) => (/fraunces/i.test(family) ? 'fraunces' : /inter/i.test(family) ? 'inter' : `khác: ${family.split(',')[0]}`);
    const out: Record<string, Record<string, string> | null> = {};
    for (const p of list) {
      const root = document.querySelector(p.root);
      const el = root ? (p.target ? root.querySelector(p.target) : root) : null;
      if (!el) {
        out[p.id] = null;
        continue;
      }
      const cs = getComputedStyle(el);
      out[p.id] = Object.fromEntries(p.props.map((k) => [k, k === 'fontFamilyKind' ? kind(cs.fontFamily) : cs.getPropertyValue(kebab(k))]));
    }
    return out;
  }, probes);
}

export const probesFor = (ids: readonly string[]): Probe[] => PROBES.filter((p) => ids.includes(p.id));
export const expectedFor = (ids: readonly string[]): Measure => Object.fromEntries(ids.map((id) => [id, EXPECTED[id] ?? null]));

const M = TILE_METRICS;
const px = (n: number): string => `${n}px`;
const INK = 'rgb(28, 26, 22)';
const MUTED = 'rgb(110, 103, 91)';
const DEAL = 'rgb(154, 82, 0)'; // --color-text-price-deal = --orange-700 (§4 Q2)
const FRAME_SPEC = { borderRadius: '16px', backgroundColor: 'rgb(255, 255, 255)', boxShadow: 'rgba(28, 26, 22, 0.06) 0px 1px 2px 0px, rgba(28, 26, 22, 0.05) 0px 2px 8px 0px' };
const INSET = { paddingTop: px(M.inset), paddingRight: px(M.inset), paddingBottom: px(M.inset), paddingLeft: px(M.inset) };
const PRICE = { fontSize: '16px', lineHeight: px(M.price), fontWeight: '700', letterSpacing: 'normal', color: DEAL, fontFamilyKind: 'inter' };
const STRIKE = { fontWeight: '400', color: MUTED, textDecorationLine: 'line-through' };
const SMALL = { fontSize: '12px', lineHeight: px(M.meta), fontWeight: '500', letterSpacing: 'normal', color: MUTED, fontFamilyKind: 'inter' };

/**
 * Bảng chuẩn: số đo Mini 375px đối chiếu DESIGN.md (tiêu đề khối Inter 16/700 -0,01em, giá giảm màu cam đậm Q2, thẻ rộng `--tile-w-sm` 128 ở kệ),
 * chiều cao dòng lấy từ `TILE_METRICS` để đổi số đo thân thẻ là đổi cả bảng. Giá trị computed nên màu ở dạng rgb().
 */
export const EXPECTED: Record<string, Record<string, string>> = {
  'section-title': { fontSize: '16px', lineHeight: '24px', fontWeight: '700', letterSpacing: '-0.16px', color: 'rgb(122, 67, 0)', fontFamilyKind: 'inter' },
  'section-header': { height: '44px', display: 'flex', justifyContent: 'space-between' },

  'tile-flash': { width: '128px', ...FRAME_SPEC },
  'tile-flash-body': INSET,
  'tile-flash-name': { fontSize: '13px', lineHeight: px(M.nameCaption / 2), fontWeight: '400', letterSpacing: 'normal', color: INK, fontFamilyKind: 'inter' },
  'tile-flash-price': PRICE,
  'tile-flash-compare': { ...STRIKE, fontSize: '12px', lineHeight: px(M.compare) },

  'tile-line': { width: '343px', ...FRAME_SPEC },
  'tile-line-media': { width: '64px', height: '64px', borderRadius: '12px' },
  'tile-line-name': { fontSize: '14px', lineHeight: px(M.name / 2), fontWeight: '600', letterSpacing: 'normal', color: INK, fontFamilyKind: 'inter' },
  'tile-line-price': { ...PRICE, fontSize: '14px', lineHeight: '20.02px', fontWeight: '600' },
  'tile-line-compare': { ...STRIKE, fontSize: '13px', lineHeight: px(M.compare) },

  'tile-grid': { width: '165.5px', ...FRAME_SPEC },
  'tile-grid-body': INSET,
  'tile-grid-brand': SMALL,
  'tile-grid-name': { fontSize: '14px', lineHeight: px(M.name / 2), fontWeight: '400', letterSpacing: 'normal', color: INK, fontFamilyKind: 'inter' },
  'tile-grid-price': PRICE,
  'tile-grid-compare': { ...STRIKE, fontSize: '13px', lineHeight: px(M.compare) },
  'tile-grid-meta': SMALL,
};
