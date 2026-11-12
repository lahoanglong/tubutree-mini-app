// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PriceTab } from './price-tab';
import { byText, click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  push.mockReset();
  vi.unstubAllGlobals();
});

const ROW = { variationId: 'v1', sku: 'S1', product: 'Phân A', brand: 'Tubu', variation: '1kg', retailPrice: 100_000, dealerPrice: 80_000, discountPct: 20, stock: 9 };

async function placeWith(button: 'Trả trước' | 'Ghi công nợ', order: Record<string, unknown>) {
  const { fn } = mockFetch({
    '/dealer/pricelist': { body: [ROW] },
    '/dealer/templates': { body: [] },
    '/dealer/orders': { body: order },
  });
  vi.stubGlobal('fetch', fn);
  mounted = render(<PriceTab creditLimit={50_000_000} debt={0} />);
  await flush();
  click(mounted.container.querySelector('[aria-label^="Tăng số lượng"]'));
  await flush();
  click(byText(mounted.container, 'button', button));
  await flush();
  return mounted.container.textContent ?? '';
}

describe('PriceTab: đơn của lần đặt trước trả lại do cùng Idempotency-Key', () => {
  it('bấm Ghi công nợ mà đơn trả về còn chờ chuyển khoản: báo hình thức Trả trước và mở trang chuyển khoản', async () => {
    const text = await placeWith('Ghi công nợ', { code: 'TUBU6', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', items: [{ variationId: 'v1', quantity: 1, backorderedQty: 0 }] });
    expect(text).toMatch(/TUBU6 đã tạo ở lần trước theo hình thức Trả trước, cần chuyển khoản/);
    expect(text).not.toMatch(/Đã tạo đơn đại lý!/);
    expect(push).toHaveBeenCalledWith(expect.stringContaining('TUBU6'));
  });

  it('bấm Trả trước mà đơn trả về đã CONFIRMED: báo hình thức Ghi công nợ, không mở trang chuyển khoản', async () => {
    const text = await placeWith('Trả trước', { code: 'TUBU4', status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', items: [{ variationId: 'v1', quantity: 1, backorderedQty: 0 }] });
    expect(text).toMatch(/TUBU4 đã tạo ở lần trước theo hình thức Ghi công nợ, không cần chuyển khoản/);
    expect(push).not.toHaveBeenCalled();
  });

  it('đặt bình thường: báo thành công, Trả trước mở trang chuyển khoản', async () => {
    const text = await placeWith('Trả trước', { code: 'TUBU3', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', items: [{ variationId: 'v1', quantity: 1, backorderedQty: 0 }] });
    expect(text).toMatch(/Đã tạo đơn đại lý!/);
    expect(push).toHaveBeenCalledWith(expect.stringContaining('TUBU3'));
  });
});

describe('PriceTab: dòng phân loại của từng mặt hàng', () => {
  async function showRow(variation: string) {
    const { fn } = mockFetch({ '/dealer/pricelist': { body: [{ ...ROW, variation }] }, '/dealer/templates': { body: [] } });
    vi.stubGlobal('fetch', fn);
    mounted = render(<PriceTab creditLimit={50_000_000} debt={0} />);
    await flush();
    const c = mounted.container;
    const variationLines = Array.from(c.querySelectorAll('div')).filter((d) => d.className.includes('font-[700]'));
    return { text: c.textContent ?? '', variationLines, qtyLabel: c.querySelector('[aria-label^="Tăng số lượng"]')?.getAttribute('aria-label') ?? '' };
  }

  it('tên bình thường vẫn hiện ở dòng riêng và đi vào nhãn đọc của ô số lượng', async () => {
    const r = await showRow('1kg');
    expect(r.variationLines.map((d) => d.textContent)).toEqual(['1kg']);
    expect(r.qtyLabel).toContain('Phân A 1kg');
  });

  it('"[object Object]" dính sau tên thật bị gỡ khỏi cả dòng hiện lẫn nhãn đọc', async () => {
    const r = await showRow('Can 5L [object Object]');
    expect(r.variationLines.map((d) => d.textContent)).toEqual(['Can 5L']);
    expect(r.text).not.toContain('[object Object]');
    expect(r.qtyLabel).toContain('Phân A Can 5L');
    expect(r.qtyLabel).not.toContain('object');
  });

  it('chỉ còn "[object Object]" hoặc toàn khoảng trắng: không có dòng phân loại, nhãn đọc chỉ còn tên sản phẩm', async () => {
    for (const name of ['[object Object]', '   ']) {
      mounted?.unmount();
      const r = await showRow(name);
      expect(r.variationLines).toHaveLength(0);
      expect(r.text).not.toContain('[object Object]');
      expect(r.qtyLabel).toContain('Phân A');
      expect(r.qtyLabel).not.toContain('object');
    }
  });
});
