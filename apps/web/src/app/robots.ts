import type { MetadataRoute } from 'next';
import { PRIVATE_PATHS, SITE_URL } from '@/lib/site';
import { publicAllowPaths } from '@/lib/route-map';

/**
 * Không có file này thì /admin, /merchant, /tai-khoan, /gio-hang, /thanh-toan đều lập chỉ mục
 * được — tìm "Quản trị Tubu Tree" trên Google sẽ ra thẳng cổng quản trị.
 */
export default function robots(): MetadataRoute.Robots {
  // Longest-match: route công khai dưới tiền tố riêng tư (vd /doi-rac/quy-dinh) được mở lại. /uu-dai và /ma-giam-gia không có ở đây
  // lẫn ở disallow: chúng noindex bằng meta nên crawler phải đọc được trang.
  const allow = ['/', ...publicAllowPaths(PRIVATE_PATHS)];
  const allowed = new Set(allow);
  return {
    // Chặn CẢ đường dẫn trần lẫn cây con: `Disallow: /admin/` KHÔNG khớp `/admin` — mà chính
    // `/admin` mới là URL của trang.
    rules: [
      {
        userAgent: '*',
        allow,
        // Một đường dẫn không được nằm ở cả Allow lẫn Disallow. /cong-dong là trang công khai nhưng /cong-dong/<id> và /cong-dong/su-kien là riêng tư:
        // dạng trần đã nằm ở Allow nên chỉ chặn cây con `/cong-dong/` (dài hơn nên thắng khi so khớp dài nhất).
        disallow: [...PRIVATE_PATHS.filter((p) => !allowed.has(p)), ...PRIVATE_PATHS.map((p) => `${p}/`)],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
