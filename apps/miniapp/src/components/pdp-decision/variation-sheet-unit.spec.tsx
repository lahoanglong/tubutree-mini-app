import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { VariationSheet, type VariationOption } from '../variation-sheet';

const variations: VariationOption[] = [
  { id: 'v1', sku: 'S1', name: 'Gói 40 tờ', retailPrice: 20_000, salePrice: null, stock: 8 },
  { id: 'v2', sku: 'S2', name: 'Gói 80 tờ', retailPrice: 35_000, salePrice: null, stock: 245 },
  { id: 'v3', sku: 'S3', name: 'Gói 100 tờ', retailPrice: 30_000, salePrice: null, stock: 0 },
];

function renderSheet(unitOn?: boolean, flash: { productSlug: string; variationId: string; flashPrice: number }[] = []) {
  render(
    <VariationSheet
      open
      onClose={() => undefined}
      mode="add"
      productName="Khăn ướt"
      thumbnail={null}
      variations={variations}
      flash={flash}
      initialId="v1"
      initialQty={1}
      busy={false}
      cartLines={undefined}
      unitOn={unitOn}
      onConfirm={() => undefined}
    />,
  );
  return within(screen.getByRole('group', { name: 'Phân loại' }));
}

describe('VariationSheet: giá theo đơn vị (cờ catalog.unit_price_enabled)', () => {
  it('không bật: chip giữ hai dòng như cũ', () => {
    expect(renderSheet().queryAllByTestId('variation-unit-price')).toHaveLength(0);
  });

  it('bật: chip còn hàng có giá mỗi tờ, nhãn ở cỡ rẻ hơn còn hàng, chip hết hàng không có dòng nào', () => {
    const chips = renderSheet(true);
    expect(chips.getAllByTestId('variation-unit-price').map((n) => n.textContent)).toEqual(['≈ 500đ / tờ', '≈ 440đ / tờ · Lợi hơn 12% mỗi tờ']);
  });

  it('đổi phân loại thì nhãn tính lại theo cỡ đang chọn; giá Giờ vàng được chia đúng như chip ghi', () => {
    const chips = renderSheet(true, [{ productSlug: 'k', variationId: 'v1', flashPrice: 14_000 }]);
    expect(chips.getAllByTestId('variation-unit-price').map((n) => n.textContent)).toEqual(['≈ 350đ / tờ', '≈ 440đ / tờ']);
    fireEvent.click(chips.getByText('Gói 80 tờ'));
    expect(chips.getAllByTestId('variation-unit-price').map((n) => n.textContent)).toEqual(['≈ 350đ / tờ · Lợi hơn 20% mỗi tờ', '≈ 440đ / tờ']);
  });
});
