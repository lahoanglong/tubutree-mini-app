// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { productCardView, type CardVariant, type ProductCardView } from '@tubutree/app-core/commerce/product-card-view';
import { META_SHORT_MAX_CHARS, tileBodyHeight, TILE_METRICS } from '@tubutree/app-core/commerce/tile-metrics';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { ProductTile, TILE_NAME_MIN_HEIGHT } from './product-tile';

const NOW = Date.parse('2026-11-01T05:00:00Z');
const VARIANTS: CardVariant[] = ['grid', 'rail-sm', 'rail-md', 'flash', 'rank', 'line'];

const PRODUCT: ProductCard = {
  id: 'p1', slug: 'serum-x', name: 'Serum Bã Trầu', brand: 'Tubu', thumbnail: null,
  basePrice: 52_000, salePrice: null, isFeatured: false, inStock: true, reviewCount: 12, ratingAvg: 4.5, sold: 340,
};

const viewOf = (over: Partial<ProductCard> = {}, variant: CardVariant = 'grid', extra: Partial<Parameters<typeof productCardView>[0]> = {}): ProductCardView =>
  productCardView({ product: { ...PRODUCT, ...over }, variant, now: NOW, ...extra });

const tile = (view: ProductCardView, variant: CardVariant, props: Partial<React.ComponentProps<typeof ProductTile>> = {}) =>
  mount(<ProductTile view={view} variant={variant} href="/san-pham/serum-x" {...props} />).container;
const shell = (c: HTMLElement) => c.firstElementChild as HTMLElement;
const body = (c: HTMLElement) => c.querySelector('[data-ds-part="body"]') as HTMLElement;
const part = (c: HTMLElement, name: string) => c.querySelector(`[data-ds-part="${name}"]`) as HTMLElement | null;
const link = (c: HTMLElement) => c.querySelector('a.tubu-tile-link') as HTMLAnchorElement;
const described = (c: HTMLElement) => c.querySelector(`#${CSS.escape(link(c).getAttribute('aria-describedby')!)}`)!.textContent;
// Thẻ line cao cố định ở vỏ (ảnh 64 + đệm), các biến thể khác ở thân thẻ.
const fixedHeightOf = (c: HTMLElement, variant: CardVariant) => (variant === 'line' ? shell(c) : body(c)).style.minHeight;
// Bấm liên kết mà không để jsdom thử điều hướng thật.
const clickLink = (a: HTMLElement) => {
  a.addEventListener('click', (e) => e.preventDefault(), { once: true });
  click(a);
};

beforeEach(() => document.body.replaceChildren());

describe('ProductTile: biến thể và khung', () => {
  it.each(VARIANTS)('%s: có data-ds, class nhấn thẻ, ảnh vuông giữ chỗ (trừ line)', (variant) => {
    const c = tile(viewOf({}, variant), variant);
    expect(shell(c).getAttribute('data-ds')).toBe('product-tile');
    expect(shell(c).getAttribute('data-ds-variant')).toBe(variant);
    expect(shell(c).className).toContain('tubu-press-card');
    const media = part(c, 'media')!;
    if (variant === 'line') expect(media.style.height).toBe('64px');
    else expect(media.style.aspectRatio).toBe('1 / 1');
  });

  it.each(VARIANTS)('%s: thân thẻ cao đúng số đo chung kể cả khi thiếu sao và đã bán (meta=null)', (variant) => {
    const expected = tileBodyHeight(variant, { brand: variant === 'grid' || variant === 'rail-md' });
    expect(fixedHeightOf(tile(viewOf({}, variant), variant), variant)).toBe(`${expected}px`);
    expect(viewOf({ ratingAvg: undefined, sold: undefined }, variant).meta).toBeNull();
    const bare = tile(viewOf({ reviewCount: 0, ratingAvg: undefined, sold: undefined }, variant), variant);
    expect(fixedHeightOf(bare, variant)).toBe(`${expected}px`);
  });

  it('thẻ grid/rail-md/rank giữ ô meta cao 16px dù meta=null (không nhảy)', () => {
    for (const variant of ['grid', 'rail-md', 'rank'] as const) {
      const c = tile(viewOf({ ratingAvg: undefined, sold: undefined }, variant), variant);
      expect(part(c, 'meta')!.style.height).toBe('16px');
    }
  });

  it('showBrand=false (brandLine=null) bỏ dòng nhãn hiệu và hạ chiều cao tương ứng', () => {
    const c = tile(viewOf({}, 'grid', { showBrand: false }), 'grid');
    expect(part(c, 'brand')).toBeNull();
    expect(body(c).style.minHeight).toBe(`${tileBodyHeight('grid', { brand: false })}px`);
  });

  it('tên cắt 2 dòng, cao tối thiểu TILE_NAME_MIN_HEIGHT, dòng 22px (không hạ: dấu hoa bị cắt)', () => {
    expect(TILE_NAME_MIN_HEIGHT).toBe(44);
    const long = 'Ẩm Ổn Định Dầu Gội Thảo Mộc Bồ Kết Hương Sả Chanh Nguyên Chất Dung Tích Lớn Cho Cả Gia Đình';
    const c = tile(viewOf({ name: long }), 'grid');
    expect(link(c).getAttribute('aria-label')).toBe(long);
    const text = link(c).firstElementChild as HTMLElement;
    expect(text.style.webkitLineClamp).toBe('2');
    expect(text.style.minHeight).toBe('44px');
    expect(text.style.lineHeight).toBe('22px');
  });

  it('thẻ Giờ vàng cắt tên một dòng (Q11, cao 20px); các thẻ caption khác (rail-sm) vẫn hai dòng 40px', () => {
    const name = 'Khăn ướt không cồn Bé Na';
    const flash = tile(viewOf({ name }, 'flash'), 'flash');
    const flashName = link(flash).firstElementChild as HTMLElement;
    expect(flashName.style.webkitLineClamp).toBe('1');
    expect(flashName.style.minHeight).toBe(`${TILE_METRICS.nameFlash}px`);
    const rail = tile(viewOf({ name }, 'rail-sm'), 'rail-sm');
    const railName = link(rail).firstElementChild as HTMLElement;
    expect(railName.style.webkitLineClamp).toBe('2');
    expect(railName.style.minHeight).toBe(`${TILE_METRICS.nameCaption}px`);
  });

  it('dòng meta mang bản gọn (data-compact) khi có đủ sao và lượt bán: thẻ hẹp tự đổi sang bản gọn bằng container query, chữ đầy đủ vẫn là textContent của ô meta', () => {
    const c = tile(viewOf({ ratingAvg: 4.7, sold: 8200 }, 'rank'), 'rank');
    const meta = part(c, 'meta')!;
    expect(meta.textContent).toBe('★ 4,7 · Đã bán 8,2k+');
    expect(meta.className).toContain('tubu-tile-meta');
    expect(meta.querySelector('.tubu-meta-text')!.getAttribute('data-compact')).toBe('Đã bán 8,2k+');
    expect(meta.querySelector('.tubu-meta-full')!.textContent).toBe('★ 4,7 · Đã bán 8,2k+');
  });

  it('meta chỉ có một nửa (bản gọn trùng bản đầy đủ) hoặc không có gì thì không thêm bản gọn', () => {
    for (const over of [{ ratingAvg: undefined, sold: 12 }, { ratingAvg: 4.5, sold: undefined }, { ratingAvg: undefined, sold: undefined }]) {
      expect(tile(viewOf(over, 'rank'), 'rank').querySelector('[data-compact]')).toBeNull();
    }
  });

  it('lượt bán từ 100k làm chữ đầy đủ dài hơn trần "ngắn" nên ô gắn data-long; chữ đầy đủ xấu nhất của ngưỡng thường thì không', () => {
    const attr = (over: Partial<ProductCard>) => tile(viewOf({ ratingAvg: 5, ...over }, 'rank'), 'rank').querySelector('.tubu-meta-text')!.hasAttribute('data-long');
    expect(viewOf({ ratingAvg: 5, sold: 99_900 }, 'rank').meta).toHaveLength(META_SHORT_MAX_CHARS);
    expect(attr({ sold: 99_900 })).toBe(false);
    expect(attr({ sold: 8_200 })).toBe(false);
    expect(attr({ sold: 123_400 })).toBe(true);
    expect(attr({ sold: 99_900_000 })).toBe(true);
  });

  it('CSS: ô meta là container; dưới 132px (rank 112px, lưới 320px 122px) chữ gọn thay chữ đầy đủ, rail-md 132px và lưới 360px/375px giữ sao; chữ dài (data-long) đổi dưới 148px', () => {
    const css = readFileSync(resolve(__dirname, './mini.css'), 'utf8');
    expect(css).toMatch(/\.tubu-tile-meta\s*\{[^}]*container-type:\s*inline-size/);
    expect(css).toMatch(/\.tubu-meta-text\[data-compact\]::after\s*\{[^}]*content:\s*attr\(data-compact\)/);
    expect(css).toMatch(/@container \(max-width: 131\.98px\)\s*\{\s*\.tubu-meta-text\[data-compact\] > \.tubu-meta-full\s*\{\s*display:\s*none/);
    expect(css).toMatch(/@container \(max-width: 147\.98px\)\s*\{\s*\.tubu-meta-text\[data-compact\]\[data-long\] > \.tubu-meta-full\s*\{\s*display:\s*none/);
    // Ngưỡng cũ 147.98px làm mất sao ở mọi thẻ rail-md và lưới 360px dù chữ đầy đủ vẫn vừa.
    expect(css).not.toMatch(/@container \(max-width: 147\.98px\)\s*\{\s*\.tubu-meta-text\[data-compact\] >/);
  });

  it('giá thường màu giá thường, giá giảm màu tông deal; giá thẻ dùng bậc 16/700', () => {
    const find = (c: HTMLElement, text: string) => Array.from(c.querySelectorAll<HTMLElement>('[data-ds-part="price"] span')).find((e) => e.textContent === text)!;
    const plain = tile(viewOf(), 'grid');
    expect(find(plain, '52.000đ').style.color).toBe('var(--color-text-price)');
    expect(find(plain, '52.000đ').style.fontSize).toBe('var(--type-price-tile-size)');
    const deal = tile(viewOf({ basePrice: 52_000, salePrice: 39_000 }), 'grid');
    expect(find(deal, '39.000đ').style.color).toBe('var(--color-text-price-deal)');
  });

  it('thẻ xếp chồng giữ chỗ dòng giá gạch ngay dưới giá dù không giảm giá (số giá thẳng hàng khi cạnh thẻ có giá gạch); grid thì không', () => {
    const reserved = `${TILE_METRICS.price + TILE_METRICS.compare}px`;
    for (const variant of ['rail-sm', 'rail-md', 'flash', 'rank'] as const) {
      const plain = tile(viewOf({}, variant), variant);
      const sale = tile(viewOf({ salePrice: 39_000 }, variant), variant);
      expect(part(plain, 'price')!.style.minHeight, `${variant} giá thường`).toBe(reserved);
      expect(part(sale, 'price')!.style.minHeight, `${variant} giá giảm`).toBe(reserved);
    }
    expect(part(tile(viewOf({}, 'grid'), 'grid'), 'price')!.style.minHeight).toBe('');
  });

  it('giá gạch xếp chồng ở thẻ hẹp, cùng hàng ở grid', () => {
    const sale = { basePrice: 52_000, salePrice: 39_000 };
    const dir = (c: HTMLElement) => (Array.from(c.querySelectorAll<HTMLElement>('[data-ds-part="price"] span')).find((e) => e.textContent === '39.000đ')!.parentElement as HTMLElement).style.flexDirection;
    expect(dir(tile(viewOf(sale, 'rail-md'), 'rail-md'))).toBe('column');
    expect(dir(tile(viewOf(sale, 'grid'), 'grid'))).not.toBe('column');
  });

  it('khổ máy tính: viền, bóng thẻ và nâng nhẹ khi rê chuột chỉ từ md; điện thoại là thẻ phẳng elevation-1 (không bóng inline)', () => {
    const c = tile(viewOf(), 'grid');
    const cls = shell(c).className;
    expect(cls).toContain('[box-shadow:var(--elevation-1)]');
    expect(cls).toContain('md:border');
    expect(cls).toContain('md:shadow-card');
    expect(cls).toContain('md:hover:-translate-y-1');
    expect(shell(c).style.boxShadow).toBe('');
    expect(link(c).className).toContain('md:group-hover:text-forest-700');
  });
});

describe('ProductTile: nhãn, hết hàng, hạng', () => {
  it('nhãn ảnh Giờ vàng dùng tông flash (không ghi đè style), nhãn giảm giá dùng tông promo', () => {
    const flash = viewOf({}, 'grid', { flash: { productSlug: 'serum-x', variationId: 'v1', flashPrice: 39_000, endAt: new Date(NOW + 3_600_000).toISOString() } });
    const a = tile(flash, 'grid');
    const badge = a.querySelector('[data-ds-part="image-badge"] span') as HTMLElement;
    expect(badge.textContent).toContain('Giờ vàng -25%');
    expect(badge.style.background).toBe('var(--color-flash-solid-bg)');
    const b = tile(viewOf({ basePrice: 52_000, salePrice: 39_000 }), 'grid');
    expect((b.querySelector('[data-ds-part="image-badge"] span') as HTMLElement).style.background).toBe('var(--color-promo-bg)');
  });

  it('nhãn Giờ vàng vẽ cả chữ đầy đủ lẫn bản "-x%"; khung ảnh là vùng chứa để CSS chọn bản vừa chỗ, thẻ rộng không đổi chữ', () => {
    const flash = viewOf({}, 'rail-md', { flash: { productSlug: 'serum-x', variationId: 'v1', flashPrice: 39_000, endAt: new Date(NOW + 3_600_000).toISOString() } });
    const c = tile(flash, 'rail-md');
    const badge = part(c, 'image-badge')!;
    expect(badge.querySelector('.tubu-badge-long')?.textContent).toBe('Giờ vàng -25%');
    expect(badge.querySelector('.tubu-badge-short')?.textContent).toBe('-25%');
    expect(part(c, 'media')!.classList.contains('tubu-tile-media')).toBe(true);
  });

  it('nhãn đầu tên vẽ cùng dòng với tên, tên vẫn cắt 2 dòng', () => {
    const c = tile(viewOf({ isFeatured: true }), 'grid');
    expect(link(c).textContent).toContain('Tubu chọn');
    expect((link(c).firstElementChild as HTMLElement).style.webkitLineClamp).toBe('2');
  });

  it('hết hàng: chữ "Tạm hết hàng", không nhãn, vẫn là liên kết vào chi tiết, mô tả đọc có tình trạng và giá', () => {
    const c = tile(viewOf({ inStock: false, isFeatured: true, basePrice: 52_000, salePrice: 39_000 }), 'grid');
    expect(c.textContent).toContain('Tạm hết hàng');
    expect(c.textContent).not.toContain('Tubu chọn');
    expect(part(c, 'image-badge')).toBeNull();
    expect(link(c).getAttribute('href')).toBe('/san-pham/serum-x');
    expect(described(c)).toMatch(/^Tạm hết hàng, .*Giá 39\.000đ, giá gốc 52\.000đ$/);
  });

  it('mô tả đọc theo thứ tự: tình trạng, nhãn, sao và đã bán, giá', () => {
    const c = tile(viewOf({ basePrice: 52_000, salePrice: 39_000, ratingAvg: 4.8, sold: 1234 }), 'grid');
    expect(described(c)).toBe('Giảm 25%, 4,8 sao, đã bán hơn 1.200, Giá 39.000đ, giá gốc 52.000đ');
  });

  it('phần nhìn thấy của giá, meta, nhãn hiệu không bị đọc lại ngoài mô tả (aria-hidden)', () => {
    const c = tile(viewOf({ ratingAvg: 4.8, sold: 1234 }), 'grid');
    for (const name of ['meta', 'price', 'brand']) expect(part(c, name)!.getAttribute('aria-hidden')).toBe('true');
  });

  it('hạng: ruy-băng có số, đọc "Hạng n bán chạy", nhãn giảm xuống dưới ảnh; hạng 12 không tràn khỏi ảnh', () => {
    const c = tile(viewOf({ basePrice: 52_000, salePrice: 39_000 }, 'rank', { rank: 12 }), 'rank');
    expect(part(c, 'rank')!.textContent).toBe('#12');
    expect(part(c, 'rank')!.style.maxWidth).toBe('calc(100% - 16px)');
    expect(described(c)).toMatch(/^Hạng 12 bán chạy/);
    expect(part(c, 'image-badge')!.style.bottom).toBe('8px');
  });

  it('hạng top 3 dùng màu hạng riêng, từ 4 dùng màu hạng thường, thiếu rank thì không ruy-băng', () => {
    expect(part(tile(viewOf({}, 'rank', { rank: 1 }), 'rank'), 'rank')!.style.background).toBe('var(--color-rank-1-bg)');
    expect(part(tile(viewOf({}, 'rank', { rank: 4 }), 'rank'), 'rank')!.style.background).toBe('var(--color-rank-n-bg)');
    const none = tile(viewOf({}, 'rank'), 'rank');
    expect(part(none, 'rank')).toBeNull();
    expect(none.textContent).not.toContain('undefined');
  });
});

describe('ProductTile: liên kết, nút phụ, ô trang trí', () => {
  it('liên kết tên là <a href> tới trang chi tiết, tên truy cập = tên sản phẩm; bấm gọi onOpen', () => {
    const onOpen = vi.fn();
    const c = tile(viewOf(), 'grid', { onOpen });
    expect(link(c).getAttribute('href')).toBe('/san-pham/serum-x');
    expect(link(c).getAttribute('aria-label')).toBe('Serum Bã Trầu');
    clickLink(link(c));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('onAdd vẽ nút phụ nhãn addLabel, bấm không mở thẻ', () => {
    const onAdd = vi.fn();
    const onOpen = vi.fn();
    const c = tile(viewOf({}, 'rail-md'), 'rail-md', { onAdd, addLabel: 'Mua lại', onOpen });
    const btn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Mua lại')!;
    click(btn);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('thẻ line: action là nút tuỳ ý cùng hàng, bấm không điều hướng; bấm tên vẫn là liên kết tới sản phẩm', () => {
    const onPress = vi.fn();
    const c = tile(viewOf({}, 'line'), 'line', {
      action: (
        <button type="button" aria-pressed={false} onClick={onPress}>
          Nhắc tôi Serum
        </button>
      ),
    });
    const btn = c.querySelector('button[aria-pressed]') as HTMLButtonElement;
    expect(btn.textContent).toBe('Nhắc tôi Serum');
    click(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(link(c).getAttribute('href')).toBe('/san-pham/serum-x');
    expect(btn.parentElement!.style.zIndex).toBe('1');
    expect(link(c).contains(btn)).toBe(false);
  });

  it('action chỉ có ở biến thể line (thẻ dọc không có chỗ cho nó)', () => {
    const c = tile(viewOf({}, 'grid'), 'grid', { action: <button type="button">Nhắc tôi</button> });
    expect(c.textContent).not.toContain('Nhắc tôi');
  });

  it('dimMedia chỉ làm mờ vùng ảnh, thân thẻ giữ chữ nguyên độ đậm', () => {
    const c = tile(viewOf({}, 'line'), 'line', { dimMedia: true });
    expect((c.querySelector('[data-ds-part="media"]') as HTMLElement).style.opacity).toBe('0.55');
    expect((c.querySelector('[data-ds-part="body"]') as HTMLElement).style.opacity).toBe('');
    expect((c.firstElementChild as HTMLElement).style.opacity).toBe('');
  });

  it('không có dimMedia thì ảnh không mờ', () => {
    const c = tile(viewOf({}, 'line'), 'line');
    expect((c.querySelector('[data-ds-part="media"]') as HTMLElement).style.opacity).toBe('');
  });

  it('thẻ line: nút phụ cùng hàng, mặc định nhãn "Thêm"', () => {
    const c = tile(viewOf({}, 'line'), 'line', { onAdd: () => {} });
    expect(Array.from(c.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Thêm']);
  });

  it('hidePrice không in giá nhưng giữ chiều cao thân thẻ', () => {
    const c = tile(viewOf({}, 'rail-sm'), 'rail-sm', { hidePrice: true });
    expect(c.textContent).not.toContain('52.000đ');
    expect(body(c).style.minHeight).toBe(`${tileBodyHeight('rail-sm')}px`);
  });

  it('note một dòng dưới giá và footer nằm trong thẻ, cộng vào chiều cao', () => {
    const c = tile(viewOf({}, 'flash'), 'flash', { note: 'Phân loại 500ml', footerHeight: 28, footer: <div data-testid="foot" style={{ height: 28 }} /> });
    expect(part(c, 'note')!.textContent).toBe('Phân loại 500ml');
    expect(c.querySelector('[data-testid="foot"]')).not.toBeNull();
    expect(body(c).style.minHeight).toBe(`${tileBodyHeight('flash', { note: true, footer: 28 })}px`);
  });

  it('note rỗng giữ chỗ dòng ghi chú (thẻ cùng kệ không lệch giá); không truyền note thì không có dòng', () => {
    const reserved = tile(viewOf({}, 'rail-md'), 'rail-md', { note: '' });
    expect(body(reserved).style.minHeight).toBe(`${tileBodyHeight('rail-md', { note: true })}px`);
    expect(part(reserved, 'note')).not.toBeNull();
    const none = tile(viewOf({}, 'rail-md'), 'rail-md');
    expect(body(none).style.minHeight).toBe(`${tileBodyHeight('rail-md')}px`);
    expect(part(none, 'note')).toBeNull();
  });

  it('priority tải ảnh ngay (eager, fetchpriority=high); mặc định tải lười', () => {
    const v = viewOf({ thumbnail: 'https://cdn.example/a.jpg' });
    const eager = tile(v, 'grid', { priority: true }).querySelector('img')!;
    expect(eager.getAttribute('loading')).toBe('eager');
    expect(eager.getAttribute('fetchpriority')).toBe('high');
    const lazy = tile(v, 'grid').querySelector('img')!;
    expect(lazy.getAttribute('loading')).toBe('lazy');
    expect(lazy.getAttribute('fetchpriority')).toBeNull();
    expect(lazy.getAttribute('alt')).toBe('');
  });
});

describe('ProductTile: cấu trúc truy cập', () => {
  const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';
  const heart = <button type="button" aria-label="tim">♥</button>;

  it('thứ tự Tab: liên kết tên, rồi tim, rồi nút nổi trên ảnh, rồi nút phụ', () => {
    const c = tile(viewOf({}, 'rail-md'), 'rail-md', { wishlist: heart, imageOverlay: <button type="button" aria-label="nút nổi">+</button>, onAdd: () => {}, addLabel: 'Mua lại' });
    expect(Array.from(c.querySelectorAll(INTERACTIVE)).map((e) => e.getAttribute('aria-label') ?? e.textContent)).toEqual(['Serum Bã Trầu', 'tim', 'nút nổi', 'Mua lại']);
  });

  it('một thẻ chỉ có MỘT liên kết tới sản phẩm; không phần tử bấm được nào chứa phần tử bấm được khác', () => {
    const c = tile(viewOf({}, 'rail-md'), 'rail-md', { wishlist: heart, onAdd: () => {} });
    expect(c.querySelectorAll('a[href]').length).toBe(1);
    const nested = Array.from(c.querySelectorAll(INTERACTIVE)).filter((el) => el.querySelector(INTERACTIVE));
    expect(nested.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
  });

  it('liên kết tên không có định vị riêng, vỏ thẻ position:relative và isolation', () => {
    const c = tile(viewOf(), 'grid');
    expect(link(c).className).toContain('tubu-tile-link');
    expect(link(c).style.position).toBe('');
    expect(shell(c).style.position).toBe('relative');
    expect(shell(c).style.isolation).toBe('isolate');
  });

  it('tim và nút phụ nổi trên lớp phủ bằng z-index; dạng line không vẽ tim', () => {
    const c = tile(viewOf({}, 'rail-md'), 'rail-md', { wishlist: heart, onAdd: () => {}, addLabel: 'Mua lại' });
    const lifted = (el: Element | null) => {
      for (let e = el as HTMLElement | null; e && e !== c; e = e.parentElement) if (e.style.zIndex === '1') return true;
      return false;
    };
    expect(lifted(c.querySelector('[aria-label="tim"]'))).toBe(true);
    expect(lifted(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Mua lại')!)).toBe(true);
    expect(tile(viewOf({}, 'line'), 'line', { wishlist: heart }).querySelector('[aria-label="tim"]')).toBeNull();
  });

  it('phím trên tim không kích hoạt liên kết của thẻ', () => {
    const onOpen = vi.fn();
    const c = tile(viewOf(), 'grid', { wishlist: heart, onOpen });
    act(() => {
      (c.querySelector('[aria-label="tim"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onOpen).not.toHaveBeenCalled();
  });
});
