import type { MetadataRoute } from 'next';
import { PRIVATE_PATHS, SITE_URL } from '@/lib/site';

/**
 * Không có file này thì /admin, /merchant, /tai-khoan, /gio-hang, /thanh-toan đều lập chỉ mục
 * được — tìm "Quản trị Tubu Tree" trên Google sẽ ra thẳng cổng quản trị.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: PRIVATE_PATHS.map((p) => `${p}/`) }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
