// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click } from '@/test-utils/dom';
import { mount } from './harness';

const mocks = vi.hoisted(() => ({ push: vi.fn(), flash: [] as unknown[] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => mocks.flash }));

import { PriceTag, Money, Points } from './price-tag';
import { ProductThumb } from './product-thumb';
import { ProductTile, type ProductTileProduct } from './product-tile';
import ProductCard from './product-card';
import { QuantitySelector } from './quantity-selector';
import { Timeline } from './timeline';
import { brandAccent } from './brand-accent';

const P: ProductTileProduct = {
  id: 'p1', slug: 'sua-hat', name: 'Sữa hạt Tubu', brand: 'Polang', thumbnail: '/a.jpg',
  basePrice: 100000, salePrice: null, inStock: true, reviewCount: 4, ratingAvg: 4.5, sold: 1500,
};

beforeEach(() => {
  mocks.push.mockClear();
  mocks.flash = [];
});

describe('PriceTag thiếu giá', () => {
  it('null/undefined/NaN hiện "—" chứ không "NaNđ" hay "0đ"; Points rác hiện 0', () => {
    expect(mount(<PriceTag value={null} />).container.textContent).toBe('—');
    expect(mount(<PriceTag value={undefined} />).container.textContent).toBe('—');
    expect(mount(<PriceTag value={NaN} />).container.textContent).toBe('—');
    expect(mount(<PriceTag value={0} />).container.textContent).toBe('0đ');
    expect(mount(<Money amount={null} />).container.textContent).toBe('—');
    expect(mount(<Points value={NaN} />).container.textContent).toBe('0 điểm');
    expect(mount(<Points value={null} />).container.textContent).toBe('0 điểm');
  });
});

describe('PriceTag', () => {
  it('hiện giá đủ chữ số, giá gốc gạch khi có giảm, giá giờ vàng luôn thắng', () => {
    const c = mount(<PriceTag value={80000} compareAt={100000} />).container;
    expect(c.textContent).toBe('80.000đ100.000đ');
    expect((c.querySelectorAll('span')[2] as HTMLElement).style.textDecoration).toBe('line-through');
    const flash = mount(<PriceTag value={80000} compareAt={100000} flash={{ price: 60000 }} />).container;
    expect(flash.textContent).toBe('60.000đ100.000đ');
    expect((flash.querySelectorAll('span')[1] as HTMLElement).style.color).toBe('var(--color-flash-fg)');
  });

  it('không gạch giá gốc khi không lớn hơn giá hiển thị; size đổi bậc chữ', () => {
    expect(mount(<PriceTag value={100000} compareAt={100000} />).container.textContent).toBe('100.000đ');
    expect((mount(<PriceTag value={1} size="xl" />).container.querySelectorAll('span')[1] as HTMLElement).style.fontSize).toBe('var(--type-price-xl-size)');
  });

  it('Money (đủ/rút gọn) và Points', () => {
    expect(mount(<Money amount={50000} />).container.textContent).toBe('50.000đ');
    expect(mount(<Money amount={50000} short />).container.textContent).toBe('50k');
    expect(mount(<Points value={1250} />).container.textContent).toBe('1.250 điểm');
  });
});

describe('ProductThumb', () => {
  it('có ảnh thì hiện ảnh; ảnh lỗi hoặc không có thì hiện lá xanh', () => {
    const c = mount(<ProductThumb src="/a.jpg" alt="Sữa" size={64} />).container;
    const img = c.querySelector('img')!;
    expect(img.alt).toBe('Sữa');
    expect((c.firstElementChild as HTMLElement).style.width).toBe('64px');
    act(() => { img.dispatchEvent(new Event('error')); });
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('svg')).not.toBeNull();
    expect(mount(<ProductThumb alt="x" />).container.querySelector('img')).toBeNull();
    expect(mount(<ProductThumb alt="x" />).container.querySelector('svg')).not.toBeNull();
  });
});

describe('ProductTile', () => {
  it('nút tên là phần tử bấm duy nhất, tên truy cập = tên sản phẩm, mô tả = giá', () => {
    const onPress = vi.fn();
    const c = mount(<ProductTile product={P} onPress={onPress} />).container;
    const link = c.querySelector('button.tubu-tile-link') as HTMLElement;
    expect(link.getAttribute('aria-label')).toBe('Sữa hạt Tubu');
    expect(c.querySelector(`#${CSS.escape(link.getAttribute('aria-describedby')!)}`)!.textContent).toBe('100.000đ');
    expect(c.querySelectorAll('button').length).toBe(1);
    click(link);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('hiện nhãn hiệu, đánh giá, đã bán; chưa có đánh giá thì "Mới"', () => {
    const c = mount(<ProductTile product={P} onPress={() => {}} />).container;
    expect(c.textContent).toContain('Polang');
    expect(c.textContent).toContain('4.5');
    expect(c.textContent).toContain('(4)');
    expect(c.textContent).toContain('Đã bán 1,5k+');
    expect(mount(<ProductTile product={{ ...P, reviewCount: 0, sold: 0 }} onPress={() => {}} />).container.textContent).toContain('★ Mới');
  });

  it('giá sale hiện kèm giá gốc; priceOverride (giờ vàng) thắng', () => {
    expect(mount(<ProductTile product={{ ...P, salePrice: 90000 }} onPress={() => {}} />).container.textContent).toContain('90.000đ100.000đ');
    expect(mount(<ProductTile product={P} priceOverride={{ price: 70000 }} onPress={() => {}} />).container.textContent).toContain('70.000đ100.000đ');
  });

  it('hết hàng phủ nhãn "Tạm hết"; còn hàng thì không', () => {
    expect(mount(<ProductTile product={{ ...P, inStock: false }} onPress={() => {}} />).container.textContent).toContain('Tạm hết — sẽ về sớm');
    expect(mount(<ProductTile product={P} onPress={() => {}} />).container.textContent).not.toContain('Tạm hết');
  });

  it('tim yêu thích do trang truyền vào, là anh em của nút tên (không lồng); dạng dòng không vẽ tim', () => {
    const grid = mount(<ProductTile product={P} wishlist={<button aria-label="Yêu thích" />} onPress={() => {}} />).container;
    const heart = grid.querySelector('[aria-label="Yêu thích"]')!;
    expect(grid.querySelector('.tubu-tile-link')!.contains(heart)).toBe(false);
    expect(mount(<ProductTile product={P} variant="line" wishlist={<button aria-label="Yêu thích" />} onPress={() => {}} />).container.querySelector('[aria-label="Yêu thích"]')).toBeNull();
  });

  it('Mua lại: nút riêng gọi onAction và không kích hoạt thẻ', () => {
    const onPress = vi.fn();
    const onAction = vi.fn();
    const c = mount(<ProductTile product={P} action="rebuy" onAction={onAction} onPress={onPress} />).container;
    const rebuy = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Mua lại')!;
    click(rebuy);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('badge truyền vào hiện trên ảnh', () => {
    expect(mount(<ProductTile product={P} badge={<i data-testid="bd">-10%</i>} onPress={() => {}} />).container.querySelector('[data-testid="bd"]')).not.toBeNull();
  });
});

describe('ProductCard', () => {
  it('bấm thẻ mở trang chi tiết của web', () => {
    const c = mount(<ProductCard product={P as never} />).container;
    click(c.querySelector('button.tubu-tile-link'));
    expect(mocks.push).toHaveBeenCalledWith('/san-pham/sua-hat');
  });

  it('giá giờ vàng rẻ hơn thì hiện giá giờ vàng và nhãn "Giờ vàng -x%"', () => {
    mocks.flash = [{ itemId: 'i', variationId: 'v', productSlug: 'sua-hat', flashPrice: 60000, retailPrice: 100000, soldCount: 0, quota: 5, endAt: '2030-01-01' }];
    const c = mount(<ProductCard product={P as never} />).container;
    expect(c.textContent).toContain('60.000đ100.000đ');
    expect(c.textContent).toContain('Giờ vàng -40%');
  });

  it('sale thường hiện "-x%"; hết hàng thì không hiện nhãn %', () => {
    expect(mount(<ProductCard product={{ ...P, salePrice: 90000 } as never} />).container.textContent).toContain('-10%');
    expect(mount(<ProductCard product={{ ...P, salePrice: 90000, inStock: false } as never} />).container.textContent).not.toContain('-10%');
  });
});

describe('QuantitySelector', () => {
  it('hai nút có nhãn; ở min/max chỉ aria-disabled và không đổi số', () => {
    const onChange = vi.fn();
    const c = mount(<QuantitySelector value={1} max={3} onChange={onChange} />).container;
    const [minus, plus] = Array.from(c.querySelectorAll('button')) as HTMLElement[];
    expect(minus!.getAttribute('aria-label')).toBe('Giảm số lượng');
    expect(minus!.getAttribute('aria-disabled')).toBe('true');
    click(minus!);
    expect(onChange).not.toHaveBeenCalled();
    click(plus!);
    expect(onChange).toHaveBeenCalledWith(2);
    expect(c.textContent).toBe('1');
  });

  it('chạm tối thiểu 44px: md 44px, sm 36px kèm vùng chạm mở rộng', () => {
    const md = mount(<QuantitySelector value={2} max={5} onChange={() => {}} />).container.querySelector('button') as HTMLElement;
    expect(md.style.width).toBe('44px');
    const sm = mount(<QuantitySelector value={2} max={5} size="sm" onChange={() => {}} />).container.querySelector('button') as HTMLElement;
    expect(sm.style.width).toBe('36px');
    expect(sm.className).toContain('tubu-hit-44-square');
  });

  it('chạm max thì nút + không tăng', () => {
    const onChange = vi.fn();
    const plus = mount(<QuantitySelector value={3} max={3} onChange={onChange} />).container.querySelectorAll('button')[1]!;
    click(plus);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Timeline', () => {
  const steps = ['Đã nhận', 'Đang giao', 'Đã giao'];

  it('đánh dấu bước xong/đang diễn ra/chưa tới cho trình đọc màn hình', () => {
    const c = mount(<Timeline steps={steps} current={1} />).container;
    const li = Array.from(c.querySelectorAll('li'));
    expect(li.map((l) => l.getAttribute('data-state'))).toEqual(['done', 'current', 'upcoming']);
    expect(li[1]!.getAttribute('aria-current')).toBe('step');
    expect(li[0]!.textContent).toBe('Đã nhận, đã xong');
    expect(c.querySelector('ol')!.getAttribute('aria-label')).toBe('Tiến độ yêu cầu');
  });

  it('current = số bước thì mọi bước xong; compact chỉ hiện tên bước hiện tại', () => {
    expect(Array.from(mount(<Timeline steps={steps} current={3} />).container.querySelectorAll('li')).every((l) => l.getAttribute('data-state') === 'done')).toBe(true);
    const compact = mount(<Timeline steps={steps} current={1} compact />).container;
    expect(compact.querySelector('div[aria-hidden="true"]')!.textContent).toBe('Đang giao');
  });

  it('hints chỉ hiện ở bản đầy đủ', () => {
    expect(mount(<Timeline steps={steps} current={0} hints={{ 0: <em>Hôm nay</em> }} />).container.textContent).toContain('Hôm nay');
    expect(mount(<Timeline steps={steps} current={0} compact hints={{ 0: <em>Hôm nay</em> }} />).container.textContent).not.toContain('Hôm nay');
  });
});

describe('brandAccent', () => {
  it('nhãn quen dùng token riêng (không phân biệt hoa thường/dấu cách), nhãn lạ dùng màu hành động chính', () => {
    expect(brandAccent('Le Plateau Coffee')).toBe('var(--color-brand-leplateau)');
    expect(brandAccent('POLANG')).toBe('var(--color-brand-polang)');
    expect(brandAccent('Không biết')).toBe('var(--color-action-primary-bg)');
  });
});
