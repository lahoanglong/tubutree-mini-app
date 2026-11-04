const SITE_NAME = 'Tubu Tree';

/** Ảnh chia sẻ mặc định (app/opengraph-image.png): file đó chỉ gắn vào segment gốc, nên mọi trang con khai openGraph phải tự mang lại. */
export const OG_IMAGE = { url: '/opengraph-image.png', width: 1200, height: 630, alt: SITE_NAME };

/**
 * Nền chung của openGraph ở trang con. Next thay NGUYÊN object `openGraph` của cha bằng object của con (không trộn từng khoá), nên con khai
 * `openGraph` mà không rải khối này sẽ mất siteName, locale và ảnh. Luôn rải kèm `url` của chính trang (trang noindex thì bỏ `url`).
 */
export const ogBase = {
  type: 'website' as const,
  siteName: SITE_NAME,
  locale: 'vi_VN',
  images: [OG_IMAGE],
};

/** Template tiêu đề gốc ('%s — Tubu Tree') không áp lên `openGraph.title`, nên og:title thêm hậu tố bằng tay để khớp <title>. */
export const withBrand = (title: string): string => `${title} — ${SITE_NAME}`;
