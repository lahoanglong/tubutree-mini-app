import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { productCardView, type CardVariant, type ProductCardView } from '@tubutree/app-core/commerce/product-card-view';
import { tileBodyHeight, TILE_METRICS } from '@tubutree/app-core/commerce/tile-metrics';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('zmp-ui', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useNavigate: () => navigate }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { ProductTile, TILE_NAME_MIN_HEIGHT } from './product-tile';

const NOW = Date.parse('2026-11-01T05:00:00Z');
const VARIANTS: CardVariant[] = ['grid', 'rail-sm', 'rail-md', 'flash', 'rank', 'line'];

const PRODUCT: ProductCard = {
  id: 'p1', slug: 'serum-x', name: 'Serum Bã Trầu', brand: 'Tubu', thumbnail: null,
  basePrice: 52_000, salePrice: null, isFeatured: false, inStock: true, reviewCount: 12, ratingAvg: 4.5, sold: 340,
};

const viewOf = (over: Partial<ProductCard> = {}, variant: CardVariant = 'grid', extra: Partial<Parameters<typeof productCardView>[0]> = {}): ProductCardView =>
  productCardView({ product: { ...PRODUCT, ...over }, variant, now: NOW, ...extra });

const shell = (container: HTMLElement) => container.firstElementChild as HTMLElement;
const body = (container: HTMLElement) => container.querySelector('[data-ds-part="body"]') as HTMLElement;
// Thẻ line cao cố định ở vỏ (ảnh 64 + đệm), các biến thể khác ở thân thẻ.
const fixedHeightOf = (container: HTMLElement, variant: CardVariant) => (variant === 'line' ? shell(container) : body(container)).style.minHeight;

beforeEach(() => navigate.mockClear());

describe('ProductTile: biến thể và khung', () => {
  it.each(VARIANTS)('%s: có data-ds, class nhấn thẻ, ảnh vuông giữ chỗ (trừ line)', (variant) => {
    const { container } = render(<ProductTile view={viewOf({}, variant)} variant={variant} href="/product/serum-x" />);
    expect(shell(container)).toHaveAttribute('data-ds', 'product-tile');
    expect(shell(container)).toHaveAttribute('data-ds-variant', variant);
    expect(shell(container).className).toContain('tubu-press-card');
    const media = container.querySelector('[data-ds-part="media"]') as HTMLElement;
    if (variant === 'line') expect(media.style.height).toBe('64px');
    else expect(media.style.aspectRatio).toBe('1 / 1');
  });

  it.each(VARIANTS)('%s: thân thẻ cao đúng số đo chung kể cả khi thiếu sao và đã bán (meta=null)', (variant) => {
    const withMeta = render(<ProductTile view={viewOf({}, variant)} variant={variant} href="/p" />);
    const expected = tileBodyHeight(variant, { brand: variant === 'grid' || variant === 'rail-md' });
    expect(fixedHeightOf(withMeta.container, variant)).toBe(`${expected}px`);
    withMeta.unmount();
    const bare = render(<ProductTile view={viewOf({ reviewCount: 0, ratingAvg: undefined, sold: undefined }, variant)} variant={variant} href="/p" />);
    expect(viewOf({ ratingAvg: undefined, sold: undefined }, variant).meta).toBeNull();
    expect(fixedHeightOf(bare.container, variant)).toBe(`${expected}px`);
  });

  it('thẻ grid/rail-md/rank giữ ô meta cao 16px dù meta=null (không nhảy)', () => {
    for (const variant of ['grid', 'rail-md', 'rank'] as const) {
      const { container, unmount } = render(<ProductTile view={viewOf({ ratingAvg: undefined, sold: undefined }, variant)} variant={variant} href="/p" />);
      expect((container.querySelector('[data-ds-part="meta"]') as HTMLElement).style.height).toBe('16px');
      unmount();
    }
  });

  it('showBrand=false (brandLine=null) bỏ dòng nhãn hiệu và hạ chiều cao tương ứng', () => {
    const { container } = render(<ProductTile view={viewOf({}, 'grid', { showBrand: false })} variant="grid" href="/p" />);
    expect(container.querySelector('[data-ds-part="brand"]')).toBeNull();
    expect(body(container).style.minHeight).toBe(`${tileBodyHeight('grid', { brand: false })}px`);
  });

  it('tên cắt 2 dòng, cao tối thiểu TILE_NAME_MIN_HEIGHT, dòng 22px (không hạ: dấu hoa bị cắt)', () => {
    expect(TILE_NAME_MIN_HEIGHT).toBe(44);
    const long = 'Ẩm Ổn Định Dầu Gội Thảo Mộc Bồ Kết Hương Sả Chanh Nguyên Chất Dung Tích Lớn Cho Cả Gia Đình';
    render(<ProductTile view={viewOf({ name: long })} variant="grid" href="/p" />);
    const text = screen.getByRole('button', { name: long }).firstElementChild as HTMLElement;
    expect(text.style.webkitLineClamp).toBe('2');
    expect(text.style.minHeight).toBe('44px');
    expect(text.style.lineHeight).toBe('22px');
  });

  it('thẻ Giờ vàng cắt tên một dòng (Q11, cao 20px); các thẻ caption khác (rail-sm) vẫn hai dòng 40px', () => {
    const name = 'Khăn ướt không cồn Bé Na';
    const flash = render(<ProductTile view={viewOf({ name }, 'flash')} variant="flash" href="/p" />);
    const flashName = screen.getByRole('button', { name }).firstElementChild as HTMLElement;
    expect(flashName.style.webkitLineClamp).toBe('1');
    expect(flashName.style.minHeight).toBe(`${TILE_METRICS.nameFlash}px`);
    flash.unmount();
    render(<ProductTile view={viewOf({ name }, 'rail-sm')} variant="rail-sm" href="/p" />);
    const railName = screen.getByRole('button', { name }).firstElementChild as HTMLElement;
    expect(railName.style.webkitLineClamp).toBe('2');
    expect(railName.style.minHeight).toBe(`${TILE_METRICS.nameCaption}px`);
  });

  it('dòng meta mang bản gọn (data-compact) khi có đủ sao và lượt bán: thẻ hẹp tự đổi sang bản gọn bằng container query, chữ đầy đủ vẫn là textContent của ô meta', () => {
    const { container } = render(<ProductTile view={viewOf({ ratingAvg: 4.7, sold: 8200 }, 'rank')} variant="rank" href="/p" />);
    const meta = container.querySelector('[data-ds-part="meta"]') as HTMLElement;
    expect(meta.textContent).toBe('★ 4,7 · Đã bán 8,2k+');
    expect(meta.className).toContain('tubu-tile-meta');
    expect(meta.querySelector('.tubu-meta-text')!.getAttribute('data-compact')).toBe('Đã bán 8,2k+');
    expect(meta.querySelector('.tubu-meta-full')!.textContent).toBe('★ 4,7 · Đã bán 8,2k+');
  });

  it('meta chỉ có một nửa (bản gọn trùng bản đầy đủ) hoặc không có gì thì không thêm bản gọn', () => {
    for (const over of [{ ratingAvg: undefined, sold: 12 }, { ratingAvg: 4.5, sold: undefined }, { ratingAvg: undefined, sold: undefined }]) {
      const { container, unmount } = render(<ProductTile view={viewOf(over, 'rank')} variant="rank" href="/p" />);
      expect(container.querySelector('[data-compact]')).toBeNull();
      unmount();
    }
  });

  it('CSS: ô meta là container, dưới 148px chữ gọn thay chữ đầy đủ (rank 112px, rail-md 132px, lưới 320px; lưới 375px 149px còn đủ chỗ)', () => {
    const css = readFileSync(resolve(__dirname, '../../css/tokens.css'), 'utf8');
    expect(css).toMatch(/\.tubu-tile-meta\s*\{[^}]*container-type:\s*inline-size/);
    expect(css).toMatch(/\.tubu-meta-text\[data-compact\]::after\s*\{[^}]*content:\s*attr\(data-compact\)/);
    expect(css).toMatch(/@container \(max-width: 147\.98px\)[\s\S]*?\.tubu-meta-text\[data-compact\] > \.tubu-meta-full\s*\{\s*display:\s*none/);
  });

  it('giá thường màu giá thường, giá giảm màu tông deal; giá thẻ dùng bậc 16/700', () => {
    const plain = render(<ProductTile view={viewOf()} variant="grid" href="/p" />);
    expect(within(plain.container).getByText('52.000đ').style.color).toBe('var(--color-text-price)');
    expect(within(plain.container).getByText('52.000đ').style.fontSize).toBe('var(--type-price-tile-size)');
    plain.unmount();
    const deal = render(<ProductTile view={viewOf({ basePrice: 52_000, salePrice: 39_000 })} variant="grid" href="/p" />);
    expect(within(deal.container).getByText('39.000đ').style.color).toBe('var(--color-text-price-deal)');
  });

  it('thẻ xếp chồng giữ chỗ dòng giá gạch ngay dưới giá dù không giảm giá (số giá thẳng hàng khi cạnh thẻ có giá gạch); grid thì không', () => {
    const reserved = `${TILE_METRICS.price + TILE_METRICS.compare}px`;
    const priceBlock = (variant: CardVariant, over: Partial<ProductCard>) => {
      const { container } = render(<ProductTile view={viewOf(over, variant)} variant={variant} href="/product/serum-x" />);
      return container.querySelector('[data-ds-part="price"]') as HTMLElement;
    };
    for (const variant of ['rail-sm', 'rail-md', 'flash', 'rank'] as const) {
      expect(priceBlock(variant, {}).style.minHeight, `${variant} giá thường`).toBe(reserved);
      expect(priceBlock(variant, { salePrice: 39_000 }).style.minHeight, `${variant} giá giảm`).toBe(reserved);
    }
    expect(priceBlock('grid', {}).style.minHeight).toBe('');
  });

  it('giá gạch xếp chồng ở thẻ hẹp, cùng hàng ở grid', () => {
    const sale = { basePrice: 52_000, salePrice: 39_000 };
    const rail = render(<ProductTile view={viewOf(sale, 'rail-md')} variant="rail-md" href="/p" />);
    expect((within(rail.container).getByText('39.000đ').parentElement as HTMLElement).style.flexDirection).toBe('column');
    rail.unmount();
    const grid = render(<ProductTile view={viewOf(sale, 'grid')} variant="grid" href="/p" />);
    expect((within(grid.container).getByText('39.000đ').parentElement as HTMLElement).style.flexDirection).not.toBe('column');
  });
});

describe('ProductTile: nhãn, hết hàng, hạng', () => {
  it('nhãn ảnh Giờ vàng dùng tông flash (không ghi đè style), nhãn giảm giá dùng tông promo', () => {
    const flash = viewOf({}, 'grid', { flash: { productSlug: 'serum-x', variationId: 'v1', flashPrice: 39_000, endAt: new Date(NOW + 3_600_000).toISOString() } });
    const a = render(<ProductTile view={flash} variant="grid" href="/p" />);
    const badge = a.container.querySelector('[data-ds-part="image-badge"] span') as HTMLElement;
    expect(badge).toHaveTextContent('Giờ vàng -25%');
    expect(badge.style.background).toBe('var(--color-flash-solid-bg)');
    a.unmount();
    const b = render(<ProductTile view={viewOf({ basePrice: 52_000, salePrice: 39_000 })} variant="grid" href="/p" />);
    expect((b.container.querySelector('[data-ds-part="image-badge"] span') as HTMLElement).style.background).toBe('var(--color-promo-bg)');
  });

  it('nhãn Giờ vàng vẽ cả chữ đầy đủ lẫn bản "-x%"; khung ảnh là vùng chứa để CSS chọn bản vừa chỗ, thẻ rộng không đổi chữ', () => {
    const flash = viewOf({}, 'rail-md', { flash: { productSlug: 'serum-x', variationId: 'v1', flashPrice: 39_000, endAt: new Date(NOW + 3_600_000).toISOString() } });
    const { container } = render(<ProductTile view={flash} variant="rail-md" href="/p" />);
    const badge = container.querySelector('[data-ds-part="image-badge"]') as HTMLElement;
    expect(badge.querySelector('.tubu-badge-long')).toHaveTextContent('Giờ vàng -25%');
    expect(badge.querySelector('.tubu-badge-short')).toHaveTextContent('-25%');
    expect(container.querySelector('[data-ds-part="media"]')).toHaveClass('tubu-tile-media');
  });

  it('nhãn đầu tên vẽ cùng dòng với tên, tên vẫn cắt 2 dòng', () => {
    render(<ProductTile view={viewOf({ isFeatured: true })} variant="grid" href="/p" />);
    const nameBtn = screen.getByRole('button', { name: 'Serum Bã Trầu' });
    expect(within(nameBtn).getByText('Tubu chọn')).toBeInTheDocument();
    expect((nameBtn.firstElementChild as HTMLElement).style.webkitLineClamp).toBe('2');
  });

  it('hết hàng: chữ "Tạm hết hàng", không nhãn, vẫn vào được chi tiết, mô tả đọc có tình trạng và giá', () => {
    const { container } = render(<ProductTile view={viewOf({ inStock: false, isFeatured: true, basePrice: 52_000, salePrice: 39_000 })} variant="grid" href="/product/serum-x" />);
    expect(screen.getByText('Tạm hết hàng')).toBeInTheDocument();
    expect(screen.queryByText('Tubu chọn')).toBeNull();
    expect(container.querySelector('[data-ds-part="image-badge"]')).toBeNull();
    const btn = screen.getByRole('button', { name: 'Serum Bã Trầu' });
    expect(btn).toHaveAccessibleDescription(/^Tạm hết hàng, .*Giá 39\.000đ, giá gốc 52\.000đ$/);
    fireEvent.click(btn);
    expect(navigate).toHaveBeenCalledWith('/product/serum-x', undefined);
  });

  it('mô tả đọc theo thứ tự: tình trạng, nhãn, sao và đã bán, giá', () => {
    render(<ProductTile view={viewOf({ basePrice: 52_000, salePrice: 39_000, ratingAvg: 4.8, sold: 1234 })} variant="grid" href="/p" />);
    expect(screen.getByRole('button', { name: 'Serum Bã Trầu' })).toHaveAccessibleDescription(
      'Giảm 25%, 4,8 sao, đã bán hơn 1.200, Giá 39.000đ, giá gốc 52.000đ',
    );
  });

  it('phần nhìn thấy của giá, meta, nhãn không bị đọc lại ngoài mô tả (aria-hidden)', () => {
    const { container } = render(<ProductTile view={viewOf({ ratingAvg: 4.8, sold: 1234 })} variant="grid" href="/p" />);
    expect((container.querySelector('[data-ds-part="meta"]') as HTMLElement).getAttribute('aria-hidden')).toBe('true');
    expect((container.querySelector('[data-ds-part="price"]') as HTMLElement).getAttribute('aria-hidden')).toBe('true');
  });

  it('hạng: ruy-băng có số, đọc "Hạng n bán chạy", nhãn giảm xuống dưới ảnh; hạng 12 không tràn khỏi ảnh', () => {
    const v = viewOf({ basePrice: 52_000, salePrice: 39_000 }, 'rank', { rank: 12 });
    const { container } = render(<ProductTile view={v} variant="rank" href="/p" />);
    const ribbon = container.querySelector('[data-ds-part="rank"]') as HTMLElement;
    expect(ribbon).toHaveTextContent('12');
    expect(ribbon.style.maxWidth).toBe('calc(100% - 16px)');
    expect(screen.getByRole('button', { name: 'Serum Bã Trầu' })).toHaveAccessibleDescription(/^Hạng 12 bán chạy/);
    expect((container.querySelector('[data-ds-part="image-badge"]') as HTMLElement).style.bottom).toBe('8px');
  });

  it('hạng top 3 dùng màu hạng riêng, từ 4 dùng màu hạng thường, thiếu rank thì không ruy-băng', () => {
    const one = render(<ProductTile view={viewOf({}, 'rank', { rank: 1 })} variant="rank" href="/p" />);
    expect((one.container.querySelector('[data-ds-part="rank"]') as HTMLElement).style.background).toBe('var(--color-rank-1-bg)');
    one.unmount();
    const four = render(<ProductTile view={viewOf({}, 'rank', { rank: 4 })} variant="rank" href="/p" />);
    expect((four.container.querySelector('[data-ds-part="rank"]') as HTMLElement).style.background).toBe('var(--color-rank-n-bg)');
    four.unmount();
    const none = render(<ProductTile view={viewOf({}, 'rank')} variant="rank" href="/p" />);
    expect(none.container.querySelector('[data-ds-part="rank"]')).toBeNull();
    expect(none.container.textContent).not.toContain('undefined');
  });
});

describe('ProductTile: bấm, nút phụ, ô trang trí', () => {
  it('bấm nút tên: onOpen rồi navigate(href, { state })', () => {
    const onOpen = vi.fn();
    render(<ProductTile view={viewOf()} variant="grid" href="/product/serum-x" navState={{ listSource: 'home' }} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Serum Bã Trầu' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/product/serum-x', { state: { listSource: 'home' } });
  });

  it('onAdd vẽ nút phụ nhãn addLabel, bấm không điều hướng', () => {
    const onAdd = vi.fn();
    render(<ProductTile view={viewOf({}, 'rail-md')} variant="rail-md" href="/p" onAdd={onAdd} addLabel="Mua lại" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mua lại' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('thẻ line: nút phụ cùng hàng, mặc định nhãn "Thêm"', () => {
    render(<ProductTile view={viewOf({}, 'line')} variant="line" href="/p" onAdd={() => {}} />);
    expect(screen.getByRole('button', { name: 'Thêm' })).toBeInTheDocument();
  });

  it('thẻ line: action là nút tuỳ ý cùng hàng, bấm không điều hướng; bấm tên vẫn mở sản phẩm', () => {
    const onPress = vi.fn();
    render(
      <ProductTile
        view={viewOf({}, 'line')}
        variant="line"
        href="/product/serum-x"
        action={
          <button type="button" aria-pressed={false} onClick={onPress}>
            Nhắc tôi Serum
          </button>
        }
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Nhắc tôi Serum' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Serum Bã Trầu' }));
    expect(navigate).toHaveBeenCalledWith('/product/serum-x', undefined);
  });

  it('action chỉ có ở biến thể line (thẻ dọc không có chỗ cho nó)', () => {
    render(<ProductTile view={viewOf({}, 'grid')} variant="grid" href="/p" action={<button type="button">Nhắc tôi</button>} />);
    expect(screen.queryByRole('button', { name: 'Nhắc tôi' })).not.toBeInTheDocument();
  });

  it('dimMedia chỉ làm mờ vùng ảnh, thân thẻ giữ chữ nguyên độ đậm', () => {
    const { container } = render(<ProductTile view={viewOf({}, 'line')} variant="line" href="/p" dimMedia />);
    expect((container.querySelector('[data-ds-part="media"]') as HTMLElement).style.opacity).toBe('0.55');
    expect((container.querySelector('[data-ds-part="body"]') as HTMLElement).style.opacity).toBe('');
    expect((container.firstElementChild as HTMLElement).style.opacity).toBe('');
  });

  it('không có dimMedia thì ảnh không mờ', () => {
    const { container } = render(<ProductTile view={viewOf({}, 'line')} variant="line" href="/p" />);
    expect((container.querySelector('[data-ds-part="media"]') as HTMLElement).style.opacity).toBe('');
  });

  it('hidePrice không in giá nhưng giữ chiều cao thân thẻ', () => {
    const { container } = render(<ProductTile view={viewOf({}, 'rail-sm')} variant="rail-sm" href="/p" hidePrice />);
    expect(container.textContent).not.toContain('52.000đ');
    expect(body(container).style.minHeight).toBe(`${tileBodyHeight('rail-sm')}px`);
  });

  it('note một dòng dưới giá và footer nằm trong thẻ, cộng vào chiều cao', () => {
    const { container } = render(
      <ProductTile view={viewOf({}, 'flash')} variant="flash" href="/p" note="Phân loại 500ml" footerHeight={28} footer={<div data-testid="foot" style={{ height: 28 }} />} />,
    );
    expect(screen.getByText('Phân loại 500ml')).toBeInTheDocument();
    expect(within(container).getByTestId('foot')).toBeInTheDocument();
    expect(body(container).style.minHeight).toBe(`${tileBodyHeight('flash', { note: true, footer: 28 })}px`);
  });

  it('note rỗng giữ chỗ dòng ghi chú (thẻ cùng kệ không lệch giá); không truyền note thì không có dòng', () => {
    const reserved = render(<ProductTile view={viewOf({}, 'rail-md')} variant="rail-md" href="/p" note="" />);
    expect(body(reserved.container).style.minHeight).toBe(`${tileBodyHeight('rail-md', { note: true })}px`);
    expect(reserved.container.querySelector('[data-ds-part="note"]')).not.toBeNull();
    reserved.unmount();
    const none = render(<ProductTile view={viewOf({}, 'rail-md')} variant="rail-md" href="/p" />);
    expect(body(none.container).style.minHeight).toBe(`${tileBodyHeight('rail-md')}px`);
    expect(none.container.querySelector('[data-ds-part="note"]')).toBeNull();
  });
});

describe('ProductTile: cấu trúc truy cập', () => {
  const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';

  it('thứ tự Tab: nút tên, rồi tim, rồi nút nổi trên ảnh, rồi nút phụ', () => {
    render(
      <ProductTile
        view={viewOf({}, 'rail-md')}
        variant="rail-md"
        href="/p"
        wishlist={<button type="button" aria-label="tim">♥</button>}
        imageOverlay={<button type="button" aria-label="nút nổi">+</button>}
        onAdd={() => {}}
        addLabel="Mua lại"
      />,
    );
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Serum Bã Trầu', 'tim', 'nút nổi', 'Mua lại']);
  });

  it('không phần tử bấm được nào chứa phần tử bấm được khác', () => {
    const { container } = render(
      <ProductTile view={viewOf({}, 'rail-md')} variant="rail-md" href="/p" wishlist={<button type="button" aria-label="tim">♥</button>} onAdd={() => {}} />,
    );
    const nested = Array.from(container.querySelectorAll(INTERACTIVE)).filter((el) => el.querySelector(INTERACTIVE));
    expect(nested.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
  });

  it('nút tên không có định vị riêng, vỏ thẻ position:relative và isolation', () => {
    const { container } = render(<ProductTile view={viewOf()} variant="grid" href="/p" />);
    const link = screen.getByRole('button', { name: 'Serum Bã Trầu' });
    expect(link.className).toContain('tubu-tile-link');
    expect(link.style.position).toBe('');
    expect(shell(container).style.position).toBe('relative');
    expect(shell(container).style.isolation).toBe('isolate');
  });

  it('tim, nút phụ nổi trên lớp phủ bằng z-index; ảnh chỉ để trang trí', () => {
    const { container } = render(
      <ProductTile
        view={viewOf({ thumbnail: 'https://x/a.jpg' }, 'rail-md')}
        variant="rail-md"
        href="/p"
        wishlist={<button type="button" aria-label="tim">♥</button>}
        onAdd={() => {}}
        addLabel="Mua lại"
      />,
    );
    for (const name of ['tim', 'Mua lại']) {
      let el: HTMLElement | null = screen.getByRole('button', { name });
      let lifted = false;
      while (el && el !== container) {
        if (el.style.zIndex === '1') lifted = true;
        el = el.parentElement;
      }
      expect(lifted, name).toBe(true);
    }
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('bàn phím: Enter và Space ở nút tên điều hướng; phím trên tim không kích hoạt thẻ', async () => {
    const user = userEvent.setup();
    render(<ProductTile view={viewOf()} variant="grid" href="/p" wishlist={<button type="button" aria-label="tim">♥</button>} />);
    const link = screen.getByRole('button', { name: 'Serum Bã Trầu' });
    link.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(navigate).toHaveBeenCalledTimes(2);
    screen.getByRole('button', { name: 'tim' }).focus();
    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('tokens.css có lớp phủ .tubu-tile-link::after kín thẻ và vòng focus vẽ trên lớp phủ', () => {
    const css = readFileSync(resolve(__dirname, '../../css/tokens.css'), 'utf8');
    expect(css).toMatch(/\.tubu-tile-link::after\s*\{[^}]*top:\s*0;[^}]*right:\s*0;[^}]*bottom:\s*0;[^}]*left:\s*0;/);
    expect(css).toMatch(/\.tubu-tile-link:focus-visible::after\s*\{[^}]*outline:\s*2px solid var\(--color-border-focus\)/);
  });
});
