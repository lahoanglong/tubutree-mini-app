import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getBrand } from '@/lib/api';
import { ogBase, withBrand } from '@/lib/og';
import { brandMetaDescription, breadcrumbJsonLd, jsonLdScript } from '@/lib/product-seo';
import { PAGE_WIDE } from '@/lib/page-frame';
import { findBrandOrigin } from '@/lib/brand-origins';
import { BrandBody } from '@/components/shop-page/brand-body';

// Admin gỡ đăng không làm mới được trang này, nên hạn ngắn để nhãn bị gỡ không còn hiện lâu; vẫn dựng phía server cho SEO.
export const revalidate = 60;

// Không dựng sẵn trang nào lúc build; trang đầu tiên của mỗi đường dẫn dựng khi có người vào rồi giữ theo revalidate (ISR thay vì dựng mỗi lượt).
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const b = await getBrand(slug);
  if (!b) return { title: 'Thương hiệu' };
  const title = b.name;
  const description = brandMetaDescription(b);
  const img = b.coverUrl ?? b.logoUrl ?? b.products?.[0]?.thumbnail ?? undefined;
  // Link chia sẻ của CTV thêm ?ref=: canonical bỏ tham số đó để cùng một trang không bị tính là bản trùng.
  const path = `/brand/${encodeURIComponent(b.slug)}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { ...ogBase, url: path, title: withBrand(title), description, images: img ? [img] : ogBase.images },
  };
}

export default async function BrandPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const b = await getBrand(slug);
  if (!b) notFound();
  const mapOrigin = findBrandOrigin({ slug: b.slug, name: b.name });

  // Thân trang là client (Theo dõi, tab, phân trang) nên chỉ nhận dữ liệu thuần; điện thoại bìa tràn mép nên main không đệm.
  return (
    <main data-page-bleed className={`${PAGE_WIDE} py-6 max-md:p-0 max-md:pb-[calc(90px+var(--safe-bottom))]`}>
      <BrandBody brand={b} mapOriginId={mapOrigin?.id ?? null} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(breadcrumbJsonLd([{ name: 'Trang chủ', href: '/' }, { name: b.name, href: `/brand/${encodeURIComponent(b.slug)}` }])),
        }}
      />
    </main>
  );
}
