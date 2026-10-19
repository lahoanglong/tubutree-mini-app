import type { MetadataRoute } from 'next';
import { PRIVATE_PATHS, SITE_URL } from '@/lib/site';
import { publicAllowPaths } from '@/lib/route-map';

/**
 * Không có file này thì /admin, /merchant, /tai-khoan, /gio-hang, /thanh-toan đều lập chỉ mục
 * được — tìm "Quản trị Tubu Tree" trên Google sẽ ra thẳng cổng quản trị.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    // Chặn CẢ đường dẫn trần lẫn cây con: `Disallow: /admin/` KHÔNG khớp `/admin` — mà chính
    // `/admin` mới là URL của trang.
    rules: [
      {
        userAgent: '*',
        // Longest-match: route công khai dưới tiền tố riêng tư (vd /doi-rac/quy-dinh) được mở lại.
        allow: ['/', ...publicAllowPaths(PRIVATE_PATHS)],
        disallow: [...PRIVATE_PATHS, ...PRIVATE_PATHS.map((p) => `${p}/`)],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
