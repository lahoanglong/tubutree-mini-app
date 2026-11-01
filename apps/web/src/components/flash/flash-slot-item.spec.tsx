// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { FlashSlotItem as FlashSlotItemData } from '@tubutree/app-core/api/flash-sale';
import { click } from '@/test-utils/dom';
import { mount } from '@/components/mini/harness';
import { FlashSlotItem } from './flash-slot-item';

const ITEM: FlashSlotItemData = {
  itemId: 'fi1',
  variationId: 'v1',
  variationName: null,
  productId: 'p1',
  productSlug: 'serum-x',
  productName: 'Serum Bã Trầu',
  thumbnail: null,
  categoryIds: ['c1'],
  flashPrice: 79_000,
  retailPrice: 129_000,
  salePrice: null,
  soldCount: 6,
  quota: 10,
  soldOut: false,
  perUserLimit: 5,
};

const base = { slotStatus: 'LIVE' as const, reminded: false, remindPending: false, onBuy: () => {}, onToggleRemind: () => {} };
const show = (item: FlashSlotItemData, props: Partial<React.ComponentProps<typeof FlashSlotItem>> = {}) =>
  mount(<FlashSlotItem item={item} {...base} {...props} />).container;
const button = (c: HTMLElement, name: string) => Array.from(c.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === name) ?? null;
const link = (c: HTMLElement) => c.querySelector('a.tubu-tile-link') as HTMLAnchorElement;

describe('FlashSlotItem (web): khung đang diễn ra', () => {
  it('thẻ line: giá Giờ vàng, giá gạch, giới hạn mỗi khách và thanh đã bán có chữ', () => {
    const c = show(ITEM);
    expect(c.querySelector('[data-ds-variant="line"]')).not.toBeNull();
    expect(c.textContent).toContain('79.000đ');
    expect(c.textContent).toContain('129.000đ');
    expect(c.textContent).toContain('Mỗi khách tối đa 5');
    expect(c.textContent).toContain('Đã bán 60%');
  });

  it('nút Mua ngay mang tên sản phẩm, bấm gọi onBuy và không đi theo liên kết sản phẩm', () => {
    const onBuy = vi.fn();
    const c = show(ITEM, { onBuy });
    const buy = button(c, 'Mua ngay Serum Bã Trầu')!;
    expect(buy).not.toBeNull();
    expect(link(c).contains(buy)).toBe(false);
    click(buy);
    expect(onBuy).toHaveBeenCalledTimes(1);
  });

  it('tên là liên kết tới đúng phân loại có suất (?v=)', () => {
    const c = show({ ...ITEM, variationId: 'v-flash' });
    expect(link(c).getAttribute('href')).toBe('/san-pham/serum-x?v=v-flash');
    expect(link(c).getAttribute('aria-label')).toBe('Serum Bã Trầu');
  });

  it('tên phân loại hiện cùng dòng giới hạn khi sản phẩm nhiều phân loại', () => {
    const c = show({ ...ITEM, variationName: '500g' });
    expect(c.textContent).toContain('500g · Mỗi khách tối đa 5');
  });
});

describe('FlashSlotItem (web): món hết suất', () => {
  const SOLD = { ...ITEM, soldOut: true, soldCount: 10 };

  const opacityOf = (el: Element | null) => (el as HTMLElement).style.opacity;

  it('ảnh và nút mờ, thanh ghi "Đã bán hết", nút Mua ngay khoá bằng aria-disabled và không gọi onBuy', () => {
    const onBuy = vi.fn();
    const c = show(SOLD, { onBuy });
    expect(opacityOf(c.querySelector('[data-ds-part="media"]'))).toBe('0.55');
    expect(c.textContent).toContain('Đã bán hết');
    const buy = button(c, 'Mua ngay Serum Bã Trầu')!;
    expect(buy.getAttribute('aria-disabled')).toBe('true');
    expect(opacityOf(buy)).toBe('0.55');
    click(buy);
    expect(onBuy).not.toHaveBeenCalled();
  });

  it('chữ (tên, giá, ghi chú) không bị làm mờ: vỏ thẻ và thân thẻ không mang opacity', () => {
    const c = show(SOLD);
    expect(opacityOf(c.firstElementChild)).toBe('');
    expect(opacityOf(c.querySelector('[data-ds-part="body"]'))).toBe('');
  });

  it('hàng còn suất không mờ ở ảnh lẫn nút', () => {
    const c = show(ITEM);
    expect(opacityOf(c.querySelector('[data-ds-part="media"]'))).toBe('');
    expect(opacityOf(button(c, 'Mua ngay Serum Bã Trầu'))).toBe('');
  });
});

describe('FlashSlotItem (web): khung sắp diễn ra', () => {
  it('không có Mua ngay; có nút Nhắc tôi aria-pressed=false mang tên sản phẩm', () => {
    const onToggleRemind = vi.fn();
    const c = show(ITEM, { slotStatus: 'UPCOMING', onToggleRemind });
    expect(button(c, 'Mua ngay Serum Bã Trầu')).toBeNull();
    const remind = button(c, 'Nhắc tôi Serum Bã Trầu')!;
    expect(remind.getAttribute('aria-pressed')).toBe('false');
    expect(remind.textContent).toBe('Nhắc tôi');
    click(remind);
    expect(onToggleRemind).toHaveBeenCalledTimes(1);
  });

  it('đã nhắc: aria-pressed=true, chữ "Đã đặt nhắc", tên đọc nói việc bấm sẽ bỏ nhắc', () => {
    const c = show(ITEM, { slotStatus: 'UPCOMING', reminded: true });
    const remind = button(c, 'Đã đặt nhắc Serum Bã Trầu, bỏ nhắc')!;
    expect(remind.getAttribute('aria-pressed')).toBe('true');
    expect(remind.textContent).toBe('Đã đặt nhắc');
  });

  it('đang gửi yêu cầu nhắc: nút báo bận và không nhận thêm lần bấm', () => {
    const onToggleRemind = vi.fn();
    const c = show(ITEM, { slotStatus: 'UPCOMING', remindPending: true, onToggleRemind });
    const remind = button(c, 'Nhắc tôi Serum Bã Trầu')!;
    expect(remind.getAttribute('aria-busy')).toBe('true');
    click(remind);
    expect(onToggleRemind).not.toHaveBeenCalled();
  });

  it('món sắp mở không vẽ thanh đã bán: không nói "Vừa mở bán" khi suất chưa mở', () => {
    const c = show({ ...ITEM, soldCount: 0 }, { slotStatus: 'UPCOMING' });
    expect(c.textContent).not.toMatch(/Vừa mở bán|Đã bán|Sắp hết/);
    expect(c.querySelector('[data-testid="flash-sold-bar"]')).toBeNull();
  });

  it('chỗ thanh để trống cao đúng bằng khi khung đang diễn ra, thẻ không nhảy lúc khung mở', () => {
    const footerHeight = (status: 'LIVE' | 'UPCOMING') => {
      const c = show(ITEM, { slotStatus: status });
      const footer = Array.from(c.querySelectorAll('[data-ds-part="body"] > div')).find((d) => (d as HTMLElement).style.height === '20px');
      return footer ? (footer as HTMLElement).style.height : null;
    };
    expect(footerHeight('UPCOMING')).toBe('20px');
    expect(footerHeight('LIVE')).toBe('20px');
  });
});

describe('FlashSlotItem (web): dữ liệu xấu không làm vỡ dòng', () => {
  it('tên dài 80 ký tự và không có ảnh: nút vẫn đủ tên truy cập', () => {
    const name = 'Nước giặt sinh học hương sả chanh dung tích lớn tiết kiệm cho cả gia đình bạn nhé'.slice(0, 80);
    const c = show({ ...ITEM, productName: name, thumbnail: null });
    expect(button(c, `Mua ngay ${name}`)).not.toBeNull();
  });

  it('quota 0 không in NaN hay Infinity', () => {
    const c = show({ ...ITEM, quota: 0, soldCount: 0 });
    expect(c.textContent).not.toMatch(/NaN|Infinity/);
    expect(c.textContent).toContain('Vừa mở bán');
  });
});
