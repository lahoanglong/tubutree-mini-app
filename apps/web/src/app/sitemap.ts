import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';
import { getProducts } from '@/lib/api';

export const revalidate = 3600;

/**
 * Trang sản phẩm là nội dung chính cần lập chỉ mục, nhưng trang chủ chỉ link tới 30 sản phẩm
 * nổi bật — phần còn lại phải chờ crawler tự mò ra. Sitemap rút ngắn việc đó.
 *
 * Gian hàng/nhãn hàng chưa liệt kê ở đây vì API công khai chưa có endpoint liệt kê chúng.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'daily', priority: 1 },
  ];
  try {
    const products = await getProducts({ limit: '200' });
    for (const p of products) {
      base.push({ url: `${SITE_URL}/san-pham/${p.slug}`, changeFrequency: 'weekly', priority: 0.7 });
    }
  } catch {
    // API hỏng thì vẫn trả sitemap tối thiểu — thà thiếu trang còn hơn trả 500 cho crawler.
  }
  return base;
}
