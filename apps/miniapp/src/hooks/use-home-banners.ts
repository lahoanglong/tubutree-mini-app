import { useEffect } from 'react';
import { writeBannerHint, type HomeKindState } from '@tubutree/app-core/home-layout';
import type { BannerSlide } from '../components/ui/banner-carousel';
import { browserStorage } from '../utils/recently-viewed';
import { useCampaignSlides } from './use-campaign-slides';

/**
 * Slide banner của Trang chủ. Gợi ý khung chờ chỉ ghi khi đã biết loại khách: lúc `unknown` chỉ thấy chiến dịch cho mọi người, ghi "0"
 * lúc đó sẽ làm lần mở sau của khách mới (thấy thêm chiến dịch dành riêng) nhảy trang.
 */
export function useHomeBanners(kind: HomeKindState): { slides: BannerSlide[]; loading: boolean } {
  const { slides, loading, loaded } = useCampaignSlides('HOME_TOP', kind);
  const has = slides.length > 0;
  useEffect(() => {
    if (loaded && kind !== 'unknown') writeBannerHint(browserStorage(), has);
  }, [loaded, kind, has]);
  return { slides, loading };
}
