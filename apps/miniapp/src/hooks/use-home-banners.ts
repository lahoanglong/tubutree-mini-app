import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { campaignSlides } from '@tubutree/app-core/commerce/campaign';
import { writeBannerHint, type HomeKindState } from '@tubutree/app-core/home-layout';
import type { BannerSlide } from '../components/ui/banner-carousel';
import { fetchHomeCampaigns } from '../services/campaign-api';
import { serverNow } from '../utils/server-clock';
import { browserStorage } from '../utils/recently-viewed';

/**
 * Slide banner của Trang chủ theo loại khách. Lỗi tải là "không có banner": khối ẩn hẳn, không báo lỗi cho một thứ khách không cần.
 * Gợi ý khung chờ chỉ ghi khi đã biết loại khách: lúc `unknown` chỉ thấy chiến dịch cho mọi người, ghi "0" lúc đó sẽ làm lần mở sau
 * của khách mới (thấy thêm chiến dịch dành riêng) nhảy trang.
 */
export function useHomeBanners(kind: HomeKindState): { slides: BannerSlide[]; loading: boolean } {
  const q = useQuery({ queryKey: ['campaigns', 'HOME_TOP'], queryFn: fetchHomeCampaigns, staleTime: 60_000, retry: false });
  const slides = useMemo(() => campaignSlides(q.data, { kind, platform: 'mini', now: serverNow() }), [q.data, kind]);
  const has = slides.length > 0;
  useEffect(() => {
    if (q.isSuccess && kind !== 'unknown') writeBannerHint(browserStorage(), has);
  }, [q.isSuccess, kind, has]);
  return { slides, loading: q.isLoading };
}
