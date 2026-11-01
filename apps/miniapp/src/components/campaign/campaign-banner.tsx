import { lazy, Suspense } from 'react';
import type { CampaignPlacement } from '@tubutree/app-core/api/campaign';
import type { HomeKindState } from '@tubutree/app-core/home-layout';
import { useCampaignSlides } from '../../hooks/use-campaign-slides';

// Cùng chunk với băng chuyền của Trang chủ; không có slide thì không tải mã này.
const BannerCarousel = lazy(() => import('../ui/banner-carousel').then((m) => ({ default: m.BannerCarousel })));

/** Banner đầu một trang con (Ưu đãi). Không có chiến dịch thì trả null: không khung chờ, không khoảng trống. */
export function CampaignBanner({ placement, kind }: { placement: CampaignPlacement; kind: HomeKindState }) {
  const { slides } = useCampaignSlides(placement, kind);
  if (slides.length === 0) return null;
  return (
    <Suspense fallback={null}>
      <div style={{ padding: '12px 16px 0' }}>
        <BannerCarousel slides={slides} />
      </div>
    </Suspense>
  );
}
