'use client';

import { BannerCarousel, type BannerSlide } from '@/components/mini/banner-carousel';
import { trackWebEvent } from '@/lib/analytics';
import { Skeleton } from '@/components/mini';

/** `slide.id` là id chiến dịch; chỉ gửi id đó, không gửi đường dẫn hay tên. */
const trackBannerOpen = (slide: BannerSlide) => trackWebEvent('campaign_banner_click', { campaignId: slide.id });

/**
 * Khối `banner` của Trang chủ. Có slide thì vẽ băng chuyền; chưa có (đang tải mà lần mở trước máy này có banner) thì khung giữ chỗ đúng tỉ lệ
 * để banner về muộn không đẩy các khối dưới xuống. Khối không có chiến dịch không được dựng (HomeView trả null), nên không khung chờ, không khoảng trống.
 */
export function HomeBanner({ slides }: { slides: BannerSlide[] }) {
  if (slides.length > 0) return <BannerCarousel slides={slides} onOpen={trackBannerOpen} />;
  return (
    <div data-testid="home-banner-loading" aria-hidden="true">
      <Skeleton height="auto" radius="var(--radius-media)" style={{ aspectRatio: 'var(--banner-ratio)' }} />
    </div>
  );
}
