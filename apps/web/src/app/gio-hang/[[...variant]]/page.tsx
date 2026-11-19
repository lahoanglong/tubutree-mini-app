import { notFound } from 'next/navigation';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { suggestedRailQuery } from '@tubutree/app-core/queries/catalog';
import { matcherStatusQuery } from '@tubutree/app-core/game-mini/matcher-status';
import { QuerySeed, type QuerySeedEntry } from '@/components/query-seed';
import { PrebuiltGuest } from '@/lib/auth-phase';
import { createServerHttp } from '@/lib/core-http-server';
import CartPage from '../cart-page';

// Ngắn để tắt cờ giỏ khách tới khách mới nhanh: cấu hình nạp sẵn mang mốc lấy của bản ISR, còn tươi thêm staleTime của usePublicConfig.
export const revalidate = 60;
export const dynamicParams = false;

/**
 * Hai bản tĩnh của /gio-hang trong MỘT route (thêm route riêng làm webpack chia lại chunk dùng chung, JS tải lần đầu của các trang khác tăng):
 * - `/gio-hang`: bản thường, khung chờ tới khi phiên khôi phục xong.
 * - `/gio-hang/khach`: bản dựng sẵn cho khách chưa có phiên và giỏ khách trống (middleware viết lại, URL trình duyệt vẫn /gio-hang; vào thẳng thì
 *   308 về /gio-hang; xem lib/guest-prebuilt.ts). HTML đầu đã có giỏ trống và kệ gợi ý kèm ảnh nhờ cấu hình công khai (cờ giỏ khách) và kệ
 *   lấy sẵn ở đây, thay vì khung chờ đăng nhập rồi ba lượt gọi mạng sau khi JS chạy. Lấy kệ hay cờ matcher lỗi thì bỏ khối đó: trình duyệt tự tải như bản thường.
 * Tiêu đề và noindex lấy từ layout của /gio-hang.
 */
export function generateStaticParams() {
  return [{ variant: [] }, { variant: ['khach'] }];
}

export default async function CartRoute({ params }: { params: Promise<{ variant?: string[] }> }) {
  const { variant = [] } = await params;
  if (variant.length === 0) return <CartPage />;
  if (variant.length !== 1 || variant[0] !== 'khach') notFound();
  const http = createServerHttp({ revalidate });
  const fetchedAt = Date.now();
  const config = publicConfigQuery(http);
  const rail = suggestedRailQuery(http);
  // Dòng "Chọn Chuẩn Xanh" nằm giữa lời mời và kệ: hiện muộn thì đẩy kệ (ảnh LCP) xuống 44px, nên cờ của nó cũng lấy sẵn.
  const matcher = matcherStatusQuery(http);
  const [cfg, products, matcherStatus] = await Promise.all([
    config.queryFn().catch(() => null),
    rail.queryFn().catch(() => null),
    matcher.queryFn().catch(() => null),
  ]);
  // Không có cấu hình (cờ giỏ khách) thì không biết nên vẽ giỏ khách hay tường đăng nhập: phục vụ khung chờ như bản thường, không lưu đoán sai vào ISR.
  if (!cfg) return <CartPage />;
  const entries: QuerySeedEntry[] = [{ queryKey: config.queryKey, data: cfg, fetchedAt }];
  if (products) entries.push({ queryKey: rail.queryKey, data: products, fetchedAt });
  if (matcherStatus) entries.push({ queryKey: matcher.queryKey, data: matcherStatus, fetchedAt });
  return (
    <PrebuiltGuest>
      <QuerySeed entries={entries}>
        <CartPage />
      </QuerySeed>
    </PrebuiltGuest>
  );
}
