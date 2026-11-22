import { PrebuiltGuest } from '@/lib/auth-phase';
import { getStorefront, getStorefrontList } from '@/lib/api';
import { CtvGuestLanding } from '@/components/affiliate/ctv-guest-landing';
import CtvPage from './ctv-page';

/** Danh sách gian hàng đã đăng đổi chậm: bản dựng sẵn làm mới sau 5 phút như các trang công khai khác. */
export const revalidate = 300;

/** Số gian hàng đầu danh sách được đọc chi tiết khi chọn gian hàng cho nút: mỗi lượt làm mới chỉ gọi thêm vài request. */
const STORE_CANDIDATES = 3;

/**
 * Gian hàng CTV đang mở có hàng để khách xem thử. Danh sách công khai gồm mọi loại gian hàng (cả gian hàng chưa có món) và được cache 1 giờ,
 * nên đọc chi tiết từng ứng viên (cache 5 phút): gian hàng đã gỡ (404), không phải CTV, gian hàng mẫu hay chưa có món thì bỏ qua.
 */
async function openCtvStoreHref(): Promise<string | null> {
  const stores = await getStorefrontList().catch(() => []);
  const slugs = stores
    .map((s) => s.slug)
    .filter((slug): slug is string => typeof slug === 'string' && slug !== '')
    .slice(0, STORE_CANDIDATES);
  for (const slug of slugs) {
    const sf = await getStorefront(slug).catch(() => null);
    if (sf?.type === 'CTV' && !sf.isSample && sf.collections.some((c) => c.items.length > 0)) return `/s/${encodeURIComponent(slug)}`;
  }
  return null;
}

/**
 * `/ctv` dựng ở máy chủ màn giới thiệu Cộng tác viên, nên khách vãng lai (và công cụ tìm kiếm) có nội dung ngay trong HTML đầu thay vì khung chờ
 * đăng nhập. Nút "Xem một gian hàng đang mở" trỏ tới gian hàng CTV có hàng cập nhật gần nhất (`openCtvStoreHref`); API lỗi hay chưa có gian hàng
 * nào hợp lệ thì bỏ nút, trang vẫn dựng. `PrebuiltGuest` cho lượt vẽ đầu là khách; sau hydrate CTV đã đăng nhập chuyển sang bảng điều khiển.
 */
export default async function CtvRoute() {
  const storeHref = await openCtvStoreHref();
  return (
    <PrebuiltGuest>
      <CtvPage guestLanding={<CtvGuestLanding storeHref={storeHref} />} />
    </PrebuiltGuest>
  );
}
