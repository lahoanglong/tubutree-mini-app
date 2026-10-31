import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import * as priceTag from './price-tag';
import { PriceTag, Money, Points } from './price-tag';

describe('PriceTag', () => {
  it('renders the formatted VND price, no compare-at shown when not on sale', () => {
    render(<PriceTag value={42000} />);
    expect(screen.getByText('42.000đ')).toBeInTheDocument();
    expect(screen.queryByText('52.000đ')).not.toBeInTheDocument();
  });
  it('shows a struck-through compareAt when it is greater than value', () => {
    render(<PriceTag value={42000} compareAt={52000} />);
    expect(screen.getByText('52.000đ')).toBeInTheDocument();
  });
  it('flash price wins and gets the flash tone', () => {
    render(<PriceTag value={52000} flash={{ price: 39000 }} />);
    expect(screen.getByText('39.000đ')).toBeInTheDocument();
  });
  it('tabular-nums applied so digits align in lists', () => {
    render(<PriceTag value={1000} data-testid="p" />);
    expect(screen.getByText('1.000đ').style.fontVariantNumeric).toBe('tabular-nums');
  });
});

describe('PriceTag: chữ đọc, tông giá, bố cục', () => {
  it('có chữ đọc "Giá" trước giá và ", giá gốc" trước giá gạch (a11y A1)', () => {
    const { container } = render(<PriceTag value={39000} compareAt={52000} />);
    expect(container.textContent).toBe('Giá 39.000đ, giá gốc 52.000đ');
  });
  it('không có giá gạch thì không có chữ ", giá gốc"', () => {
    const { container } = render(<PriceTag value={39000} />);
    expect(container.textContent).toBe('Giá 39.000đ');
  });
  it('Giờ vàng đọc "Giá Giờ vàng"', () => {
    const { container } = render(<PriceTag value={52000} flash={{ price: 39000 }} />);
    expect(container.textContent).toBe('Giá Giờ vàng 39.000đ');
  });
  it('chữ đọc nằm ngoài giá hiển thị: getByText chỉ trúng số', () => {
    render(<PriceTag value={39000} compareAt={52000} />);
    expect(screen.getByText('39.000đ').style.fontVariantNumeric).toBe('tabular-nums');
    expect(screen.getByText('52.000đ').style.textDecoration).toBe('line-through');
  });
  it('tone="deal" dùng màu giá giảm, mặc định dùng màu giá thường', () => {
    const { rerender } = render(<PriceTag value={39000} tone="deal" />);
    expect(screen.getByText('39.000đ').style.color).toBe('var(--color-text-price-deal)');
    rerender(<PriceTag value={39000} />);
    expect(screen.getByText('39.000đ').style.color).toBe('var(--color-text-price)');
  });
  it('Giờ vàng cũng là tông giảm giá', () => {
    render(<PriceTag value={52000} flash={{ price: 39000 }} />);
    expect(screen.getByText('39.000đ').style.color).toBe('var(--color-text-price-deal)');
  });
  it('size="tile" dùng bậc giá của thẻ (16/700)', () => {
    render(<PriceTag value={39000} size="tile" />);
    const el = screen.getByText('39.000đ');
    expect(el.style.fontSize).toBe('var(--type-price-tile-size)');
    expect(el.style.lineHeight).toBe('var(--type-price-tile-lh)');
  });
  it('layout="stack" xếp giá gạch xuống dòng dưới, inline thì cùng hàng', () => {
    const { container, rerender } = render(<PriceTag value={39000} compareAt={52000} layout="stack" />);
    expect((container.firstChild as HTMLElement).style.flexDirection).toBe('column');
    rerender(<PriceTag value={39000} compareAt={52000} />);
    expect((container.firstChild as HTMLElement).style.flexDirection).not.toBe('column');
  });
  it('thiếu giá hiện "—", không gạch, không chữ đọc "Giá 0đ"', () => {
    const { container } = render(<PriceTag value={null} compareAt={52000} />);
    expect(container.textContent).toContain('—');
    expect(container.textContent).not.toContain('52.000đ');
  });
});

describe('Money/Points', () => {
  it('Money renders a formatted amount', () => {
    render(<Money amount={100000} />);
    expect(screen.getByText('100.000đ')).toBeInTheDocument();
  });
  it('Points renders with "điểm" suffix', () => {
    render(<Points value={250} />);
    expect(screen.getByText(/250.*điểm/)).toBeInTheDocument();
  });
  it('không còn component Xu (xu đã gộp vào Điểm Xanh)', () => {
    expect('Xu' in priceTag).toBe(false);
  });
});
