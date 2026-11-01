// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { shopStats } from '@tubutree/app-core/commerce/shop-stats';
import { mount } from './harness';
import { ShopStatsRow } from './shop-stats-row';

const cells = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="shop-stat"]'));

describe('ShopStatsRow (web)', () => {
  it('ba số: 17 Sản phẩm, 4,6 Đánh giá, 31k+ Đã bán; mỗi ô đọc bằng câu đầy đủ', () => {
    mount(<ShopStatsRow stats={shopStats({ productCount: 17, ratingAvg: 4.6, sold: 31000 })} />);
    const c = cells();
    expect(c).toHaveLength(3);
    expect(c[0]!.textContent).toContain('17');
    expect(c[0]!.textContent).toContain('Sản phẩm');
    expect(c[1]!.textContent).toContain('4,6');
    expect(c[2]!.textContent).toContain('31k+');
    expect(c.map((e) => e.getAttribute('aria-label'))).toEqual(['17 sản phẩm', '4,6 sao', 'Đã bán hơn 31.000']);
  });

  it('chỉ một số vẫn vẽ; rỗng thì không vẽ gì', () => {
    const r = mount(<ShopStatsRow stats={shopStats({ productCount: 0 })} />);
    expect(cells()).toHaveLength(1);
    r.unmount();
    const e = mount(<ShopStatsRow stats={[]} />);
    expect(e.container.innerHTML).toBe('');
  });

  it('số dùng chữ số đều nhau (tabular) để hai app rộng bằng nhau', () => {
    mount(<ShopStatsRow stats={shopStats({ productCount: 17 })} />);
    const n = Array.from(document.querySelectorAll<HTMLElement>('span,div,p')).find((e) => e.textContent === '17' && e.children.length === 0)!;
    expect(n.style.fontVariantNumeric).toBe('tabular-nums');
  });
});
