import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()) }));

import { GallerySlide } from './product-detail';

describe('GallerySlide: ảnh lỗi tải rơi về hình lá chung (B-23)', () => {
  it('ảnh tải được thì hiện ảnh', () => {
    render(<GallerySlide src="https://img.test/a.jpg" alt="Tiêu — ảnh 1" eager />);
    expect(screen.getByAltText('Tiêu — ảnh 1')).toHaveAttribute('src', 'https://img.test/a.jpg');
  });

  it('ảnh lỗi thì hiện hình lá thay icon ảnh vỡ', () => {
    const { container } = render(<GallerySlide src="https://img.test/hong.jpg" alt="Tiêu — ảnh 1" eager={false} />);
    fireEvent.error(screen.getByAltText('Tiêu — ảnh 1'));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('gallery-fallback').querySelector('path')).not.toBeNull();
  });
});
