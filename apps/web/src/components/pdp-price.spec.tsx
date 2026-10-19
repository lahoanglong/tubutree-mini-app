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
      <PdpSelectionProvider initialId="v1">
        <PdpPrice product={PRODUCT} />
        <AddToCart slug="serum" variations={VARIATIONS} />
      </PdpSelectionProvider>,
    );
    await flush();
    expect(priceText(container)).toBe('460.000đ');
    expect(byText(container, 'button', /Thêm vào giỏ/)!.textContent).toContain('460.000đ');
    expect(container.querySelector('.line-through')).toBeNull();

    click(byText(container, 'button', /^30ml/));
    await flush();
    expect(priceText(container)).toBe('289.000đ');
    expect(byText(container, 'button', /Thêm vào giỏ/)!.textContent).toContain('289.000đ');
    expect(container.querySelector('.line-through')!.textContent).toBe('320.000đ');
    expect(container.querySelector('[data-testid="pdp-sale-badge"]')!.textContent).toBe('-10%');
    // Mini App không hiện huy hiệu % ở dòng giá của trang sản phẩm; chỉ máy tính giữ.
    expect(container.querySelector('[data-testid="pdp-sale-badge"]')!.className).toContain('max-md:hidden');
  });

  it('chưa chọn phân loại nào thì ghi "Từ" giá thấp nhất', async () => {
    const { container } = mount(<PdpPrice product={PRODUCT} />);
    await flush();
    expect(priceText(container)).toBe('Từ 289.000đ');
  });
});
