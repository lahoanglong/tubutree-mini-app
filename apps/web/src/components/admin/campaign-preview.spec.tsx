// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';

const carousel = vi.hoisted(() => vi.fn());
vi.mock('@/components/mini/banner-carousel', async (orig) => {
  const real = await orig<typeof import('@/components/mini/banner-carousel')>();
  return {
    ...real,
    BannerCarousel: (props: { slides: { id: string; image: string; alt: string; href: string }[]; sizes?: string }) => {
      carousel(props);
      return real.BannerCarousel(props);
    },
  };
});

import { CampaignPreview } from './campaign-preview';
import { WIDE_BANNER_RATIO } from '@/components/campaign/campaign-banner';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  carousel.mockClear();
});
const show = (over: Partial<Parameters<typeof CampaignPreview>[0]> = {}) => {
  mounted = render(<CampaignPreview image="https://img.test/a.jpg" title="Giữa Thu" subtitle="Giảm 20%" placement="HOME_TOP" {...over} />);
  return mounted.container;
};

describe('CampaignPreview', () => {
  it('hai khung "Điện thoại 375px" và "Máy tính", mỗi khung dựng bằng BannerCarousel thật với ảnh và tiêu đề của form', () => {
    const c = show();
    expect(c.textContent).toContain('Điện thoại 375px');
    expect(c.textContent).toContain('Máy tính');
    expect(carousel).toHaveBeenCalledTimes(2);
    for (const [props] of carousel.mock.calls) {
      expect(props.slides).toEqual([{ id: 'preview', image: 'https://img.test/a.jpg', alt: 'Giữa Thu', href: '#' }]);
    }
    expect(c.querySelectorAll('section[aria-roledescription="carousel"]')).toHaveLength(2);
    expect(c.querySelectorAll('img[src="https://img.test/a.jpg"]')).toHaveLength(2);
  });

  it('khung điện thoại rộng 375px', () => {
    const c = show();
    const phone = c.querySelector<HTMLElement>('[data-testid="campaign-preview-phone"]')!;
    expect(phone.className).toContain('w-[375px]');
  });

  it('tỉ lệ khung: Đầu Trang chủ giữ 5/2 ở cả hai khung; Đầu Ưu đãi máy tính đổi sang khung rộng như khách thấy từ lg', () => {
    const home = show();
    expect(home.querySelector<HTMLElement>('[data-testid="campaign-preview-desktop"]')!.style.getPropertyValue('--banner-ratio')).toBe('');
    mounted?.unmount();
    const offers = show({ placement: 'OFFERS_TOP' });
    expect(offers.querySelector<HTMLElement>('[data-testid="campaign-preview-desktop"]')!.style.getPropertyValue('--banner-ratio')).toBe(WIDE_BANNER_RATIO);
    expect(offers.querySelector<HTMLElement>('[data-testid="campaign-preview-phone"]')!.style.getPropertyValue('--banner-ratio')).toBe('');
  });

  it('hiện tiêu đề và phụ đề dưới khung; chưa có tên thì dùng chữ mặc định', () => {
    const c = show();
    expect(c.querySelector('[data-testid="campaign-preview-caption"]')!.textContent).toContain('Giữa Thu');
    expect(c.querySelector('[data-testid="campaign-preview-caption"]')!.textContent).toContain('Giảm 20%');
    mounted?.unmount();
    const blank = show({ title: '  ', subtitle: '' });
    expect(blank.querySelector('[data-testid="campaign-preview-caption"]')!.textContent).toContain('Chưa có tên');
  });

  it('chưa có ảnh: nhắc chọn ảnh, không dựng băng chuyền', () => {
    const c = show({ image: '' });
    expect(c.textContent).toContain('Chọn ảnh để xem trước');
    expect(carousel).not.toHaveBeenCalled();
  });

  it('bấm vào banner xem trước không rời trang admin', () => {
    const c = show();
    const link = c.querySelector<HTMLAnchorElement>('a')!;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
