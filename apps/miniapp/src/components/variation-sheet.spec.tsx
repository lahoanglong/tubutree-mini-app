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

function renderSheet(props: { flash?: ReturnType<typeof flash>; initialQty?: number; mode?: 'add' | 'buy' } = {}) {
  const onConfirm = vi.fn();
  const view = render(
    <VariationSheet
      open
      onClose={() => undefined}
      mode={props.mode ?? 'buy'}
      productName="Khăn ướt"
      thumbnail={null}
      variations={variations}
      flash={props.flash ?? flash()}
      initialId="v1"
      initialQty={props.initialQty ?? 3}
      busy={false}
      onConfirm={onConfirm}
    />,
  );
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
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/Tối đa/)).toBeNull();
  });

  it('hết giờ khi khách đang mở bảng (flash rỗng): giá thường, không nhãn Giờ vàng, không ghi chú', () => {
    const { rerender } = renderSheet({ initialQty: 5 });
    expect(screen.getByRole('status')).toHaveTextContent(OVER_5);
    rerender(
      <VariationSheet open onClose={() => undefined} mode="buy" productName="Khăn ướt" thumbnail={null} variations={variations} flash={[]} initialId="v1" initialQty={5} busy={false} onConfirm={() => undefined} />,
    );
    expect(buyButton()).toHaveTextContent('Mua ngay · 175.000đ');
    expect(screen.queryByTestId('variation-sheet-flash')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('chọn phân loại không phải Giờ vàng thì nhãn và ghi chú biến mất', () => {
    renderSheet({ initialQty: 5 });
    fireEvent.click(screen.getByRole('button', { name: /Gói 40 tờ/ }));
    expect(screen.queryByTestId('variation-sheet-flash')).toBeNull();
    expect(buyButton()).toHaveTextContent('Mua ngay · 100.000đ');
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

  it('chú thích dưới giá và nút khi phân loại đang chọn hết hàng đều ghi "Tạm hết hàng"', () => {
    const allOut: VariationOption[] = [
      { id: 'v1', sku: 'S1', name: 'Gói 80 tờ', retailPrice: 35_000, salePrice: null, stock: 0 },
      { id: 'v2', sku: 'S2', name: 'Gói 40 tờ', retailPrice: 20_000, salePrice: null, stock: 0 },
    ];
    render(
      <VariationSheet open onClose={() => undefined} mode="buy" productName="Khăn ướt" thumbnail={null} variations={allOut} flash={[]} initialId={null} initialQty={1} busy={false} onConfirm={() => undefined} />,
    );
    // Cả hai hết hàng thì bảng mở ở phân loại rẻ nhất theo luật mặc định của thẻ.
    expect(screen.getByText('Gói 40 tờ · Tạm hết hàng')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tạm hết hàng' })).toBeDisabled();
  });

  it('chú thích còn hàng ghi "Còn n" theo phân loại đang chọn', () => {
    renderSheet({ flash: [] });
    expect(screen.getByText('Gói 80 tờ · Còn 245')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Gói 40 tờ/ }));
    expect(screen.getByText('Gói 40 tờ · Còn 8')).toBeInTheDocument();
  });
});
