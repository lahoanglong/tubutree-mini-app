// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, render, type Rendered } from '@/test-utils/dom';
import { VariationSheet, type VariationOption } from './variation-sheet';

const OVER_5 = 'Giá Giờ vàng tối đa 3 sản phẩm mỗi khách. Mua 5 thì cả dòng tính giá thường.';

const variations: VariationOption[] = [
  { id: 'v1', sku: 'S1', name: 'Gói 80 tờ', retailPrice: 35_000, salePrice: null, stock: 245 },
  { id: 'v2', sku: 'S2', name: 'Combo 3 gói', retailPrice: 90_000, salePrice: null, stock: 0 },
  { id: 'v3', sku: 'S3', name: 'Gói 40 tờ', retailPrice: 20_000, salePrice: null, stock: 8 },
];
const flash = (extra: Record<string, unknown> = {}) => [{ productSlug: 'khan-uot', variationId: 'v1', flashPrice: 26_000, perUserLimit: 3, ...extra }];

type Props = Parameters<typeof VariationSheet>[0];
let mounted: Rendered[] = [];
const baseProps = (over: Partial<Props> = {}): Props => ({
  open: true, onClose: () => undefined, mode: 'buy', productName: 'Khăn ướt', thumbnail: null, variations, flash: flash(),
  initialId: 'v1', initialQty: 3, cartLines: undefined, onConfirm: () => undefined, ...over,
});
function mountSheet(over: Partial<Props> = {}) {
  const r = render(<VariationSheet {...baseProps(over)} />);
  mounted.push(r);
  return r;
}
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement;
const buy = () => byText(dialog(), 'button', /^(Mua ngay|Thêm vào giỏ|Tạm hết hàng)/) as HTMLButtonElement;
const plus = () => dialog().querySelector('button[aria-label="Tăng số lượng"]');
const minus = () => dialog().querySelector('button[aria-label="Giảm số lượng"]');
const status = () => dialog().querySelector('[role="status"]');

describe('VariationSheet web: giá Giờ vàng và tiền dòng theo luật máy chủ', () => {
  it('phân loại đang Giờ vàng: nhãn "Giờ vàng", giới hạn "Tối đa 3/khách" có câu đọc riêng, giá màu deal', () => {
    mountSheet();
    const info = dialog().querySelector('[data-testid="variation-sheet-flash"]')!;
    expect(info.textContent).toContain('Giờ vàng');
    expect(byText(info as HTMLElement, '[aria-hidden="true"]', 'Tối đa 3/khách')).toBeTruthy();
    expect(info.textContent).toContain('Tối đa 3 sản phẩm mỗi khách');
    const price = Array.from(dialog().querySelectorAll<HTMLElement>('[data-testid="variation-sheet-price"] span')).find((x) => x.textContent === '26.000đ')!;
    expect(price.getAttribute('style')).toContain('--color-text-price-deal');
  });

  it('qty = limit: nút ghi 3 × giá Giờ vàng, chưa có ghi chú; limit + 1 và 5: cả dòng giá thường và có câu ghi chú', () => {
    mountSheet({ initialQty: 3 });
    expect(buy().textContent).toBe('Mua ngay · 78.000đ');
    expect(status()!.textContent).toBe('');
    click(plus());
    expect(buy().textContent).toBe('Mua ngay · 140.000đ');
    click(plus());
    expect(buy().textContent).toBe('Mua ngay · 175.000đ');
    expect(status()!.textContent).toBe(OVER_5);
    click(minus());
    click(minus());
    expect(buy().textContent).toBe('Mua ngay · 78.000đ');
    expect(status()!.textContent).toBe('');
  });

  it('ghi chú có chỗ giữ cố định: vùng thông báo có sẵn khi chưa vượt', () => {
    mountSheet({ initialQty: 1 });
    expect((status() as HTMLElement).style.minHeight).not.toBe('');
    expect(status()!.children).toHaveLength(0);
  });

  it('Thêm vào giỏ cũng ghi tổng đúng: mode add, qty 5', () => {
    mountSheet({ mode: 'add', initialQty: 5 });
    expect(buy().textContent).toBe('Thêm vào giỏ · 175.000đ');
  });

  it('bấm nút xác nhận gửi đúng phân loại và số lượng khách chọn (không kẹp theo giới hạn)', () => {
    const onConfirm = vi.fn();
    mountSheet({ initialQty: 5, onConfirm });
    click(buy());
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1' }), 5);
  });

  it('API cũ không gửi giới hạn: giá Giờ vàng mọi số lượng, không ghi chú lẫn dòng giới hạn', () => {
    mountSheet({ flash: flash({ perUserLimit: undefined }), initialQty: 5 });
    expect(buy().textContent).toBe('Mua ngay · 130.000đ');
    expect(status()).toBeNull();
    expect(dialog().textContent).not.toContain('Tối đa');
  });

  it('đợt gần hết suất (còn 2 suất, giới hạn khách 5): qty 3 ghi cả dòng giá thường 105.000đ và câu nói số suất còn, nhãn giới hạn vẫn là "Tối đa 5/khách"', () => {
    mountSheet({ flash: flash({ quota: 10, soldCount: 8, perUserLimit: 5 }), initialQty: 2 });
    expect(buy().textContent).toBe('Mua ngay · 52.000đ');
    expect(status()!.textContent).toBe('');
    click(plus());
    expect(buy().textContent).toBe('Mua ngay · 105.000đ');
    expect(status()!.textContent).toBe('Giờ vàng còn 2 suất. Mua 3 thì cả dòng tính giá thường.');
    expect(dialog().querySelector('[data-testid="variation-sheet-flash"]')!.textContent).toContain('Tối đa 5/khách');
  });

  it('hết giờ khi khách đang mở bảng (flash rỗng): giá thường, không nhãn Giờ vàng, không ghi chú', () => {
    const r = mountSheet({ initialQty: 5 });
    expect(status()!.textContent).toBe(OVER_5);
    act(() => r.root.render(<VariationSheet {...baseProps({ flash: [], initialQty: 5 })} />));
    expect(buy().textContent).toBe('Mua ngay · 175.000đ');
    expect(dialog().querySelector('[data-testid="variation-sheet-flash"]')).toBeNull();
    expect(status()).toBeNull();
  });

  it('chọn phân loại không phải Giờ vàng thì nhãn và ghi chú biến mất', () => {
    mountSheet({ initialQty: 5 });
    click(byText(dialog(), 'button', /Gói 40 tờ/));
    expect(dialog().querySelector('[data-testid="variation-sheet-flash"]')).toBeNull();
    expect(buy().textContent).toBe('Mua ngay · 100.000đ');
  });
});

describe('VariationSheet web: giỏ đã có sẵn cùng phân loại (thêm giỏ cộng dồn, máy chủ giá cả dòng)', () => {
  const inCart2 = [{ variationId: 'v1', quantity: 2 }];
  const IN_CART_NOTE = 'Giỏ đã có 2. Thêm 2 thì cả 4 sản phẩm tính giá thường.';

  it('ví dụ reviewer (giới hạn 3, giỏ có 2, chọn 2): Mua ngay ghi cả dòng 140.000đ, Thêm vào giỏ ghi phần giỏ tăng 88.000đ, ghi chú nói theo giỏ', () => {
    const r = mountSheet({ mode: 'buy', initialQty: 2, cartLines: inCart2 });
    expect(buy().textContent).toBe('Mua ngay · 140.000đ');
    expect(status()!.textContent).toBe(IN_CART_NOTE);
    r.unmount();
    mounted = [];
    mountSheet({ mode: 'add', initialQty: 2, cartLines: inCart2 });
    expect(buy().textContent).toBe('Thêm vào giỏ · 88.000đ');
    expect(status()!.textContent).toBe(IN_CART_NOTE);
  });

  it('giảm về qty 1 (tổng 3 = limit): Mua ngay 3 × giá Giờ vàng, hết mất giá nên chỉ còn câu "Mua ngay thanh toán cả dòng" (không có ở bảng Thêm vào giỏ)', () => {
    const r = mountSheet({ mode: 'buy', initialQty: 2, cartLines: inCart2 });
    click(minus());
    expect(buy().textContent).toBe('Mua ngay · 78.000đ');
    expect(status()!.textContent).toBe('Giỏ đã có 2: Mua ngay thanh toán cả 3 sản phẩm.');
    r.unmount();
    mounted = [];
    mountSheet({ mode: 'add', initialQty: 2, cartLines: inCart2 });
    click(minus());
    expect(buy().textContent).toBe('Thêm vào giỏ · 26.000đ');
    expect(status()!.textContent).toBe('');
  });

  it('giỏ đã vượt suất từ trước (5 > 3): câu nói dòng giỏ đang tính giá thường, không đổ cho phần thêm; Thêm vào giỏ ghi 1 × giá thường', () => {
    const r = mountSheet({ mode: 'add', initialQty: 1, cartLines: [{ variationId: 'v1', quantity: 5 }] });
    expect(buy().textContent).toBe('Thêm vào giỏ · 35.000đ');
    expect(status()!.textContent).toBe('Giỏ đã có 5, quá 3 suất Giờ vàng nên cả dòng đang tính giá thường.');
    r.unmount();
    mounted = [];
    mountSheet({ mode: 'buy', initialQty: 1, cartLines: [{ variationId: 'v1', quantity: 5 }] });
    expect(buy().textContent).toBe('Mua ngay · 210.000đ');
  });

  it('sản phẩm không Giờ vàng, giỏ có 2 chọn 1: Mua ngay ghi cả 3 và có câu giải thích, vùng ghi chú giữ chỗ từ lúc mở; Thêm vào giỏ không có vùng', () => {
    const r = mountSheet({ mode: 'buy', initialQty: 1, flash: [], cartLines: inCart2 });
    expect(buy().textContent).toBe('Mua ngay · 105.000đ');
    expect(status()!.textContent).toBe('Giỏ đã có 2: Mua ngay thanh toán cả 3 sản phẩm.');
    expect((status() as HTMLElement).style.minHeight).not.toBe('');
    r.unmount();
    mounted = [];
    mountSheet({ mode: 'add', initialQty: 1, flash: [], cartLines: inCart2 });
    expect(buy().textContent).toBe('Thêm vào giỏ · 35.000đ');
    expect(status()).toBeNull();
  });

  it('giỏ chỉ có phân loại khác (hoặc không truyền cartLines): số như khi giỏ rỗng', () => {
    const r = mountSheet({ mode: 'buy', initialQty: 2, cartLines: [{ variationId: 'v3', quantity: 9 }] });
    expect(buy().textContent).toBe('Mua ngay · 52.000đ');
    r.unmount();
    mounted = [];
    mountSheet({ mode: 'buy', initialQty: 2 });
    expect(buy().textContent).toBe('Mua ngay · 52.000đ');
  });

  it('vùng ghi chú vẫn có chỗ giữ cố định khi giỏ có sẵn (ô Số lượng không nhảy)', () => {
    mountSheet({ mode: 'buy', initialQty: 1, cartLines: inCart2 });
    expect((status() as HTMLElement).style.minHeight).not.toBe('');
  });
});

describe('VariationSheet web: hết hàng ghi "Tạm hết hàng" nhất quán', () => {
  it('chip hết hàng có chữ "Tạm hết hàng", chip còn hàng có giá và dấu Giờ vàng', () => {
    mountSheet();
    const out = byText(dialog(), 'button', /Combo 3 gói/) as HTMLButtonElement;
    expect(out.disabled).toBe(true);
    expect(out.textContent).toContain('Tạm hết hàng');
    const flashChip = byText(dialog(), 'button', /Gói 80 tờ/)!;
    expect(flashChip.textContent).toContain('26.000đ');
    expect(flashChip.textContent).toContain('Giờ vàng');
    expect(flashChip.querySelector('svg')).not.toBeNull();
    expect(byText(dialog(), 'button', /Gói 40 tờ/)!.textContent).toContain('20.000đ');
  });

  it('chip hai dòng ở điện thoại: tên theo body-sm (dòng 22px) và giá theo caption (13px, dòng 20px) như chip Mini, để hai app cùng cao', () => {
    mountSheet();
    const chip = byText(dialog(), 'button', /Gói 40 tờ/) as HTMLElement;
    const [name, , price] = Array.from(chip.children) as HTMLElement[];
    expect(name!.className).toContain('max-md:leading-[var(--type-body-sm-lh)]');
    expect(price!.className).toContain('max-md:text-[length:var(--type-caption-size)]');
    expect(price!.className).toContain('max-md:leading-[var(--type-caption-lh)]');
  });

  it('chú thích dưới giá và nút khi phân loại đang chọn hết hàng đều ghi "Tạm hết hàng"', () => {
    const allOut: VariationOption[] = [
      { id: 'v1', sku: 'S1', name: 'Gói 80 tờ', retailPrice: 35_000, salePrice: null, stock: 0 },
      { id: 'v2', sku: 'S2', name: 'Gói 40 tờ', retailPrice: 20_000, salePrice: null, stock: 0 },
    ];
    mountSheet({ variations: allOut, flash: [], initialId: null, initialQty: 1 });
    expect(dialog().textContent).toContain('Gói 40 tờ · Tạm hết hàng');
    const btn = byText(dialog(), 'button', /^Tạm hết hàng$/) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
