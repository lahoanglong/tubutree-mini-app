// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@/components/mini/harness';
import { PdpSelectionProvider, usePdpSelection } from './pdp-selection';
import ProductGallery from './product-gallery';

const LEAF = 'M14 36c-1.5-14 8-26 24-27 1 16-7 27-20 28-2 .2-3.4-.4-4-1z';

describe('ProductGallery: ảnh lỗi tải rơi về hình lá chung (B-23)', () => {
  it('ảnh lớn lỗi thì hiện LeafGlyph thay icon ảnh vỡ', () => {
    const { container } = mount(<ProductGallery images={['https://img.test/hong.jpg']} name="Tiêu đen" />);
    const img = container.querySelector('img')!;
    act(() => {
      img.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('path')!.getAttribute('d')).toBe(LEAF);
  });

  it('không có ảnh: cũng hình lá chung', () => {
    const { container } = mount(<ProductGallery images={[]} name="Tiêu đen" />);
    expect(container.querySelector('path')!.getAttribute('d')).toBe(LEAF);
  });
});

describe('ProductGallery: video sản phẩm (W181)', () => {
  const IMAGES = ['https://img.test/a.jpg', 'https://img.test/b.jpg'];
  const VIDEO = 'https://content.pancake.vn/clip.mp4';

  it('video là ô cuối dải: thẻ video không tự phát, preload none, playsInline, chưa có thanh điều khiển', () => {
    const { container } = mount(<ProductGallery images={IMAGES} videos={[VIDEO]} name="Tiêu đen" />);
    const video = container.querySelector('video')!;
    expect(video.getAttribute('src')).toBe(VIDEO);
    expect(video.getAttribute('preload')).toBe('none');
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.hasAttribute('autoplay')).toBe(false);
    expect(video.hasAttribute('controls')).toBe(false);
    expect(video.getAttribute('poster')).toBe(IMAGES[0]);
    // Ô video đứng sau mọi ảnh và có chấm riêng: 3 ô, 3 chấm.
    expect(container.querySelectorAll('[aria-roledescription="slide"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-testid="gallery-dots"] > span')).toHaveLength(3);
  });

  it('nút phát ≥ 44px: bấm thì phát và hiện thanh điều khiển, nút biến mất', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { container } = mount(<ProductGallery images={IMAGES} videos={[VIDEO]} name="Tiêu đen" />);
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="Phát video của Tiêu đen"]')!;
    expect(btn.className).toContain('h-14');
    expect(btn.className).toContain('w-14');
    act(() => btn.click());
    expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelector('video')!.hasAttribute('controls')).toBe(true);
    expect(container.querySelector('button[aria-label="Phát video của Tiêu đen"]')).toBeNull();
    play.mockRestore();
  });

  it('video hỏng (lỗi tải/định dạng): hiện câu báo, không còn thẻ video', () => {
    const { container } = mount(<ProductGallery images={IMAGES} videos={[VIDEO]} name="Tiêu đen" />);
    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('video')).toBeNull();
    expect(container.textContent).toContain('Không phát được video này.');
  });

  it('URL video không phải http(s) bị bỏ: không dựng thẻ video', () => {
    const { container } = mount(<ProductGallery images={IMAGES} videos={['javascript:alert(1)', 'data:video/mp4;base64,AAAA', '/rel.mp4']} name="Tiêu đen" />);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelectorAll('[aria-roledescription="slide"]')).toHaveLength(2);
  });

  it('chỉ có video, không có ảnh: vẫn có ô video (không rơi về hình lá)', () => {
    const { container } = mount(<ProductGallery images={[]} videos={[VIDEO]} name="Tiêu đen" />);
    expect(container.querySelector('video')).not.toBeNull();
    expect(container.querySelector('video')!.hasAttribute('poster')).toBe(false);
  });

  it('dải ảnh nhỏ (từ md) có nút xem video', () => {
    const { container } = mount(<ProductGallery images={IMAGES} videos={[VIDEO]} name="Tiêu đen" />);
    const strip = container.querySelectorAll('ul[aria-label="Chọn ảnh"] button');
    expect(strip).toHaveLength(3);
    expect(strip[2]!.getAttribute('aria-label')).toBe('Xem video');
  });

  it('không có video: giữ nguyên như trước (không thẻ video)', () => {
    const { container } = mount(<ProductGallery images={IMAGES} name="Tiêu đen" />);
    expect(container.querySelector('video')).toBeNull();
  });
});

describe('ProductGallery: chọn biến thể thì ảnh chính đổi (W181)', () => {
  const IMAGES = ['https://img.test/a.jpg', 'https://img.test/b.jpg', 'https://img.test/c.jpg'];
  const VARS = { v1: IMAGES[0]!, v2: IMAGES[2]! };

  function Harness({ pick }: { pick: boolean }) {
    return (
      <PdpSelectionProvider initialId="v1">
        <ProductGallery images={IMAGES} name="Tiêu đen" variationImages={VARS} />
        <Picker pick={pick} />
      </PdpSelectionProvider>
    );
  }
  function Picker({ pick }: { pick: boolean }) {
    const sel = usePdpSelection()!;
    return (
      <button
        type="button"
        data-testid="pick-v2"
        onClick={() => {
          if (pick) sel.userPicked.current = true;
          sel.setSelectedId('v2');
        }}
      />
    );
  }
  const activeThumb = (c: HTMLElement) => [...c.querySelectorAll('ul[aria-label="Chọn ảnh"] button')].findIndex((b) => b.getAttribute('aria-pressed') === 'true');

  it('khách chọn biến thể có ảnh riêng: thư viện nhảy tới ảnh đó', () => {
    const { container } = mount(<Harness pick />);
    expect(activeThumb(container)).toBe(0);
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="pick-v2"]')!.click());
    expect(activeThumb(container)).toBe(2);
  });

  it('biến thể đổi mà khách chưa tự chọn (tồn kho/Giờ vàng về muộn): thư viện đứng yên', () => {
    const { container } = mount(<Harness pick={false} />);
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="pick-v2"]')!.click());
    expect(activeThumb(container)).toBe(0);
  });

  it('lúc mở trang với biến thể mặc định có ảnh riêng: không nhảy', () => {
    function Start() {
      return (
        <PdpSelectionProvider initialId="v2">
          <ProductGallery images={IMAGES} name="Tiêu đen" variationImages={VARS} />
        </PdpSelectionProvider>
      );
    }
    const { container } = mount(<Start />);
    expect(activeThumb(container)).toBe(0);
  });
});
