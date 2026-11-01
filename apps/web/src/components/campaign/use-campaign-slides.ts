'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CampaignBanner, CampaignPlacement } from '@tubutree/app-core/api/campaign';
import { campaignSlides } from '@tubutree/app-core/commerce/campaign';
import type { HomeKindState } from '@tubutree/app-core/home-layout';
import { campaignsQuery } from '@tubutree/app-core/queries/campaign';
import { serverNow } from '@tubutree/app-core/server-clock';
import { coreHttp } from '@/lib/core-http';
import { useHydrated } from '@/lib/use-hydrated';
import type { BannerSlide } from '@/components/mini/banner-carousel';

const STALE = 60_000;

/**
 * Slide banner của một vị trí theo loại khách. Lỗi tải là "không có banner": khối ẩn hẳn, không báo lỗi cho thứ khách không cần.
 * `initial` là bản server dựng sẵn (Trang chủ); bỏ lịch ở lượt hydrate đầu để khớp HTML server, sau đó lọc theo giờ máy khách.
 */
export function useCampaignSlides(
  placement: CampaignPlacement,
  kind: HomeKindState,
  initial?: CampaignBanner[],
): { slides: BannerSlide[]; loading: boolean; loaded: boolean } {
  const q = useQuery({
    ...campaignsQuery(coreHttp, placement),
    staleTime: STALE,
    retry: false,
    ...(initial ? { initialData: initial } : {}),
  });
  const hydrated = useHydrated();
  const slides = useMemo(() => campaignSlides(q.data, { kind, platform: 'web', now: hydrated ? serverNow() : undefined }), [q.data, kind, hydrated]);
  return { slides, loading: q.isLoading, loaded: q.isSuccess };
}
