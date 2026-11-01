import { lazy, Suspense } from 'react';
import { useHomeBanners } from '../../hooks/use-home-banners';

// Nạp lười: không có slide thì gói đầu không mang mã băng chuyền (autoplay, chấm, nút dừng).
const BannerCarousel = lazy(() => import('../ui/banner-carousel').then((m) => ({ default: m.BannerCarousel })));

/** Banner chiến dịch (khối `banner` của Trang chủ). Không có slide thì trả null: không khung chờ, không khoảng trống. */
export function HomeBanner() {
  const slides = useHomeBanners();
  if (slides.length === 0) return null;
  return (
    <Suspense fallback={null}>
      <div style={{ padding: '0 16px' }}>
        <BannerCarousel slides={slides} />
      </div>
    </Suspense>
  );
}
