import type { MetadataRoute } from 'next';
import { PRIVATE_PATHS, SITE_URL } from '@/lib/site';

/**
 * Không có file này thì /admin, /merchant, /tai-khoan, /gio-hang, /thanh-toan đều lập chỉ mục
 * được — tìm "Quản trị Tubu Tree" trên Google sẽ ra thẳng cổng quản trị.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    // Chặn CẢ đường dẫn trần lẫn cây con: `Disallow: /admin/` KHÔNG khớp `/admin` — mà chính
    // `/admin` mới là URL của trang. Ba trang /gio-hang, /thanh-toan, /dang-nhap không có layout
    // noindex nên chỉ còn đúng lớp này bảo vệ.
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [...PRIVATE_PATHS, ...PRIVATE_PATHS.map((p) => `${p}/`)],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
