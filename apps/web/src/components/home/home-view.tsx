import type { BestSellersPage } from '@tubutree/app-core/api/browse';
import type { BundleDTO } from '@tubutree/app-core/api/bundle';
import type { CategoryDTO, PageResponse, ProductCard } from '@tubutree/app-core/api/catalog';
import type { CampaignBanner } from '@tubutree/app-core/api/campaign';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import type { FlashSaleActiveItem } from '@tubutree/app-core/api/flash-sale';
import type { HomeRestoreHint } from '@/lib/home-restore-hint';
import HomeViewClient from './home-view-client';

/** Phần công khai server đã tải cho trang ISR: có trong HTML đầu, React Query tiếp quản sau hydrate. */
export interface HomeInitial {
  bestSellers?: BestSellersPage;
  /** Trang 1 của lưới gợi ý (chip "Tất cả"), xếp theo `suggestSeed`. Máy chủ không tải (`loadHomeInitial`) và không gửi xuống client (xem `homeClientInitial`): lưới tự tải khi gần khung nhìn. */
  suggest?: PageResponse<ProductCard>;
  /** Hạt giống ngày VN lúc dựng trang: client dùng lại đúng hạt giống này để lưới Gợi ý và thẻ chen không đổi thứ tự trong cả lần mở. */
  suggestSeed?: string;
  categories?: CategoryDTO[];
  /** Cấu hình công khai: dải Quà khách mới của khách vãng lai có ngay trong HTML server, cao đúng 64px (không hiện sau hydrate làm Danh mục nhảy). */
  publicConfig?: PublicConfig;
  /** Suất Giờ vàng đang chạy lúc dựng trang: có trong HTML đầu nên khối không chen vào sau hydrate làm cả trang nhảy. */
  flash?: FlashSaleActiveItem[];
  /** Số suất Giờ vàng sắp mở lúc dựng trang (bản ẩn danh): cùng `flash`, HTML đầu đã biết hàng lối tắt có giữ lối vào Giờ vàng không. */
  flashUpcomingCount?: number;
  /** Banner chiến dịch đang chạy lúc dựng trang: có trong HTML đầu nên khối không chen vào sau hydrate. Rỗng nghĩa là server đã hỏi và không có. */
  campaigns?: CampaignBanner[];
  /** Combo toàn sàn đang chạy lúc dựng trang: có trong HTML đầu nên kệ không chen vào sau hydrate, và Bán chạy nhất bỏ món của combo ngay trong HTML. Rỗng nghĩa là server đã hỏi và không có. */
  combos?: BundleDTO[];
  /** Lúc máy chủ lấy `combos` (ms): để hydrate hỏi lại ngay khi HTML ISR đã cũ hơn hạn tươi. */
  combosAt?: number;
}

/**
 * Phần `initial` gửi xuống client. Mọi prop của thành phần client được chép nguyên vào dữ liệu RSC nằm trong HTML, nên bỏ phần HTML đầu không vẽ:
 * lưới Gợi ý dựng khi gần tới khung nhìn và tự tải trang 1 (cùng `suggestSeed` nên cùng thứ tự).
 */
export function homeClientInitial(initial: HomeInitial): HomeInitial {
  const slim = { ...initial };
  delete slim.suggest;
  return slim;
}

/** Trang chủ web (vỏ server): thân trang là `HomeViewClient`. */
export default function HomeView({ initial = {}, restoreHint = null }: { initial?: HomeInitial; /** Bản dựng sẵn cho khách đã có cookie phiên: HTML đầu mang khung chờ của loại khách này. */ restoreHint?: HomeRestoreHint | null }) {
  return <HomeViewClient initial={homeClientInitial(initial)} restoreHint={restoreHint} />;
}
