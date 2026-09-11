import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Price, DiscountPct } from './price';

describe('Price', () => {
  it('hiển thị giá theo định dạng VND', () => {
    render(<Price value={289000} />);
    expect(screen.getByText('289.000đ')).toBeTruthy();
  });

  it('có compareAt LỚN HƠN → hiện giá gạch', () => {
    render(<Price value={80000} compareAt={100000} />);
    expect(screen.getByText('80.000đ')).toBeTruthy();
    const compare = screen.getByText('100.000đ');
    expect(compare.style.textDecoration).toBe('line-through');
  });

  it('compareAt KHÔNG lớn hơn giá bán → không hiện giá gạch (tránh "giảm giá" giả)', () => {
    render(<Price value={100000} compareAt={100000} />);
    expect(screen.queryByText(/100\.000đ/)).toBeTruthy();
    expect(screen.queryAllByText('100.000đ')).toHaveLength(1); // chỉ 1 lần, không có bản gạch
  });

  it('compareAt null/undefined → chỉ hiện 1 giá', () => {
    render(<Price value={50000} compareAt={null} />);
    expect(screen.queryAllByText(/đ$/)).toHaveLength(1);
  });
});

describe('DiscountPct', () => {
  it('tính % giảm, làm tròn XUỐNG (không hứa quá mức thực tế)', () => {
    // (100000-66000)/100000 = 34% chẵn
    render(<DiscountPct value={66000} compareAt={100000} />);
    expect(screen.getByText('-34%')).toBeTruthy();
  });

  it('giảm 33,6% → hiện -33% (không làm tròn lên 34)', () => {
    render(<DiscountPct value={66400} compareAt={100000} />);
    expect(screen.getByText('-33%')).toBeTruthy();
  });

  it('không có compareAt / không thực sự giảm → không render gì', () => {
    const { container: c1 } = render(<DiscountPct value={100000} />);
    expect(c1.innerHTML).toBe('');
    const { container: c2 } = render(<DiscountPct value={100000} compareAt={100000} />);
    expect(c2.innerHTML).toBe('');
    const { container: c3 } = render(<DiscountPct value={100000} compareAt={90000} />);
    expect(c3.innerHTML).toBe('');
  });

  it('chênh lệch quá nhỏ (làm tròn ra 0%) → không hiện nhãn "-0%"', () => {
    render(<DiscountPct value={99999} compareAt={100000} />);
    expect(screen.queryByText(/-0%/)).toBeNull();
  });
});
