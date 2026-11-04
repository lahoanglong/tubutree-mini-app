import type { Metadata } from 'next';
import HomeView from '@/components/home/home-view';
import { getPublicSupport } from '@/lib/api';
import { loadHomeInitial } from '@/lib/home-initial';
import { HOME_DESCRIPTION, HOME_TITLE, siteJsonLd } from '@/lib/home-seo';
import { ogBase } from '@/lib/og';
import { jsonLdScript } from '@/lib/product-seo';
import { homeText } from '@/lib/home-text';
import { PAGE_WIDE } from '@/lib/page-frame';

export const revalidate = 300;

// Danh mục và tìm kiếm đã sang /san-pham (link cũ /?q|category|brand được chuyển hướng 307 ở next.config): trang chủ luôn là chính nó.
export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: { ...ogBase, url: '/', title: HOME_TITLE, description: HOME_DESCRIPTION },
};

/**
 * Trang chủ như Mini App. Phần công khai (bán chạy, trang đầu lưới gợi ý, danh mục, thương hiệu) render phía server để có trong HTML
 * cho công cụ tìm kiếm; phần cá nhân hoá (thẻ thành viên, Việc cần làm, Mua lại, Quà khách mới...) render ở client sau đăng nhập.
 * Khách đã có cookie phiên được middleware chuyển sang bản dựng sẵn khung chờ: app/khoi-phuc/[hint]/page.tsx.
 */
export default async function HomePage() {
  const [initial, support] = await Promise.all([loadHomeInitial(), getPublicSupport()]);
  return (
    <main className={`${PAGE_WIDE} py-4 max-md:py-0 md:py-6`}>
      <h1 className="sr-only font-display">Tubu Tree — {homeText.seoTitle}</h1>
      <HomeView initial={initial} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(siteJsonLd(support)) }} />
    </main>
  );
}
