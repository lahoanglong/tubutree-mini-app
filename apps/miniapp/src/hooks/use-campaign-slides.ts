import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCampaigns, type CampaignPlacement } from '@tubutree/app-core/api/campaign';
import { campaignSlides } from '@tubutree/app-core/commerce/campaign';
import type { HomeKindState } from '@tubutree/app-core/home-layout';
import type { BannerSlide } from '../components/ui/banner-carousel';
import { fetchHomeCampaigns } from '../services/campaign-api';
import { coreHttp } from '../services/core-http';
import { serverNow } from '../utils/server-clock';

/**
 * Slide banner của một vị trí theo loại khách. Lỗi tải là "không có banner": khối ẩn hẳn, không báo lỗi cho thứ khách không cần.
 * Trang chủ lấy lần đầu từ request gộp `/home`; vị trí khác gọi thẳng `/campaigns`.
 */
export function useCampaignSlides(placement: CampaignPlacement, kind: HomeKindState): { slides: BannerSlide[]; loading: boolean; loaded: boolean } {
  const q = useQuery({
    queryKey: ['campaigns', placement],
    queryFn: placement === 'HOME_TOP' ? fetchHomeCampaigns : () => fetchCampaigns(coreHttp, placement),
    staleTime: 60_000,
    retry: false,
  });
  const slides = useMemo(() => campaignSlides(q.data, { kind, platform: 'mini', now: serverNow() }), [q.data, kind]);
  return { slides, loading: q.isLoading, loaded: q.isSuccess };
}
