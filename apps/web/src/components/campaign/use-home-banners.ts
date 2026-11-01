'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { CampaignBanner } from '@tubutree/app-core/api/campaign';
import { readBannerHint, writeBannerHint, type HomeKindState } from '@tubutree/app-core/home-layout';
import { browserStorage } from '@/lib/recently-viewed';
import type { BannerSlide } from '@/components/mini/banner-carousel';
import { useCampaignSlides } from './use-campaign-slides';

const subscribeNothing = () => () => {};

/**
 * Slide banner của Trang chủ và gợi ý "lần mở trước máy này có banner" (chỉ để giữ chỗ khi banner chưa về). Gợi ý chỉ ghi khi đã biết loại khách:
 * lúc `unknown` chỉ thấy chiến dịch cho mọi người, ghi "0" lúc đó làm lần mở sau của khách mới (thấy thêm chiến dịch dành riêng) nhảy trang.
 * Đọc gợi ý bằng useSyncExternalStore: HTML server không có kho nên bản server là "chưa nhớ".
 */
export function useHomeBanners(kind: HomeKindState, initial?: CampaignBanner[]): { slides: BannerSlide[]; loading: boolean; hinted: boolean } {
  const { slides, loading, loaded } = useCampaignSlides('HOME_TOP', kind, initial);
  const hinted = useSyncExternalStore(subscribeNothing, () => readBannerHint(browserStorage()), () => false);
  const has = slides.length > 0;
  useEffect(() => {
    if (loaded && kind !== 'unknown') writeBannerHint(browserStorage(), has);
  }, [loaded, kind, has]);
  return { slides, loading, hinted };
}
