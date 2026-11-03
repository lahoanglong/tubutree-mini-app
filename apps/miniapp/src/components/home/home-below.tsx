// Một chunk chung cho các khối Trang chủ nằm dưới màn đầu, để entry không gánh mã của chúng.
export { BrandJourney } from './brand-journey';
export { CommunityPreview } from './community-preview';
export { SuggestFeed } from './suggest-feed';

import { useScrollRestoration } from '../../hooks/use-scroll-restoration';

/**
 * Giữ vị trí cuộn Trang chủ (Back từ PDP). Nằm trong chunk này để hook cuộn (cùng mã khôi phục) không vào gói đầu; chunk được tải ngay khi
 * mã Trang chủ chạy nên lúc Back nó đã có sẵn. Tự vẽ phần tử neo (`.zaui-page` là cha trực tiếp của nó).
 */
export function HomeScrollRestoration({ ready }: { ready: boolean }) {
  const { anchorRef } = useScrollRestoration('home', ready);
  return <div ref={anchorRef} />;
}
