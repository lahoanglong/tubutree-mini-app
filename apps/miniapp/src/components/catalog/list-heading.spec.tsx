import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ListHeading } from './list-heading';

describe('ListHeading', () => {
  it('có tên danh mục: h2 một dòng + caption số sản phẩm (định dạng vi-VN)', () => {
    render(<ListHeading title="Tẩy rửa sinh học" count={1234} isLoading={false} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Tẩy rửa sinh học' })).toBeInTheDocument();
    expect(screen.getByTestId('result-count')).toHaveTextContent('1.234 sản phẩm');
  });

  it('khi tìm kiếm (title=null) chỉ còn caption, không có heading', () => {
    render(<ListHeading title={null} count={2} isLoading={false} />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByTestId('result-count')).toHaveTextContent('2 sản phẩm');
  });

  it('caption là vùng aria-live polite; đang tải hoặc chưa có số chỉ là khoảng trắng không ngắt (giữ chiều cao, không in "0 sản phẩm")', () => {
    const { rerender } = render(<ListHeading title="A" count={3} isLoading />);
    const el = screen.getByTestId('result-count');
    expect(el).toHaveAttribute('aria-live', 'polite');
    expect(el).toHaveAttribute('aria-atomic', 'true');
    expect(el.textContent).toBe(' ');
    rerender(<ListHeading title="A" count={undefined} isLoading={false} />);
    expect(screen.getByTestId('result-count').textContent).toBe(' ');
    rerender(<ListHeading title="A" count={0} isLoading={false} />);
    expect(screen.getByTestId('result-count')).toHaveTextContent('0 sản phẩm');
  });

  it('tên dài không đẩy caption ra ngoài khung: tiêu đề cắt một dòng', () => {
    render(<ListHeading title={'Rất dài '.repeat(20)} count={5} isLoading={false} />);
    const h = screen.getByRole('heading', { level: 2 });
    expect(h.style.whiteSpace).toBe('nowrap');
    expect(h.style.textOverflow).toBe('ellipsis');
  });
});
