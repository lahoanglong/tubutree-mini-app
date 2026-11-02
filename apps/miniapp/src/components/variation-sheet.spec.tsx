import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { VariationSheet, type VariationOption } from './variation-sheet';

const OVER_5 = 'Giá Giờ vàng tối đa 3 sản phẩm mỗi khách. Mua 5 thì cả dòng tính giá thường.';

const variations: VariationOption[] = [
  { id: 'v1', sku: 'S1', name: 'Gói 80 tờ', retailPrice: 35_000, salePrice: null, stock: 245 },
  { id: 'v2', sku: 'S2', name: 'Combo 3 gói', retailPrice: 90_000, salePrice: null, stock: 0 },
  { id: 'v3', sku: 'S3', name: 'Gói 40 tờ', retailPrice: 20_000, salePrice: null, stock: 8 },
];
const flash = (extra: Record<string, unknown> = {}) => [{ productSlug: 'khan-uot', variationId: 'v1', flashPrice: 26_000, perUserLimit: 3, ...extra }];

type SheetProps = { flash?: ReturnType<typeof flash>; initialQty?: number; mode?: 'add' | 'buy'; cartLines?: { variationId: string; quantity: number }[]; cartMayArrive?: boolean; variations?: VariationOption[]; open?: boolean };
function sheetElement(props: SheetProps, onConfirm: () => void = () => undefined) {
  return (
    <VariationSheet
      open={props.open ?? true}
      onClose={() => undefined}
      mode={props.mode ?? 'buy'}
      productName="Khăn ướt"
      thumbnail={null}
      variations={props.variations ?? variations}
      flash={props.flash ?? flash()}
      initialId="v1"
      initialQty={props.initialQty ?? 3}
      busy={false}
      cartLines={props.cartLines}
      cartMayArrive={props.cartMayArrive}
      onConfirm={onConfirm}
    />
  );
}
function renderSheet(props: SheetProps = {}) {
  const onConfirm = vi.fn();
  const view = render(sheetElement(props, onConfirm));
  return { ...view, onConfirm };
}

const buyButton = () => screen.getByRole('button', { name: /^(Mua ngay|Thêm vào giỏ|Tạm hết hàng)/ });
const plus = () => screen.getByRole('button', { name: 'Tăng số lượng' });
const minus = () => screen.getByRole('button', { name: 'Giảm số lượng' });

describe('VariationSheet: giá Giờ vàng và tiền dòng theo luật máy chủ', () => {
  it('phân loại đang Giờ vàng: nhãn "Giờ vàng", giới hạn "Tối đa 3/khách" có câu đọc riêng, giá màu deal', () => {
    renderSheet();
    const info = screen.getByTestId('variation-sheet-flash');
    expect(within(info).getByText('Giờ vàng')).toBeInTheDocument();
    expect(within(info).getByText('Tối đa 3/khách')).toHaveAttribute('aria-hidden', 'true');
    expect(within(info).getByText('Tối đa 3 sản phẩm mỗi khách')).toBeInTheDocument();
    const price = screen.getByTestId('variation-sheet-price').querySelector('span[style*="--color-text-price-deal"]');
    expect(price).toHaveTextContent('26.000đ');
  });

  it('qty = limit: nút ghi 3 × giá Giờ vàng, chưa có ghi chú; limit + 1 và 5: cả dòng giá thường và có câu ghi chú', () => {
    renderSheet({ initialQty: 3 });
    expect(buyButton()).toHaveTextContent('Mua ngay · 78.000đ');
    expect(screen.getByRole('status')).toHaveTextContent('');
    fireEvent.click(plus());
    expect(buyButton()).toHaveTextContent('Mua ngay · 140.000đ');
    fireEvent.click(plus());
    expect(buyButton()).toHaveTextContent('Mua ngay · 175.000đ');
    expect(screen.getByRole('status')).toHaveTextContent(OVER_5);
    fireEvent.click(minus());
    fireEvent.click(minus());
    expect(buyButton()).toHaveTextContent('Mua ngay · 78.000đ');
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('ghi chú có chỗ giữ cố định: vùng thông báo có sẵn trong DOM khi chưa vượt (ô Số lượng không nhảy khi chữ hiện)', () => {
    renderSheet({ initialQty: 1 });
    const note = screen.getByRole('status');
    expect(note).toBeEmptyDOMElement();
    expect(note.style.minHeight).not.toBe('');
  });

  it('Thêm vào giỏ cũng ghi tổng đúng: mode add, qty 5', () => {
    renderSheet({ mode: 'add', initialQty: 5 });
    expect(buyButton()).toHaveTextContent('Thêm vào giỏ · 175.000đ');
  });

  it('bấm nút xác nhận gửi đúng phân loại và số lượng khách chọn (không kẹp theo giới hạn)', () => {
    const { onConfirm } = renderSheet({ initialQty: 5 });
    fireEvent.click(buyButton());
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1' }), 5);
  });

  it('API cũ không gửi giới hạn: giá Giờ vàng mọi số lượng, không có ghi chú lẫn dòng giới hạn', () => {
    renderSheet({ flash: flash({ perUserLimit: undefined }), initialQty: 5 });
    expect(buyButton()).toHaveTextContent('Mua ngay · 130.000đ');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.queryByText(/Tối đa/)).toBeNull();
  });

  it('đợt gần hết suất (còn 2 suất, giới hạn khách 5): qty 3 ghi cả dòng giá thường 105.000đ và câu nói số suất còn, nhãn giới hạn vẫn là "Tối đa 5/khách"', () => {
    renderSheet({ flash: flash({ quota: 10, soldCount: 8, perUserLimit: 5 }), initialQty: 2 });
    expect(buyButton()).toHaveTextContent('Mua ngay · 52.000đ');
    expect(screen.getByRole('status')).toHaveTextContent('');
    fireEvent.click(plus());
    expect(buyButton()).toHaveTextContent('Mua ngay · 105.000đ');
    expect(screen.getByRole('status')).toHaveTextContent('Giờ vàng còn 2 suất. Mua 3 thì cả dòng tính giá thường.');
    expect(screen.getByTestId('variation-sheet-flash')).toHaveTextContent('Tối đa 5/khách');
  });

  it('hết giờ khi khách đang mở bảng (flash rỗng): giá thường, không nhãn Giờ vàng, không ghi chú', () => {
    const { rerender } = renderSheet({ initialQty: 5 });
    expect(screen.getByRole('status')).toHaveTextContent(OVER_5);
    rerender(
      <VariationSheet open onClose={() => undefined} mode="buy" productName="Khăn ướt" thumbnail={null} variations={variations} flash={[]} initialId="v1" initialQty={5} busy={false} cartLines={undefined} onConfirm={() => undefined} />,
    );
    expect(buyButton()).toHaveTextContent('Mua ngay · 175.000đ');
    expect(screen.queryByTestId('variation-sheet-flash')).toBeNull();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('chọn phân loại không phải Giờ vàng thì nhãn và ghi chú biến mất', () => {
    renderSheet({ initialQty: 5 });
    fireEvent.click(screen.getByRole('button', { name: /Gói 40 tờ/ }));
    expect(screen.queryByTestId('variation-sheet-flash')).toBeNull();
    expect(buyButton()).toHaveTextContent('Mua ngay · 100.000đ');
  });
});

describe('VariationSheet: giỏ đã có sẵn cùng phân loại (thêm giỏ cộng dồn, máy chủ giá cả dòng)', () => {
  const inCart2 = [{ variationId: 'v1', quantity: 2 }];
  const IN_CART_NOTE = 'Giỏ đã có 2. Thêm 2 thì cả 4 sản phẩm tính giá thường.';

  it('ví dụ reviewer (giới hạn 3, giỏ có 2, chọn 2): Mua ngay ghi cả dòng 140.000đ, Thêm vào giỏ ghi phần giỏ tăng 88.000đ, ghi chú nói theo giỏ', () => {
    const buy = renderSheet({ mode: 'buy', initialQty: 2, cartLines: inCart2 });
    expect(buyButton()).toHaveTextContent('Mua ngay · 140.000đ');
    expect(screen.getByRole('status')).toHaveTextContent(IN_CART_NOTE);
    buy.unmount();
    renderSheet({ mode: 'add', initialQty: 2, cartLines: inCart2 });
    expect(buyButton()).toHaveTextContent('Thêm vào giỏ · 88.000đ');
    expect(screen.getByRole('status')).toHaveTextContent(IN_CART_NOTE);
  });

  it('giảm về qty 1 (tổng 3 = limit): Mua ngay 3 × giá Giờ vàng, hết mất giá nên chỉ còn câu "Mua ngay thanh toán cả dòng" (không có ở bảng Thêm vào giỏ)', () => {
    const buy = renderSheet({ mode: 'buy', initialQty: 2, cartLines: inCart2 });
    fireEvent.click(minus());
    expect(buyButton()).toHaveTextContent('Mua ngay · 78.000đ');
    expect(screen.getByRole('status')).toHaveTextContent('Giỏ đã có 2: Mua ngay thanh toán cả 3 sản phẩm.');
    buy.unmount();
    renderSheet({ mode: 'add', initialQty: 2, cartLines: inCart2 });
    fireEvent.click(minus());
    expect(buyButton()).toHaveTextContent('Thêm vào giỏ · 26.000đ');
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('giỏ đã vượt suất từ trước (5 > 3): câu nói dòng giỏ đang tính giá thường, không đổ cho phần thêm; Thêm vào giỏ ghi 1 × giá thường', () => {
    const add = renderSheet({ mode: 'add', initialQty: 1, cartLines: [{ variationId: 'v1', quantity: 5 }] });
    expect(buyButton()).toHaveTextContent('Thêm vào giỏ · 35.000đ');
    expect(screen.getByRole('status')).toHaveTextContent('Giỏ đã có 5, quá 3 suất Giờ vàng nên cả dòng đang tính giá thường.');
    add.unmount();
    renderSheet({ mode: 'buy', initialQty: 1, cartLines: [{ variationId: 'v1', quantity: 5 }] });
    expect(buyButton()).toHaveTextContent('Mua ngay · 210.000đ');
  });

  it('sản phẩm không Giờ vàng, giỏ có 2 chọn 1: Mua ngay ghi cả 3 và có câu giải thích, vùng ghi chú giữ chỗ từ lúc mở; Thêm vào giỏ không có vùng', () => {
    const buy = renderSheet({ mode: 'buy', initialQty: 1, flash: [], cartLines: inCart2 });
    expect(buyButton()).toHaveTextContent('Mua ngay · 105.000đ');
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('Giỏ đã có 2: Mua ngay thanh toán cả 3 sản phẩm.');
    expect(region.style.minHeight).not.toBe('');
    buy.unmount();
    renderSheet({ mode: 'add', initialQty: 1, flash: [], cartLines: inCart2 });
    expect(buyButton()).toHaveTextContent('Thêm vào giỏ · 35.000đ');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('giỏ chỉ có phân loại khác (hoặc không truyền cartLines): số như khi giỏ rỗng', () => {
    const other = renderSheet({ mode: 'buy', initialQty: 2, cartLines: [{ variationId: 'v3', quantity: 9 }] });
    expect(buyButton()).toHaveTextContent('Mua ngay · 52.000đ');
    other.unmount();
    renderSheet({ mode: 'buy', initialQty: 2 });
    expect(buyButton()).toHaveTextContent('Mua ngay · 52.000đ');
  });

  it('Mua ngay mở trước khi GET /cart về (khách đã đăng nhập, giỏ chưa tới): vùng ghi chú đã có chỗ từ lúc mở, giỏ về sau chỉ điền chữ, bảng không cao thêm', () => {
    const view = renderSheet({ mode: 'buy', initialQty: 1, flash: [], cartLines: undefined });
    const region = screen.getByRole('status');
    expect(region.style.minHeight).not.toBe('');
    expect(region).toBeEmptyDOMElement();
    view.rerender(
      <VariationSheet open onClose={() => undefined} mode="buy" productName="Khăn ướt" thumbnail={null} variations={variations} flash={[]} initialId="v1" initialQty={1} busy={false} cartLines={inCart2} onConfirm={vi.fn()} />,
    );
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('Giỏ đã có 2: Mua ngay thanh toán cả 3 sản phẩm.');
  });

  it('Mua ngay giỏ về rỗng: vùng giữ chỗ vẫn còn (không co lại dưới ngón tay)', () => {
    renderSheet({ mode: 'buy', initialQty: 1, flash: [], cartLines: [] });
    expect(screen.getByRole('status').style.minHeight).not.toBe('');
  });

  it('vùng ghi chú vẫn có chỗ giữ cố định khi giỏ có sẵn (ô Số lượng không nhảy)', () => {
    renderSheet({ mode: 'buy', initialQty: 1, cartLines: inCart2 });
    expect(screen.getByRole('status').style.minHeight).not.toBe('');
  });

  it('khách chưa đăng nhập (cartMayArrive=false, giỏ không bao giờ về): Mua ngay không có dải ghi chú trống (L5 2)', () => {
    renderSheet({ mode: 'buy', initialQty: 1, flash: [], cartLines: undefined, cartMayArrive: false });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('khách chưa đăng nhập nhưng phân loại có giới hạn Giờ vàng: vẫn giữ chỗ vì câu mất giá có thể hiện không liên quan giỏ (L5 2)', () => {
    renderSheet({ mode: 'buy', initialQty: 1, cartLines: undefined, cartMayArrive: false });
    expect(screen.getByRole('status').style.minHeight).not.toBe('');
  });

  it('cartMayArrive=false mà giỏ đã có trong cache: vẫn giữ chỗ và ghi câu giỏ có sẵn (L5 2)', () => {
    renderSheet({ mode: 'buy', initialQty: 1, flash: [], cartLines: inCart2, cartMayArrive: false });
    const region = screen.getByRole('status');
    expect(region.style.minHeight).not.toBe('');
    expect(region).toHaveTextContent('Giỏ đã có 2: Mua ngay thanh toán cả 3 sản phẩm.');
  });

  it('cartMayArrive đổi khi bảng còn mở (đăng nhập bấm từ chính bảng này, rồi huỷ): chốt theo lúc mở, dải trống không hiện rồi ẩn dưới ngón tay (L5 2)', () => {
    const base: SheetProps = { mode: 'buy', initialQty: 1, flash: [], cartLines: undefined };
    const guest = render(sheetElement({ ...base, cartMayArrive: false }));
    expect(screen.queryByRole('status')).toBeNull();
    guest.rerender(sheetElement({ ...base, cartMayArrive: true }));
    expect(screen.queryByRole('status')).toBeNull();
    guest.rerender(sheetElement({ ...base, cartMayArrive: false }));
    expect(screen.queryByRole('status')).toBeNull();
    guest.unmount();
    const member = render(sheetElement({ ...base, cartMayArrive: true }));
    expect(screen.getByRole('status').style.minHeight).not.toBe('');
    member.rerender(sheetElement({ ...base, cartMayArrive: false }));
    expect(screen.getByRole('status').style.minHeight).not.toBe('');
  });

  it('đóng rồi mở lại: cartMayArrive lấy lại theo giá trị lúc mở lần mới (L5 2)', () => {
    const base: SheetProps = { mode: 'buy', initialQty: 1, flash: [], cartLines: undefined };
    const view = render(sheetElement({ ...base, cartMayArrive: true }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    view.rerender(sheetElement({ ...base, cartMayArrive: false, open: false }));
    view.rerender(sheetElement({ ...base, cartMayArrive: false }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('cartMayArrive=true (đã đăng nhập): vẫn giữ chỗ khi giỏ chưa về; chế độ add không có vùng dù cartMayArrive (L5 2)', () => {
    const buy = renderSheet({ mode: 'buy', initialQty: 1, flash: [], cartLines: undefined, cartMayArrive: true });
    expect(screen.getByRole('status')).toBeInTheDocument();
    buy.unmount();
    renderSheet({ mode: 'add', initialQty: 1, flash: [], cartLines: undefined, cartMayArrive: true });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('VariationSheet: chữ tồn kho "Còn n sản phẩm" cho mọi n, tồn thấp chỉ nhấn bằng màu cảnh báo (L4 5)', () => {
  const withStock = (stock: number): VariationOption[] => [{ ...variations[0]!, stock }, ...variations.slice(1)];

  it('tồn 3 (thấp): "Gói 80 tờ · Còn 3 sản phẩm", phần tồn có màu cảnh báo', () => {
    renderSheet({ variations: withStock(3), flash: [] });
    const stock = screen.getByTestId('variation-sheet-stock');
    expect(stock).toHaveTextContent(/^Còn 3 sản phẩm$/);
    expect(stock.parentElement).toHaveTextContent('Gói 80 tờ · Còn 3 sản phẩm');
    expect(stock.style.color).toBe('var(--color-status-warning-fg)');
  });

  it('tồn 6 và 245: cùng chữ "Còn n sản phẩm" nhưng không màu cảnh báo; tồn 5 vẫn là mức thấp', () => {
    const six = renderSheet({ variations: withStock(6), flash: [] });
    expect(screen.getByTestId('variation-sheet-stock')).toHaveTextContent(/^Còn 6 sản phẩm$/);
    expect(screen.getByTestId('variation-sheet-stock').style.color).toBe('');
    six.unmount();
    const big = renderSheet({ variations: withStock(245), flash: [] });
    expect(screen.getByTestId('variation-sheet-stock')).toHaveTextContent(/^Còn 245 sản phẩm$/);
    big.unmount();
    renderSheet({ variations: withStock(5), flash: [] });
    expect(screen.getByTestId('variation-sheet-stock').style.color).toBe('var(--color-status-warning-fg)');
  });
});

describe('VariationSheet: hết hàng ghi "Tạm hết hàng" nhất quán', () => {
  it('chip hết hàng có chữ "Tạm hết hàng" (không chỉ gạch ngang), chip còn hàng có giá và dấu Giờ vàng', () => {
    renderSheet();
    const out = screen.getByRole('button', { name: /Combo 3 gói/ });
    expect(out).toHaveAttribute('aria-disabled', 'true');
    expect(out).toHaveTextContent('Tạm hết hàng');
    const flashChip = screen.getByRole('button', { name: /Gói 80 tờ/ });
    expect(flashChip).toHaveTextContent('26.000đ');
    expect(flashChip).toHaveTextContent('Giờ vàng');
    expect(screen.getByRole('button', { name: /Gói 40 tờ/ })).toHaveTextContent('20.000đ');
  });

  it('chip hai dòng: tên theo body-sm (14/22) và giá theo caption (13/20); web khổ điện thoại dùng đúng hai bậc này để chip hai app cùng cao', () => {
    renderSheet();
    const rows = screen.getByRole('button', { name: /Gói 40 tờ/ }).children;
    expect(rows).toHaveLength(2);
    expect((rows[0] as HTMLElement).style.fontSize).toBe('var(--type-body-sm-size)');
    expect((rows[0] as HTMLElement).style.lineHeight).toBe('var(--type-body-sm-lh)');
    expect((rows[1] as HTMLElement).style.fontSize).toBe('var(--type-caption-size)');
    expect((rows[1] as HTMLElement).style.lineHeight).toBe('var(--type-caption-lh)');
  });

  it('chú thích dưới giá và nút khi phân loại đang chọn hết hàng đều ghi "Tạm hết hàng"', () => {
    const allOut: VariationOption[] = [
      { id: 'v1', sku: 'S1', name: 'Gói 80 tờ', retailPrice: 35_000, salePrice: null, stock: 0 },
      { id: 'v2', sku: 'S2', name: 'Gói 40 tờ', retailPrice: 20_000, salePrice: null, stock: 0 },
    ];
    render(
      <VariationSheet open onClose={() => undefined} mode="buy" productName="Khăn ướt" thumbnail={null} variations={allOut} flash={[]} initialId={null} initialQty={1} busy={false} cartLines={undefined} onConfirm={() => undefined} />,
    );
    // Cả hai hết hàng thì bảng mở ở phân loại rẻ nhất theo luật mặc định của thẻ.
    expect(screen.getByTestId('variation-sheet-stock').parentElement).toHaveTextContent('Gói 40 tờ · Tạm hết hàng');
    expect(screen.getByRole('button', { name: 'Tạm hết hàng' })).toBeDisabled();
  });

  it('chú thích còn hàng ghi "Còn n sản phẩm" theo phân loại đang chọn', () => {
    renderSheet({ flash: [] });
    expect(screen.getByTestId('variation-sheet-stock').parentElement).toHaveTextContent('Gói 80 tờ · Còn 245 sản phẩm');
    fireEvent.click(screen.getByRole('button', { name: /Gói 40 tờ/ }));
    expect(screen.getByTestId('variation-sheet-stock').parentElement).toHaveTextContent('Gói 40 tờ · Còn 8 sản phẩm');
  });
});

describe('VariationSheet: perUserLeft (số suất khách còn mua được sau các đơn trước)', () => {
  const SPENT = 'Bạn không còn suất Giờ vàng của sản phẩm này nên tính giá thường.';

  it('hết suất (0): Thêm vào giỏ và Mua ngay ghi giá thường, ghi chú hết suất, vẫn giữ nhãn "Tối đa 3/khách" của suất', () => {
    const add = renderSheet({ mode: 'add', initialQty: 1, flash: flash({ perUserLeft: 0 }) });
    expect(buyButton()).toHaveTextContent('Thêm vào giỏ · 35.000đ');
    expect(screen.getByRole('status')).toHaveTextContent(SPENT);
    expect(screen.getByTestId('variation-sheet-flash')).toHaveTextContent('Tối đa 3/khách');
    add.unmount();
    renderSheet({ mode: 'buy', initialQty: 2, flash: flash({ perUserLeft: 0 }) });
    expect(buyButton()).toHaveTextContent('Mua ngay · 70.000đ');
  });

  it('còn 1 (nhỏ hơn giới hạn 3): chọn 1 giá Giờ vàng không ghi chú; chọn 2 cả dòng giá thường kèm "Bạn còn 1 suất"', () => {
    renderSheet({ mode: 'add', initialQty: 1, flash: flash({ perUserLeft: 1 }) });
    expect(buyButton()).toHaveTextContent('Thêm vào giỏ · 26.000đ');
    expect(screen.getByRole('status')).toHaveTextContent('');
    fireEvent.click(plus());
    expect(buyButton()).toHaveTextContent('Thêm vào giỏ · 70.000đ');
    expect(screen.getByRole('status')).toHaveTextContent('Bạn còn 1 suất Giờ vàng. Mua 2 thì cả dòng tính giá thường.');
  });

  it('chưa có perUserLeft (khách chưa đăng nhập, số chưa về): số như trước', () => {
    renderSheet({ mode: 'add', initialQty: 1 });
    expect(buyButton()).toHaveTextContent('Thêm vào giỏ · 26.000đ');
  });

  it('số về muộn không làm đổi chỗ ghi chú: vùng role=status có sẵn từ trước khi perUserLeft về', () => {
    const view = renderSheet({ mode: 'add', initialQty: 1 });
    const before = screen.getByRole('status');
    expect(before.style.minHeight).not.toBe('');
    view.rerender(sheetElement({ mode: 'add', initialQty: 1, flash: flash({ perUserLeft: 0 }) }));
    expect(screen.getByRole('status')).toBe(before);
    expect(before).toHaveTextContent(SPENT);
  });
});
