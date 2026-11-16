import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()) }));

import { Gallery, GallerySlide } from './product-detail';

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

describe('Gallery: video và ảnh theo phân loại (W181)', () => {
  const IMAGES = ['https://img.test/a.jpg', 'https://img.test/b.jpg', 'https://img.test/c.jpg'];
  const VIDEO = 'https://content.pancake.vn/clip.mp4';
  afterEach(() => vi.restoreAllMocks());

  it('video là ô cuối dải, có chấm riêng', () => {
    const { container } = render(<Gallery images={IMAGES} videos={[VIDEO]} alt="Tiêu" />);
    expect(screen.getAllByTestId('pdp-video')).toHaveLength(1);
    expect(container.querySelectorAll('img')).toHaveLength(3);
    const track = screen.getByRole('region', { name: 'Ảnh sản phẩm' });
    expect(track.lastElementChild).toBe(screen.getByTestId('pdp-video'));
    // 4 chấm (3 ảnh + 1 video).
    expect(container.querySelectorAll('[aria-hidden] > span')).toHaveLength(4);
  });

  it('URL video không phải http(s) bị bỏ', () => {
    render(<Gallery images={IMAGES} videos={['javascript:alert(1)', 'data:video/mp4;base64,AAAA']} alt="Tiêu" />);
    expect(screen.queryByTestId('pdp-video')).toBeNull();
  });

  it('chỉ có video: vẫn dựng ô video', () => {
    render(<Gallery images={[]} videos={[VIDEO]} alt="Tiêu" />);
    expect(screen.getByTestId('pdp-video')).toBeInTheDocument();
  });

  it('khách chọn phân loại có ảnh riêng: cuộn tới đúng ô ảnh đó; chưa chọn (focusSrc rỗng) thì không cuộn', () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 375 });
    const scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo;
    const { rerender } = render(<Gallery images={IMAGES} videos={[VIDEO]} alt="Tiêu" focusSrc={null} />);
    expect(scrollTo).not.toHaveBeenCalled();
    rerender(<Gallery images={IMAGES} videos={[VIDEO]} alt="Tiêu" focusSrc={IMAGES[2]} />);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: 2 * 375 }));
    scrollTo.mockClear();
    rerender(<Gallery images={IMAGES} videos={[VIDEO]} alt="Tiêu" focusSrc="https://img.test/ngoai-thu-vien.jpg" />);
    expect(scrollTo).not.toHaveBeenCalled();
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  });
});
