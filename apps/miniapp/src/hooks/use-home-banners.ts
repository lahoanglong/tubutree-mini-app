import type { BannerSlide } from '../components/ui/banner-carousel';

const NONE: BannerSlide[] = [];

/** Slide banner của Trang chủ. P11 nối chiến dịch đang chạy; tới lúc đó không có slide nào nên Trang chủ không giữ chỗ banner. */
export function useHomeBanners(): BannerSlide[] {
  return NONE;
}
