// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { checkoutEtaLabel } from '@tubutree/app-core/shipping-eta';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({
  phase: 'guest' as string,
  getCart: vi.fn(),
  flash: [] as unknown[],
  config: {} as Record<string, unknown>,
  guestFlag: { enabled: false, pending: false },
  guestLines: [] as unknown[],
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/shop-client')>()), getCart: mocks.getCart }));
vi.mock('@/lib/use-flash-sales', () => ({ useRunningFlash: () => ({ flash: mocks.flash, now: Date.now() }) }));
vi.mock('@/lib/use-flash-allowance', () => ({ useFlashAllowance: (f: unknown[]) => f }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => mocks.config }));
vi.mock('@/lib/guest-cart/flag', () => ({ useGuestCartFlag: () => mocks.guestFlag }));
vi.mock('@/lib/guest-cart/use-guest-cart', () => ({ useGuestCartLines: () => mocks.guestLines }));

import { PdpSelectionProvider, usePdpSelection } from '@/components/pdp-selection';
import { VariationChip } from '@/components/variation-chip';
import { guestProductKey } from '@/lib/guest-cart/products';
import type { ProductDetail } from '@/lib/api';
import { PdpShipDecision } from './pdp-ship-decision';
import { PdpUnitPrice } from './pdp-unit-price';

const ETA = { minDays: 2, maxDays: 4 };
const TUBU = { kind: 'TUBU' as const, name: 'Tubu Tree', shippingFee: null, freeShipFrom: null };
const variation = (id: string, name: string, price: number, stock = 5) => ({ id, sku: id, name, retailPrice: price, salePrice: null, stock });
const product = (over: Partial<ProductDetail> = {}): ProductDetail =>
  ({
    id: 'p1', slug: 'nuoc-giat', brand: 'Fuwa3e', name: 'Nước giặt hương Bạc hà', shortDesc: null, description: '', images: [], thumbnail: null,
    basePrice: 79_000, salePrice: null, certifications: [], fulfiller: TUBU,
    variations: [variation('a', '500ml', 79_000), variation('b', '3,5L', 375_000), variation('c', 'Refill 10L', 990_000)],
    ...over,
  }) as ProductDetail;
const cartLine = (variationId: string, total: number) => ({ id: `l-${variationId}`, variationId, quantity: 1, stock: 9, total, unitPrice: total, fulfiller: { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' } });
const STATIC = <p data-testid="pdp-freeship">Miễn phí giao hàng cho đơn từ 199.000đ</p>;

let mounted: Rendered[] = [];
function mount(ui: React.ReactElement, initialId = 'a', client?: QueryClient) {
  const r = render(<PdpSelectionProvider initialId={initialId}>{ui}</PdpSelectionProvider>, client);
  mounted.push(r);
  return r;
}
const text = (r: Rendered, id: string) => r.container.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;

beforeEach(() => {
  mocks.phase = 'guest';
  mocks.getCart.mockReset().mockResolvedValue({ items: [], itemCount: 0, freeship: false, freeshipThreshold: 199_000 });
  mocks.flash = [];
  mocks.config = { isLoaded: true, freeshipThreshold: 199_000, shippingEta: ETA };
  mocks.guestFlag = { enabled: false, pending: false };
  mocks.guestLines = [];
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
});

describe('PdpShipDecision (cờ shipping.pdp_eta_enabled)', () => {
  it('cờ tắt: vẽ đúng câu tĩnh cũ, không thêm dòng', async () => {
    const r = mount(<PdpShipDecision product={product()} freeship={STATIC} />);
    await flush();
    expect(text(r, 'pdp-freeship')).toBe('Miễn phí giao hàng cho đơn từ 199.000đ');
    expect(text(r, 'pdp-eta')).toBeNull();
    expect(text(r, 'pdp-freeship-gap')).toBeNull();
  });

  it('khách chưa đăng nhập: cùng khoảng ngày với thanh toán, số còn thiếu theo ngưỡng chung, không gọi giỏ', async () => {
    mocks.config.pdpEtaEnabled = true;
    const r = mount(<PdpShipDecision product={product()} freeship={STATIC} />);
    await flush();
    expect(text(r, 'pdp-eta')).toBe(`Nhận dự kiến ${checkoutEtaLabel(ETA, ['TUBU'])}`);
    expect(text(r, 'pdp-freeship-gap')).toBe('Món này + 120.000đ là miễn phí giao');
    expect(text(r, 'pdp-freeship')).toBeNull();
    expect(mocks.getCart).not.toHaveBeenCalled();
  });

  it('ngưỡng cấu hình 250.000đ thì chữ đổi theo; đổi số lượng thì tính lại', async () => {
    mocks.config = { ...mocks.config, pdpEtaEnabled: true, freeshipThreshold: 250_000 };
    let setQty: ((n: number) => void) | null = null;
    function Qty() {
      const s = usePdpSelection()!;
      setQty = (n) => s.setQuantity(n);
      return null;
    }
    const r = mount(
      <>
        <Qty />
        <PdpShipDecision product={product()} freeship={STATIC} />
      </>,
    );
    await flush();
    expect(text(r, 'pdp-freeship-gap')).toBe('Món này + 171.000đ là miễn phí giao');
    act(() => setQty!(4));
    expect(text(r, 'pdp-freeship-gap')).toBe('Thêm món này là đủ miễn phí giao');
  });

  it('khách có hạng ngưỡng thấp hơn (giỏ máy chủ trả): đủ thì không báo còn thiếu; giỏ đã đủ thì nói đơn được miễn phí giao', async () => {
    mocks.config.pdpEtaEnabled = true;
    mocks.phase = 'authenticated';
    mocks.getCart.mockResolvedValue({ items: [cartLine('x', 70_000)], itemCount: 1, freeship: false, freeshipThreshold: 149_000 });
    const r = mount(<PdpShipDecision product={product()} freeship={STATIC} />);
    await flush();
    expect(text(r, 'pdp-freeship-gap')).toBe('Thêm món này là đủ miễn phí giao');
    mocks.getCart.mockResolvedValue({ items: [cartLine('x', 210_000)], itemCount: 1, freeship: false, freeshipThreshold: 199_000 });
    const again = mount(<PdpShipDecision product={product()} freeship={STATIC} />);
    await flush();
    expect(text(again, 'pdp-freeship-gap')).toBe('Đơn này được miễn phí giao hàng');
  });

  it('giỏ khách của web: cộng món đã có giá trong bộ nhớ đệm; món chưa có giá thì giữ câu tĩnh, không gọi API', async () => {
    mocks.config.pdpEtaEnabled = true;
    mocks.guestFlag = { enabled: true, pending: false };
    mocks.guestLines = [{ variationId: 'o1', slug: 'khac', quantity: 2, addedAt: 1 }];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(guestProductKey('khac'), product({ slug: 'khac', variations: [variation('o1', '1kg', 30_000)] }));
    const r = mount(<PdpShipDecision product={product()} freeship={STATIC} />, 'a', client);
    await flush();
    expect(text(r, 'pdp-freeship-gap')).toBe('Món này + 60.000đ là miễn phí giao');

    mocks.guestLines = [{ variationId: 'o2', slug: 'chua-tai', quantity: 1, addedAt: 1 }];
    const cold = mount(<PdpShipDecision product={product()} freeship={STATIC} />);
    await flush();
    expect(text(cold, 'pdp-freeship-gap')).toBeNull();
    expect(text(cold, 'pdp-freeship')).toBe('Miễn phí giao hàng cho đơn từ 199.000đ');
  });

  it('hàng gian hàng tự giao: không hứa ngày, ngưỡng của gian hàng', async () => {
    mocks.config.pdpEtaEnabled = true;
    const merchant = product({ fulfiller: { kind: 'MERCHANT', name: 'Shop A', shippingFee: 20_000, freeShipFrom: 300_000 }, variations: [variation('a', '500ml', 79_000)] });
    const r = mount(<PdpShipDecision product={merchant} freeship={false} />);
    await flush();
    expect(text(r, 'pdp-eta')).toBeNull();
    expect(text(r, 'pdp-freeship-gap')).toBe('Món này + 221.000đ là miễn phí giao');
  });

  it('hết hàng hay gian hàng tạm nghỉ: không hứa ngày, câu tĩnh cũ', async () => {
    mocks.config.pdpEtaEnabled = true;
    const out = mount(<PdpShipDecision product={product({ variations: [variation('a', '500ml', 79_000, 0)] })} freeship={STATIC} />);
    const paused = mount(<PdpShipDecision product={product({ fulfiller: { kind: 'UNAVAILABLE', name: 'Shop A', shippingFee: null, freeShipFrom: null } })} freeship={STATIC} />);
    await flush();
    for (const r of [out, paused]) {
      expect(text(r, 'pdp-eta')).toBeNull();
      expect(text(r, 'pdp-freeship')).toBe('Miễn phí giao hàng cho đơn từ 199.000đ');
    }
  });

  it('HTML máy chủ: dòng ngày giữ chỗ (ẩn, cùng khuôn chữ để cùng bề ngang) để lúc vẽ ngày thật không đẩy phần dưới; chưa có câu còn thiếu', () => {
    mocks.config.pdpEtaEnabled = true;
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <PdpSelectionProvider initialId="a">
          <PdpShipDecision product={product()} initialConfig={{ shippingEta: ETA } as never} freeship={STATIC} />
        </PdpSelectionProvider>
      </QueryClientProvider>,
    );
    expect(html).toMatch(/data-testid="pdp-eta" aria-hidden="true" class="[^"]*invisible[^"]*">Nhận dự kiến 16\/01 – 18\/01</);
    expect(html).toContain('data-testid="pdp-freeship"');
    expect(html).toMatch(/<div class="[^"]*md:basis-full[^"]*"><p data-testid="pdp-freeship"/);
  });

  it('HTML máy chủ: phân loại chọn sẵn hết hàng thì không giữ chỗ dòng ngày (dòng thật cũng không có), dù phân loại khác còn hàng', () => {
    mocks.config.pdpEtaEnabled = true;
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <PdpSelectionProvider initialId="a">
          <PdpShipDecision
            product={product({ variations: [variation('a', '500ml', 79_000, 0), variation('b', '3,5L', 375_000)] })}
            initialConfig={{ shippingEta: ETA } as never}
            freeship={STATIC}
          />
        </PdpSelectionProvider>
      </QueryClientProvider>,
    );
    expect(html).not.toContain('pdp-eta');
  });

  it('HTML máy chủ, hàng gian hàng có ngưỡng: giữ sẵn một dòng ẩn cho câu còn thiếu; gian hàng không có ngưỡng thì không giữ', () => {
    mocks.config.pdpEtaEnabled = true;
    const ssr = (fulfiller: ProductDetail['fulfiller']) =>
      renderToString(
        <QueryClientProvider client={new QueryClient()}>
          <PdpSelectionProvider initialId="a">
            <PdpShipDecision product={product({ fulfiller, variations: [variation('a', '500ml', 79_000)] })} freeship={false} />
          </PdpSelectionProvider>
        </QueryClientProvider>,
      );
    const withRule = ssr({ kind: 'MERCHANT', name: 'Shop A', shippingFee: 20_000, freeShipFrom: 300_000 });
    expect(withRule).toMatch(/<p aria-hidden="true" class="[^"]*invisible[^"]*">/);
    expect(withRule).not.toContain('pdp-freeship-gap');
    const noRule = ssr({ kind: 'MERCHANT', name: 'Shop A', shippingFee: 20_000, freeShipFrom: null });
    expect(noRule).not.toContain('<p');
  });
});

describe('PdpUnitPrice và chip (cờ catalog.unit_price_enabled)', () => {
  it('cờ tắt: không có dòng', async () => {
    const r = mount(<PdpUnitPrice product={product()} />);
    await flush();
    expect(text(r, 'pdp-unit-price')).toBeNull();
  });

  it('cờ bật: dòng theo phân loại đang chọn; một phân loại không đọc được thì không có dòng', async () => {
    mocks.config.unitPriceEnabled = true;
    const r = mount(<PdpUnitPrice product={product()} />, 'b');
    const guess = mount(<PdpUnitPrice product={product({ variations: [variation('a', '500ml', 79_000), variation('b', 'Combo 2', 150_000)] })} />);
    await flush();
    expect(text(r, 'pdp-unit-price')).toBe('≈ 10.700đ / 100ml');
    expect(text(guess, 'pdp-unit-price')).toBeNull();
  });

  it('chip: dòng giá theo đơn vị, nhãn cùng dòng; chip hết hàng không có dòng', () => {
    const onClick = vi.fn();
    const r = mount(
      <>
        <VariationChip variation={{ name: '500ml', stock: 3 }} pricing={{ price: 79_000, isFlash: false }} active onClick={onClick} unit="≈ 15.800đ / 100ml" />
        <VariationChip variation={{ name: '10L', stock: 3 }} pricing={{ price: 990_000, isFlash: false }} active={false} onClick={onClick} unit="≈ 9.900đ / 100ml" better="Lợi hơn 37% mỗi 100ml" />
        <VariationChip variation={{ name: '3,5L', stock: 0 }} pricing={{ price: 375_000, isFlash: false }} active={false} onClick={onClick} unit="≈ 10.700đ / 100ml" />
      </>,
    );
    expect([...r.container.querySelectorAll('[data-testid="variation-unit-price"]')].map((n) => n.textContent)).toEqual([
      '≈ 15.800đ / 100ml',
      '≈ 9.900đ / 100ml · Lợi hơn 37% mỗi 100ml',
    ]);
    click(r.container.querySelectorAll('button')[1]!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
