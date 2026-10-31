// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// R6-BUYER-2: giá lớn đầu trang phải theo phân loại đang chọn, cùng số với nút "Thêm vào giỏ".

const mocks = vi.hoisted(() => ({ getProductStock: vi.fn(), getActiveFlashSales: vi.fn() }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ status: 'idle', initialized: true, user: null }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getProductStock: mocks.getProductStock,
  getActiveFlashSales: mocks.getActiveFlashSales,
}));

import AddToCart from './add-to-cart';
import { PdpPrice } from './flash-price';
import { PdpSelectionProvider } from './pdp-selection';
import { resetFlashSales } from '@/lib/use-flash-sales';

const VARIATIONS = [
  { id: 'v1', name: '50ml', retailPrice: 460000, salePrice: null, stock: 5 },
  { id: 'v2', name: '30ml', retailPrice: 320000, salePrice: 289000, stock: 9 },
];
const PRODUCT = { slug: 'serum', basePrice: 320000, salePrice: 289000, variations: VARIATIONS };

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
const priceText = (c: HTMLElement) => c.querySelector('[data-testid="pdp-price"]')!.textContent;

beforeEach(() => {
  resetFlashSales();
  mocks.getProductStock.mockReset().mockResolvedValue({ v1: 5, v2: 9 });
  mocks.getActiveFlashSales.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('PdpPrice theo phân loại đang chọn', () => {
  it('đổi phân loại thì giá lớn, giá gạch và nhãn giảm đổi theo, khớp nút Thêm vào giỏ', async () => {
    const { container } = mount(
      <PdpSelectionProvider initialId="v2">
        <PdpPrice product={PRODUCT} />
        <AddToCart slug="serum" variations={VARIATIONS} />
      </PdpSelectionProvider>,
    );
    await flush();
    expect(priceText(container)).toBe('289.000đ');
    expect(byText(container, 'button', /Thêm vào giỏ/)!.textContent).toContain('289.000đ');
    expect(container.querySelector('.line-through')!.textContent).toBe('320.000đ');
    expect(container.querySelector('[data-testid="pdp-sale-badge"]')!.textContent).toBe('-10%');
    // §4 Q2 (như Mini App): giá giảm màu giá deal, nhãn % tông khuyến mãi; không đỏ.
    expect(container.querySelector('[data-testid="pdp-price"]')!.className).toContain('text-[color:var(--color-text-price-deal)]');
    const badge = container.querySelector('[data-testid="pdp-sale-badge"] span') as HTMLElement;
    expect(badge.style.background).toContain('--color-promo-bg');
    expect(container.innerHTML).not.toMatch(/danger-/);

    click(byText(container, 'button', /^50ml/));
    await flush();
    expect(priceText(container)).toBe('460.000đ');
    expect(byText(container, 'button', /Thêm vào giỏ/)!.textContent).toContain('460.000đ');
    expect(container.querySelector('.line-through')).toBeNull();
    // Giá thường (không giảm): chữ đen, không nhãn.
    expect(container.querySelector('[data-testid="pdp-price"]')!.className).toContain('text-stone-900');
    expect(container.querySelector('[data-testid="pdp-sale-badge"]')).toBeNull();
  });

  it('chưa chọn phân loại nào thì ghi "Từ" giá thấp nhất', async () => {
    const { container } = mount(<PdpPrice product={PRODUCT} />);
    await flush();
    expect(priceText(container)).toBe('Từ 289.000đ');
  });
});

describe('PdpPrice khi danh sách Giờ vàng ở máy đã cũ', () => {
  it('suất đã quá hạn thì giá lớn về giá thường, không nhãn Giờ vàng', async () => {
    mocks.getActiveFlashSales.mockResolvedValue([
      { itemId: 'f1', variationId: 'v2', productSlug: 'serum', flashPrice: 200000, retailPrice: 320000, salePrice: 289000, soldCount: 1, quota: 10, endAt: '2020-01-01T00:00:00.000Z' },
    ]);
    const { container } = mount(
      <PdpSelectionProvider initialId="v2">
        <PdpPrice product={PRODUCT} />
      </PdpSelectionProvider>,
    );
    await flush();
    expect(priceText(container)).toBe('289.000đ');
    expect(container.querySelector('[data-testid="pdp-flash-badge"]')).toBeNull();
  });
});

describe('PdpPrice khi đang Giờ vàng', () => {
  it('giá deal nằm ở thanh Giờ vàng dưới ảnh nên giá lớn đầu trang không hiện lần hai', async () => {
    mocks.getActiveFlashSales.mockResolvedValue([
      { itemId: 'f1', variationId: 'v2', productSlug: 'serum', flashPrice: 200000, retailPrice: 320000, salePrice: 289000, soldCount: 1, quota: 10, endAt: '2099-01-01T00:00:00.000Z' },
    ]);
    const { container } = mount(
      <PdpSelectionProvider initialId="v2">
        <PdpPrice product={PRODUCT} />
      </PdpSelectionProvider>,
    );
    await flush();
    expect(container.querySelector('[data-testid="pdp-price"]')).toBeNull();
    expect(container.querySelector('[data-testid="pdp-flash-badge"]')).toBeNull();
  });
});
