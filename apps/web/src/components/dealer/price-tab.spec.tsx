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

describe('PriceTab: lọc thương hiệu, còn hàng, tải CSV và chép báo giá', () => {
  const ROWS = [
    { ...ROW, variationId: 'v1', sku: 'S1', product: 'Nước rửa chén', brand: 'Tubu', stock: 9 },
    { ...ROW, variationId: 'v2', sku: 'S2', product: 'Nước giặt', brand: 'Fuwa', stock: 0 },
    { ...ROW, variationId: 'v3', sku: 'S3', product: '=HYPERLINK("x")', brand: 'fuwa', stock: 3 },
  ];
  const names = () => Array.from(mounted!.container.querySelectorAll('li .line-clamp-2')).map((d) => d.textContent);
  const chip = (label: string) => byText(mounted!.container, 'button[aria-pressed]', label);

  async function show() {
    const { fn } = mockFetch({ '/dealer/pricelist': { body: ROWS }, '/dealer/templates': { body: [] } });
    vi.stubGlobal('fetch', fn);
    mounted = render(<PriceTab creditLimit={50_000_000} debt={0} />);
    await flush();
  }

  it('chip thương hiệu gộp hoa/thường, lọc đúng dòng; "Còn hàng sẵn" bỏ dòng hết hàng; chạm lại thì bỏ lọc', async () => {
    await show();
    expect(names()).toHaveLength(3);
    expect(mounted!.container.textContent).toContain('3 mặt hàng');
    click(chip('Fuwa'));
    await flush();
    expect(names()).toEqual(['Nước giặt', '=HYPERLINK("x")']);
    expect(chip('Fuwa')?.getAttribute('aria-pressed')).toBe('true');
    click(chip('Còn hàng sẵn'));
    await flush();
    expect(names()).toEqual(['=HYPERLINK("x")']);
    click(chip('Fuwa'));
    await flush();
    expect(names()).toEqual(['Nước rửa chén', '=HYPERLINK("x")']);
    expect(chip('Mọi thương hiệu')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('một thương hiệu thì không vẽ chip thương hiệu, vẫn có chip còn hàng', async () => {
    const { fn } = mockFetch({ '/dealer/pricelist': { body: [ROW] }, '/dealer/templates': { body: [] } });
    vi.stubGlobal('fetch', fn);
    mounted = render(<PriceTab creditLimit={50_000_000} debt={0} />);
    await flush();
    expect(chip('Còn hàng sẵn')).not.toBeNull();
    expect(chip('Mọi thương hiệu')).toBeNull();
  });

  it('lọc hết dòng: báo không tìm thấy, ẩn dòng Tải CSV / Chép báo giá', async () => {
    const { fn } = mockFetch({ '/dealer/pricelist': { body: [ROWS[1]] }, '/dealer/templates': { body: [] } });
    vi.stubGlobal('fetch', fn);
    mounted = render(<PriceTab creditLimit={50_000_000} debt={0} />);
    await flush();
    const text = () => mounted!.container.textContent ?? '';
    expect(text()).toContain('Tải CSV');
    click(chip('Còn hàng sẵn'));
    await flush();
    expect(text()).toContain('Không tìm thấy sản phẩm');
    expect(text()).not.toContain('Tải CSV');
    expect(text()).not.toContain('Chép báo giá');
  });

  it('Tải CSV: tệp theo ngày, chỉ các dòng đang lọc, ô bắt đầu bằng "=" được chặn công thức', async () => {
    const blobs: Blob[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:csv';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toMatch(/^bang-gia-dai-ly-tubu-\d{4}-\d{2}-\d{2}\.csv$/);
    });
    try {
      await show();
      click(chip('Fuwa'));
      await flush();
      click(byText(mounted!.container, 'button', 'Tải CSV'));
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(blobs).toHaveLength(1);
      const csv = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.readAsText(blobs[0]!);
      });
      const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain('"SKU"');
      expect(lines[1]).toContain('"Nước giặt"');
      expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`);
      expect(csv).not.toContain('Nước rửa chén');
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });

  it('Chép báo giá: chép đúng các dòng đang lọc và báo số mặt hàng; chép hỏng thì báo lỗi, gợi ý tải CSV', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      await show();
      click(chip('Tubu'));
      await flush();
      click(byText(mounted!.container, 'button', 'Chép báo giá'));
      await flush();
      expect(writeText).toHaveBeenCalledTimes(1);
      const quote = writeText.mock.calls[0]![0] as string;
      expect(quote).toMatch(/^Báo giá đại lý Tubu Tree \(\d{2}\/\d{2}\/\d{4}\)\n- Nước rửa chén · 1kg \(S1\): 80\.000/);
      expect(quote).not.toContain('Nước giặt');
      expect(mounted!.container.textContent).toContain('Đã chép báo giá 1 mặt hàng');
      writeText.mockRejectedValueOnce(new Error('bị chặn'));
      document.execCommand = vi.fn(() => false);
      click(byText(mounted!.container, 'button', 'Chép báo giá'));
      await flush();
      expect(mounted!.container.querySelector('[role="alert"]')?.textContent).toBe('Chưa chép được báo giá, hãy thử lại hoặc tải file CSV.');
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
});
