import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProductThumb } from './product-thumb';

// BUYERMINI-13: checkout dựng <img src={undefined}> cho sản phẩm chưa có ảnh nên hiện icon ảnh vỡ + chữ alt.
describe('ProductThumb', () => {
  it('có ảnh → img với alt là tên sản phẩm, đúng kích thước khung', () => {
    const { container } = render(<ProductThumb src="https://img.test/a.jpg" alt="Tiêu đen" size={48} />);
    const img = screen.getByAltText('Tiêu đen');
    expect(img).toHaveAttribute('src', 'https://img.test/a.jpg');
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.style.width).toBe('48px');
    expect(frame.style.height).toBe('48px');
  });

  it.each([[null], [undefined], ['']])('không có ảnh (%s) → khung placeholder, không có img và không lộ chữ alt', (src) => {
    const { container } = render(<ProductThumb src={src} alt="Tiêu đen" size={48} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.textContent).toBe('');
  });

  it('ảnh tải lỗi → đổi sang placeholder thay vì icon ảnh vỡ', () => {
    const { container } = render(<ProductThumb src="https://img.test/broken.jpg" alt="Tiêu đen" />);
    fireEvent.error(screen.getByAltText('Tiêu đen'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('đổi src sau khi lỗi → thử tải lại ảnh mới', () => {
    const { container, rerender } = render(<ProductThumb src="https://img.test/broken.jpg" alt="Tiêu đen" />);
    fireEvent.error(screen.getByAltText('Tiêu đen'));
    rerender(<ProductThumb src="https://img.test/ok.jpg" alt="Tiêu đen" />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://img.test/ok.jpg');
  });
});
