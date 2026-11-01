'use client';

import type { CampaignPlacement } from '@tubutree/app-core/api/campaign';
import type { HomeKindState } from '@tubutree/app-core/home-layout';
import { BannerCarousel } from '@/components/mini/banner-carousel';
import { useCampaignSlides } from './use-campaign-slides';

/** Banner đầu một trang con (Ưu đãi). Không có chiến dịch thì trả null: không khung chờ, không khoảng trống. */
export function CampaignBanner({ placement, kind }: { placement: CampaignPlacement; kind: HomeKindState }) {
  const { slides } = useCampaignSlides(placement, kind);
  if (slides.length === 0) return null;
  return (
    <div data-offers-banner="" className="mt-3">
      <BannerCarousel slides={slides} />
    </div>
  );
}
