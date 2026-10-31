import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getBrand } from '@/lib/api';
import { PAGE_WIDE } from '@/lib/page-frame';
import { findBrandOrigin } from '@/lib/brand-origins';
import { BrandBody } from '@/components/shop-page/brand-body';

// Admin gỡ đăng không làm mới được trang này, nên hạn ngắn để nhãn bị gỡ không còn hiện lâu; vẫn dựng phía server cho SEO.
export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const b = await getBrand(slug);
  if (!b) return { title: 'Thương hiệu — Tubu Tree' };
  const title = `${b.name}${b.isVerified ? ' ✓' : ''} — Tubu Tree`;
  const description = b.tagline ?? 'Thương hiệu sống xanh trên Tubu Tree';
  const img = b.coverUrl ?? b.logoUrl ?? b.products?.[0]?.thumbnail ?? undefined;
  return {
    title,
    description,
    openGraph: { title, description, images: img ? [img] : [], type: 'website' },
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
    </main>
  );
}
