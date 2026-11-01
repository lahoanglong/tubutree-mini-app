import { lazy, Suspense, useState } from 'react';
import { readBannerHint, type HomeKindState } from '@tubutree/app-core/home-layout';
import { useHomeBanners } from '../../hooks/use-home-banners';
import { browserStorage } from '../../utils/recently-viewed';
import { Skeleton } from '../ui/skeleton';

// Nạp lười: không có slide thì gói đầu không mang mã băng chuyền (autoplay, chấm, nút dừng).
const BannerCarousel = lazy(() => import('../ui/banner-carousel').then((m) => ({ default: m.BannerCarousel })));

/** Khung giữ chỗ đúng tỉ lệ banner: chiều cao theo bề rộng nên không lệch ở mọi cỡ màn hình. */
function BannerFrame() {
  return (
    <div data-testid="home-banner-loading" aria-hidden="true" style={{ padding: '0 16px' }}>
      <Skeleton height="auto" radius="var(--radius-media)" style={{ aspectRatio: 'var(--banner-ratio)' }} />
    </div>
  );
}

/**
 * Banner chiến dịch (khối `banner` của Trang chủ). Không có chiến dịch thì trả null: không khung chờ, không khoảng trống. Chỉ giữ chỗ khi lần mở
 * trước máy này có banner (gợi ý `tubu_home_banner`), để banner về muộn không đẩy các khối dưới xuống.
 */
export function HomeBanner({ kind }: { kind: HomeKindState }) {
  const { slides, loading } = useHomeBanners(kind);
  const [hinted] = useState(() => readBannerHint(browserStorage()));
  if (slides.length > 0) {
    return (
      <Suspense fallback={<BannerFrame />}>
        <div style={{ padding: '0 16px' }}>
          <BannerCarousel slides={slides} />
        </div>
      </Suspense>
    );
  }
  return loading && hinted ? <BannerFrame /> : null;
}
