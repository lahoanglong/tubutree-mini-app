import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PdpVideoSlide } from './pdp-video-slide';

const VIDEO = 'https://content.pancake.vn/clip.mp4';

afterEach(() => vi.restoreAllMocks());

describe('PdpVideoSlide (W181)', () => {
  it('chưa bấm: poster + nút phát, thẻ video preload none, playsInline, không tự phát, chưa có thanh điều khiển', () => {
    render(<PdpVideoSlide src={VIDEO} poster="https://img.test/a.jpg" name="Tiêu đen" active />);
    const video = screen.getByTestId('pdp-video').querySelector('video')!;
    expect(video.getAttribute('src')).toBe(VIDEO);
    expect(video.getAttribute('preload')).toBe('none');
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.hasAttribute('autoplay')).toBe(false);
    expect(video.hasAttribute('controls')).toBe(false);
    expect(video.getAttribute('poster')).toBe('https://img.test/a.jpg');
    expect(screen.getByTestId('pdp-video-play')).toHaveAttribute('aria-label', 'Phát video của Tiêu đen');
  });

  it('bấm nút phát: phát video, hiện thanh điều khiển, nút biến mất', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    render(<PdpVideoSlide src={VIDEO} poster={null} name="Tiêu đen" active />);
    fireEvent.click(screen.getByTestId('pdp-video-play'));
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('pdp-video').querySelector('video')).toHaveAttribute('controls');
    expect(screen.queryByTestId('pdp-video-play')).toBeNull();
  });

  it('cuộn sang ô khác khi đang phát: tạm dừng; chưa phát thì không đụng tới trình phát', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const { rerender } = render(<PdpVideoSlide src={VIDEO} poster={null} name="Tiêu đen" active />);
    rerender(<PdpVideoSlide src={VIDEO} poster={null} name="Tiêu đen" active={false} />);
    expect(pause).not.toHaveBeenCalled();
    rerender(<PdpVideoSlide src={VIDEO} poster={null} name="Tiêu đen" active />);
    fireEvent.click(screen.getByTestId('pdp-video-play'));
    rerender(<PdpVideoSlide src={VIDEO} poster={null} name="Tiêu đen" active={false} />);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('định dạng không hỗ trợ (NotSupportedError) hoặc lỗi tải: hiện câu báo, bỏ thẻ video', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(Object.assign(new Error('x'), { name: 'NotSupportedError' }));
    render(<PdpVideoSlide src={VIDEO} poster={null} name="Tiêu đen" active />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('pdp-video-play'));
    });
    expect(screen.getByTestId('pdp-video-failed')).toHaveTextContent('Không phát được video này.');
    expect(document.querySelector('video')).toBeNull();
  });

  it('lỗi tải video cũng báo hỏng', () => {
    render(<PdpVideoSlide src={VIDEO} poster={null} name="Tiêu đen" active />);
    fireEvent.error(document.querySelector('video')!);
    expect(screen.getByTestId('pdp-video-failed')).toBeInTheDocument();
  });

  it('chặn autoplay (NotAllowedError) thì không báo hỏng: vẫn có thanh điều khiển để khách bấm tiếp', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    render(<PdpVideoSlide src={VIDEO} poster={null} name="Tiêu đen" active />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('pdp-video-play'));
    });
    expect(screen.queryByTestId('pdp-video-failed')).toBeNull();
    expect(document.querySelector('video')).toHaveAttribute('controls');
  });
});

describe('css/pdp-video.css: số đo', () => {
  const css = readFileSync(resolve(__dirname, '../../css/pdp-video.css'), 'utf8');
  it('ô video cùng khung vuông với ảnh (1/1, cuộn bám giữa) để thêm video không làm trang nhảy', () => {
    expect(css).toMatch(/\.tubu-pdp-video\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/);
    expect(css).toMatch(/\.tubu-pdp-video\s*\{[^}]*flex:\s*0 0 100%/);
    expect(css).toMatch(/\.tubu-pdp-video\s*\{[^}]*scroll-snap-align:\s*center/);
  });
  it('nút phát 56px, không dưới 44px', () => {
    const rule = css.match(/\.tubu-pdp-video__play\s*\{([^}]*)\}/)![1]!;
    expect(rule).toMatch(/width:\s*56px/);
    expect(rule).toMatch(/height:\s*56px/);
    expect(rule).toMatch(/min-width:\s*44px/);
    expect(rule).toMatch(/min-height:\s*44px/);
  });
});

describe('PdpVideoSlide onPlay', () => {
  it('chạy một lần khi khách bấm nút phát', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const onPlay = vi.fn();
    render(<PdpVideoSlide src={VIDEO} poster={null} name="Tiêu đen" active onPlay={onPlay} />);
    expect(onPlay).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('pdp-video-play'));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});
