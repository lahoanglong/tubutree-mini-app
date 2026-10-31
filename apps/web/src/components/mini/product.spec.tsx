// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { PriceTag, Money, Points } from './price-tag';
import { ProductThumb } from './product-thumb';
import { QuantitySelector } from './quantity-selector';
import { Timeline } from './timeline';
import { brandAccent } from './brand-accent';

describe('PriceTag thiếu giá', () => {
  it('null/undefined/NaN hiện "—" chứ không "NaNđ" hay "0đ"; Points rác hiện 0', () => {
    expect(mount(<PriceTag value={null} />).container.textContent).toBe('—');
    expect(mount(<PriceTag value={undefined} />).container.textContent).toBe('—');
    expect(mount(<PriceTag value={NaN} />).container.textContent).toBe('—');
    expect(mount(<PriceTag value={0} />).container.textContent).toBe('Giá 0đ');
    expect(mount(<Money amount={null} />).container.textContent).toBe('—');
    expect(mount(<Points value={NaN} />).container.textContent).toBe('0 điểm');
    expect(mount(<Points value={null} />).container.textContent).toBe('0 điểm');
  });
});

describe('PriceTag', () => {
  it('hiện giá đủ chữ số, giá gốc gạch khi có giảm, giá giờ vàng luôn thắng; chữ đọc "Giá" nằm ngoài số hiển thị', () => {
    const c = mount(<PriceTag value={80000} compareAt={100000} />).container;
    expect(c.textContent).toBe('Giá 80.000đ, giá gốc 100.000đ');
    const struck = Array.from(c.querySelectorAll('span')).find((e) => e.textContent === '100.000đ') as HTMLElement;
    expect(struck.style.textDecoration).toBe('line-through');
    const flash = mount(<PriceTag value={80000} compareAt={100000} flash={{ price: 60000 }} />).container;
    expect(flash.textContent).toBe('Giá Giờ vàng 60.000đ, giá gốc 100.000đ');
    const price = Array.from(flash.querySelectorAll('span')).find((e) => e.textContent === '60.000đ') as HTMLElement;
    expect(price.style.color).toBe('var(--color-text-price-deal)');
  });

  it('không gạch giá gốc khi không lớn hơn giá hiển thị; size đổi bậc chữ, kể cả bậc tile 16/700 của thẻ', () => {
    expect(mount(<PriceTag value={100000} compareAt={100000} />).container.textContent).toBe('Giá 100.000đ');
    const xl = Array.from(mount(<PriceTag value={1} size="xl" />).container.querySelectorAll('span')).find((e) => e.textContent === '1đ') as HTMLElement;
    expect(xl.style.fontSize).toBe('var(--type-price-xl-size)');
    const tile = Array.from(mount(<PriceTag value={1} size="tile" />).container.querySelectorAll('span')).find((e) => e.textContent === '1đ') as HTMLElement;
    expect(tile.style.fontSize).toBe('var(--type-price-tile-size)');
    expect(tile.style.lineHeight).toBe('var(--type-price-tile-lh)');
  });

  it('tone="deal" dùng màu giá giảm, mặc định dùng màu giá thường', () => {
    const find = (c: HTMLElement) => Array.from(c.querySelectorAll('span')).find((e) => e.textContent === '39.000đ') as HTMLElement;
    expect(find(mount(<PriceTag value={39000} tone="deal" />).container).style.color).toBe('var(--color-text-price-deal)');
    expect(find(mount(<PriceTag value={39000} />).container).style.color).toBe('var(--color-text-price)');
  });

  it('layout="stack" xếp giá gạch xuống dòng dưới; inline thì cùng hàng', () => {
    const stack = mount(<PriceTag value={39000} compareAt={52000} layout="stack" />).container;
    expect((stack.firstElementChild as HTMLElement).style.flexDirection).toBe('column');
    const inline = mount(<PriceTag value={39000} compareAt={52000} />).container;
    expect((inline.firstElementChild as HTMLElement).style.flexDirection).not.toBe('column');
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
