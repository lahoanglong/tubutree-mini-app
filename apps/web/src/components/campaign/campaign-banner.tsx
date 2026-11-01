'use client';

import { useEffect, useState } from 'react';
import type { CampaignPlacement } from '@tubutree/app-core/api/campaign';
import { OFFERS_BANNER_HINT_KEY, readBannerHint, writeBannerHint, type HomeKindState } from '@tubutree/app-core/home-layout';
import { Skeleton } from '@/components/mini';
import { BannerCarousel } from '@/components/mini/banner-carousel';
import { browserStorage } from '@/lib/recently-viewed';
import { useCampaignSlides } from './use-campaign-slides';

/** Mỗi vị trí banner có gợi ý riêng: dùng chung khoá với Trang chủ thì khung chờ Ưu đãi hiện rồi biến mất khi chỉ Trang chủ có banner. */
const HINT_KEY: Partial<Record<CampaignPlacement, string>> = { OFFERS_TOP: OFFERS_BANNER_HINT_KEY };

// Từ lg bề rộng nội dung ~1152px: tỉ lệ điện thoại 5/2 cho banner cao 460px, che gần hết màn hình laptop (P2 #37). 4/1 cho ~288px. Ghi đè ngay ở khung banner
// Ưu đãi (không đụng `--banner-ratio` toàn cục của Trang chủ và điện thoại); khung chờ và banner thật cùng lớp để không nhảy khi tải.
const WIDE_RATIO = 'lg:[--banner-ratio:4/1]';

/** Khung giữ chỗ đúng tỉ lệ banner (cùng cách của Trang chủ): chiều cao theo bề rộng nên không lệch ở mọi cỡ màn hình. */
function BannerFrame() {
  return (
    <div data-testid="offers-banner-loading" aria-hidden="true" className={WIDE_RATIO}>
      <Skeleton height="auto" radius="var(--radius-media)" style={{ aspectRatio: 'var(--banner-ratio)' }} />
    </div>
  );
}

/**
 * Banner đầu một trang con (Ưu đãi). Không có chiến dịch thì trả null: không khoảng trống. Chỉ giữ chỗ lúc tải khi lần mở trước máy này có
 * banner ở vị trí này, để banner về muộn không đẩy các khối dưới xuống. Gợi ý chỉ ghi khi đã biết loại khách: lúc `unknown` chỉ thấy chiến
 * dịch cho mọi người, ghi "0" lúc đó sẽ làm lần mở sau của khách mới (thấy thêm chiến dịch dành riêng) nhảy trang. Khoảng cách với khối kế
 * do trang cha lo (cột `gap`), banner không tự đệm.
 */
export function CampaignBanner({ placement, kind }: { placement: CampaignPlacement; kind: HomeKindState }) {
  const { slides, loading, loaded } = useCampaignSlides(placement, kind);
  const hintKey = HINT_KEY[placement];
  // Trang Ưu đãi chỉ dựng ở máy khách (useSearchParams bắt Suspense), nên đọc kho ngay lúc dựng không lệch với HTML server.
  const [hinted] = useState(() => (hintKey ? readBannerHint(browserStorage(), hintKey) : false));
  const has = slides.length > 0;
  useEffect(() => {
    if (hintKey && loaded && kind !== 'unknown') writeBannerHint(browserStorage(), has, hintKey);
  }, [hintKey, loaded, kind, has]);
  if (!has) return loading && hinted ? <BannerFrame /> : null;
  return (
    <div data-offers-banner="" className={WIDE_RATIO}>
      <BannerCarousel slides={slides} />
    </div>
  );
}
