import { lazy, Suspense, useEffect, useState } from 'react';
import type { CampaignPlacement } from '@tubutree/app-core/api/campaign';
import { OFFERS_BANNER_HINT_KEY, readBannerHint, writeBannerHint, type HomeKindState } from '@tubutree/app-core/home-layout';
import { useCampaignSlides } from '../../hooks/use-campaign-slides';
import { browserStorage } from '../../utils/recently-viewed';
import { Skeleton } from '../ui/skeleton';

// Cùng chunk với băng chuyền của Trang chủ; không có slide thì không tải mã này.
const BannerCarousel = lazy(() => import('../ui/banner-carousel').then((m) => ({ default: m.BannerCarousel })));

/** Mỗi vị trí banner có gợi ý riêng: dùng chung khoá với Trang chủ thì khung chờ Ưu đãi hiện rồi biến mất khi chỉ Trang chủ có banner. */
const HINT_KEY: Partial<Record<CampaignPlacement, string>> = { OFFERS_TOP: OFFERS_BANNER_HINT_KEY };
const FRAME_PADDING = '12px 16px 0';

/** Khung giữ chỗ đúng tỉ lệ banner (cùng cách của Trang chủ): chiều cao theo bề rộng nên không lệch ở mọi cỡ màn hình. */
function BannerFrame() {
  return (
    <div data-testid="offers-banner-loading" aria-hidden="true" style={{ padding: FRAME_PADDING }}>
      <Skeleton height="auto" radius="var(--radius-media)" style={{ aspectRatio: 'var(--banner-ratio)' }} />
    </div>
  );
}

/**
 * Banner đầu một trang con (Ưu đãi). Không có chiến dịch thì trả null: không khoảng trống. Chỉ giữ chỗ lúc tải khi lần mở trước máy này có
 * banner ở vị trí này, để banner về muộn không đẩy các khối dưới xuống. Gợi ý chỉ ghi khi đã biết loại khách: lúc `unknown` chỉ thấy chiến
 * dịch cho mọi người, ghi "0" lúc đó sẽ làm lần mở sau của khách mới (thấy thêm chiến dịch dành riêng) nhảy trang.
 */
export function CampaignBanner({ placement, kind }: { placement: CampaignPlacement; kind: HomeKindState }) {
  const { slides, loading, loaded } = useCampaignSlides(placement, kind);
  const hintKey = HINT_KEY[placement];
  const [hinted] = useState(() => (hintKey ? readBannerHint(browserStorage(), hintKey) : false));
  const has = slides.length > 0;
  useEffect(() => {
    if (hintKey && loaded && kind !== 'unknown') writeBannerHint(browserStorage(), has, hintKey);
  }, [hintKey, loaded, kind, has]);
  if (!has) return loading && hinted ? <BannerFrame /> : null;
  return (
    <Suspense fallback={hinted ? <BannerFrame /> : null}>
      <div style={{ padding: FRAME_PADDING }}>
        <BannerCarousel slides={slides} />
      </div>
    </Suspense>
  );
}
