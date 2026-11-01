import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { shopStats } from '@tubutree/app-core/commerce/shop-stats';
import { ShopStatsRow } from './shop-stats-row';

describe('ShopStatsRow', () => {
  it('ba số: 17 Sản phẩm, 4,6 Đánh giá, 31k+ Đã bán; mỗi ô đọc bằng câu đầy đủ', () => {
    render(<ShopStatsRow stats={shopStats({ productCount: 17, ratingAvg: 4.6, sold: 31000 })} />);
    const cells = screen.getAllByTestId('shop-stat');
    expect(cells).toHaveLength(3);
    expect(cells[0]).toHaveTextContent('17');
    expect(cells[0]).toHaveTextContent('Sản phẩm');
    expect(cells[1]).toHaveTextContent('4,6');
    expect(cells[2]).toHaveTextContent('31k+');
    expect(screen.getByLabelText('17 sản phẩm')).toBe(cells[0]);
    expect(screen.getByLabelText('4,6 sao')).toBe(cells[1]);
    expect(screen.getByLabelText('Đã bán hơn 31.000')).toBe(cells[2]);
  });

  it('chỉ một số vẫn vẽ; rỗng thì không vẽ gì', () => {
    const { container, rerender } = render(<ShopStatsRow stats={shopStats({ productCount: 0 })} />);
    expect(screen.getAllByTestId('shop-stat')).toHaveLength(1);
    rerender(<ShopStatsRow stats={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('số dùng chữ số đều nhau (tabular) để hai app rộng bằng nhau', () => {
    render(<ShopStatsRow stats={shopStats({ productCount: 17 })} />);
    expect(screen.getByText('17').style.fontVariantNumeric).toBe('tabular-nums');
  });
});
