// Một chunk chung cho các khối Trang chủ nằm dưới màn đầu, để entry không gánh mã của chúng.
export { CommunityPreview } from './community-preview';
export { GreenCornerStrip } from './green-corner-strip';
export { SuggestFeed } from './suggest-feed';
export { HomeQuiz } from './home-quiz';
// Dải Story kéo theo cả bộ dựng câu chuyện sản phẩm (preset, sprite, câu chuyện thương hiệu) mà trang chi tiết cũng dùng: để ở đây thì entry không gánh nó.
export { HomeStoryReel } from './home-story-reel';
// Kệ Mua lại (dải "Mua lại món quen", dòng một món, nút "Báo khi có") chỉ vẽ cho khách cũ đã đăng nhập: khách mới và khách chưa đăng nhập không tải mã của nó.
export { PurchasedRail } from '../reorder/purchased-rail';

import { useScrollRestoration } from '../../hooks/use-scroll-restoration';

/**
 * Giữ vị trí cuộn Trang chủ (Back từ PDP). Nằm trong chunk này để hook cuộn (cùng mã khôi phục) không vào gói đầu; chunk được tải ngay khi
 * mã Trang chủ chạy nên lúc Back nó đã có sẵn. Tự vẽ phần tử neo (`.zaui-page` là cha trực tiếp của nó).
 */
export function HomeScrollRestoration({ ready }: { ready: boolean }) {
  const { anchorRef } = useScrollRestoration('home', ready);
  return <div ref={anchorRef} />;
}
