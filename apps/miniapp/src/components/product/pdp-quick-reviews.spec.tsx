import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PdpQuickReviews } from './pdp-quick-reviews';

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id, rating: 5, comment: `Dùng rất ổn ${id}`, images: [] as string[], videoUrl: null as string | null, createdAt: '2026-10-01T00:00:00.000Z', author: 'Lan', ...over,
});

describe('PdpQuickReviews', () => {
  it('hiện điểm, số lượt, đúng 2 đánh giá có chữ và nút "Xem tất cả (n)" cuộn tới danh sách đầy đủ', () => {
    const onSeeAll = vi.fn();
    render(<PdpQuickReviews average={4.4} count={27} items={[item('a'), item('b', { comment: null }), item('c', { images: ['x.jpg'] }), item('d')]} onSeeAll={onSeeAll} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Đánh giá' })).toBeInTheDocument();
    expect(screen.getByText(/4,4/)).toBeInTheDocument();
    expect(screen.getAllByTestId('quick-review')).toHaveLength(2);
    expect(screen.getByText('Dùng rất ổn c')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả (27)' }));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('không có đánh giá có chữ thì không render gì', () => {
    const { container } = render(<PdpQuickReviews average={4} count={3} items={[item('a', { comment: null })]} onSeeAll={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
