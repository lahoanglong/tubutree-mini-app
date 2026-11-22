import { HOME_COMBOS_LIMIT, fetchHomeCombos } from '@tubutree/app-core/api/bundle';
import { fetchCampaigns } from '@tubutree/app-core/api/campaign';
import { fetchUpcomingFlashSales } from '@tubutree/app-core/api/flash-sale';
import { fetchActiveFlashSalesNoSync } from '@/lib/server-flash';
import { fetchCategories } from '@tubutree/app-core/api/catalog';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { homeBestSellerQuery } from '@tubutree/app-core/queries/home';
import { vnDateSeed } from '@tubutree/app-core/home-suggest';
import type { HomeInitial } from '@/components/home/home-view';
import { createServerHttp } from '@/lib/core-http-server';

/** Phần phụ của trang: lỗi thì bỏ phần đó, để HomeView tự tải lại phía trình duyệt (và hiện khối lỗi + Thử lại nếu vẫn lỗi). */
const orUndefined = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);

/** Giữ lý do lỗi cho hai phần chính (Bán chạy, Danh mục): cả hai cùng lỗi nghĩa là API sập hẳn. */
const settle = <T,>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; reason: unknown }> =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (reason: unknown) => ({ ok: false as const, reason }),
  );

/** Bản dựng sẵn thiếu dữ liệu vì API chưa lên lúc `next build`: làm mới sau ngần này giây thay vì chờ hết 5 phút. */
export const BUILD_GAP_REVALIDATE_S = 10;

/** Giờ vàng đổi theo giờ và theo số suất còn: bản dựng sẵn giữ ngắn hơn 5 phút của phần còn lại. */
export const FLASH_REVALIDATE_S = 60;

/** Banner chiến dịch đổi khi admin bật/tắt: bản dựng sẵn giữ ngắn như Giờ vàng, để banner đã tắt không nằm trong HTML tới 5 phút. */
export const CAMPAIGN_REVALIDATE_S = 60;

/** Combo bật/tắt hay hết hạn theo giờ: bản dựng sẵn giữ ngắn như Giờ vàng, để combo đã tắt không nằm trong HTML (và không chiếm món của Bán chạy nhất) tới 5 phút. */
export const COMBO_REVALIDATE_S = 60;

/**
 * Dữ liệu công khai của Trang chủ cho trang ISR (bản thường và bản khôi phục phiên dùng chung). Mọi lệnh gọi chạy cùng một lượt.
 * Không tải trang 1 của lưới Gợi ý hay danh sách thương hiệu: HTML đầu không vẽ chúng (lưới dựng khi gần khung nhìn và tự tải theo
 * `suggestSeed`; thương hiệu không khối nào dùng).
 */
export async function loadHomeInitial(): Promise<HomeInitial> {
  const http = createServerHttp();
  // Cùng hạt giống ngày VN mà khách dùng ở client (HomeView lấy lại từ đây ở lần vẽ đầu): lưới Gợi ý tải sau hydrate vẫn đúng thứ tự trong ngày.
  const suggestSeed = vnDateSeed(Date.now());
  const combosAt = Date.now();
  const [best, cats, publicConfig, flash, flashUpcoming, campaigns, combos] = await Promise.all([
    settle(homeBestSellerQuery(http).queryFn()),
    settle(fetchCategories(http)),
    orUndefined(publicConfigQuery(http).queryFn()),
    orUndefined(fetchActiveFlashSalesNoSync(createServerHttp({ revalidate: FLASH_REVALIDATE_S }))),
    // Chỉ dùng số suất sắp mở (bản ẩn danh): đủ để HTML đầu biết hàng lối tắt có giữ lối vào Giờ vàng không. Danh sách và cờ nhắc của từng khách vẫn tải ở trình duyệt.
    orUndefined(fetchUpcomingFlashSales(createServerHttp({ revalidate: FLASH_REVALIDATE_S }))),
    orUndefined(fetchCampaigns(createServerHttp({ revalidate: CAMPAIGN_REVALIDATE_S }), 'HOME_TOP')),
    orUndefined(fetchHomeCombos(createServerHttp({ revalidate: COMBO_REVALIDATE_S }), HOME_COMBOS_LIMIT)),
  ]);
  // API sập hẳn lúc Next dựng lại trang (Bán chạy và Danh mục, hai lệnh độc lập, cùng lỗi): ném để Next giữ bản đã render thay vì lưu trang
  // không có sản phẩm tới hết 5 phút (cùng hành vi getListOrEmptyAtBuild). Riêng `next build` thường chạy khi API chưa lên: không ném, client tự tải lại.
  if (!best.ok && !cats.ok && process.env.NEXT_PHASE !== 'phase-production-build') throw best.reason;
  const bestSellers = best.ok ? best.value : undefined;
  const categories = cats.ok ? cats.value : undefined;
  if (process.env.NEXT_PHASE === 'phase-production-build' && [bestSellers, categories, publicConfig, flash, campaigns, combos].some((part) => part === undefined)) {
    // Next lấy hạn làm mới của trang từ hạn nhỏ nhất của các lệnh fetch trong lần dựng đó; lần dựng lại ở runtime có đủ dữ liệu trả hạn về 5 phút.
    await createServerHttp({ revalidate: BUILD_GAP_REVALIDATE_S }).get('/config/public').catch(() => undefined);
  }
  // Hết giờ rồi thì không đưa vào HTML: lần tải ngay sau đó sẽ không còn, khối biến mất và trang nhảy (combo hết hạn còn chiếm món của Bán chạy nhất).
  const liveFlash = flash?.filter((it) => new Date(it.endAt).getTime() > Date.now());
  const liveCampaigns = campaigns?.filter((c) => new Date(c.endAt).getTime() > Date.now());
  const liveCombos = combos?.filter((b) => new Date(b.endAt).getTime() > Date.now());
  return {
    bestSellers, suggestSeed, categories, publicConfig, flash: liveFlash, flashUpcomingCount: flashUpcoming?.length,
    campaigns: liveCampaigns, combos: liveCombos, combosAt: liveCombos ? combosAt : undefined,
  };
}
