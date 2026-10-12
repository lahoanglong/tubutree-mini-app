import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';
import { getProducts, getStorefrontList } from '@/lib/api';

export const revalidate = 3600;

/**
 * Trang sản phẩm là nội dung chính cần lập chỉ mục, nhưng trang chủ chỉ link tới 30 sản phẩm
 * nổi bật — phần còn lại phải chờ crawler tự mò ra. Sitemap rút ngắn việc đó.
 *
 * Gian hàng CTV/nhãn hàng (route /s/[slug]) — trước đây KHÔNG có trong sitemap vì API công
 * khai chưa có endpoint liệt kê chúng ("API công khai chưa có endpoint liệt kê chúng"). Nay
 * dùng GET /storefront/public-list (chỉ gian hàng đã đăng, 500 gian hàng cập nhật gần nhất —
 * mirror đúng giới hạn 200 sản phẩm bên dưới, không cần liệt kê TOÀN BỘ).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'daily', priority: 1 },
  ];
  // Không bắt lỗi: nếu nuốt lỗi rồi trả sitemap rút gọn thì ISR sẽ giữ bản thiếu cả giờ; để lỗi nổi lên
  // thì Next giữ sitemap đầy đủ lần trước. Lúc build API chưa chạy đã được getProducts/getStorefrontList xử lý.
  const products = await getProducts({ limit: '200' });
  for (const p of products) {
    base.push({ url: `${SITE_URL}/san-pham/${p.slug}`, changeFrequency: 'weekly', priority: 0.7 });
  }
  const storefronts = await getStorefrontList();
  for (const s of storefronts) {
    base.push({
      url: `${SITE_URL}/s/${s.slug}`,
      lastModified: new Date(s.updatedAt),
      changeFrequency: 'weekly',
      priority: 0.6,
    });
  }
  return base;
}
