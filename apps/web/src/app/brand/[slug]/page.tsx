import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { fetchRefillLanding } from '@tubutree/app-core/refill/refill-landing';
import { getBrand } from '@/lib/api';
import { createServerHttp } from '@/lib/core-http-server';
import { refillEntryOf } from '@/lib/refill-entry';
import { brandMetaDescription, jsonLdScript } from '@/lib/product-seo';
import { browseCollectionJsonLd, withBrowseSocial } from '@/lib/seo/browse-structured-data';
import { PAGE_WIDE } from '@/lib/page-frame';
import { brandPageOrigin } from '@/lib/brand-origins';
import { BRAND_FEATURED_MAX } from '@/lib/brand-featured';
import { BrandBody } from '@/components/shop-page/brand-body';

// Admin gỡ đăng không làm mới được trang này, nên hạn ngắn để nhãn bị gỡ không còn hiện lâu; vẫn dựng phía server cho SEO.
export const revalidate = 60;

// Không dựng sẵn trang nào lúc build; trang đầu tiên của mỗi đường dẫn dựng khi có người vào rồi giữ theo revalidate (ISR thay vì dựng mỗi lượt).
export function generateStaticParams() {
  return [];
}

type BrandForMeta = NonNullable<Awaited<ReturnType<typeof getBrand>>>;

/** Link chia sẻ của CTV thêm ?ref=: canonical bỏ tham số đó để cùng một trang không bị tính là bản trùng. */
const brandPath = (b: BrandForMeta) => `/brand/${encodeURIComponent(b.slug)}`;

/** Tiêu đề, mô tả, canonical của trang: thẻ meta, og/twitter và CollectionPage của JSON-LD đọc cùng một nguồn. */
function brandMeta(b: BrandForMeta): Metadata {
  // ✓ là chữ trong chuỗi <title>/og (huy hiệu trên trang là icon): nhãn chính hãng nhận dấu ngay ở kết quả tìm kiếm và khi chia sẻ.
  return { title: `${b.name}${b.isVerified ? ' ✓' : ''}`, description: brandMetaDescription(b), alternates: { canonical: brandPath(b) } };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const b = await getBrand(slug);
  if (!b) return { title: 'Thương hiệu' };
  const img = b.coverUrl ?? b.logoUrl ?? b.products?.[0]?.thumbnail ?? undefined;
  return withBrowseSocial(brandMeta(b), img);
}

export default async function BrandPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [b, landing] = await Promise.all([getBrand(slug), fetchRefillLanding(createServerHttp()).catch(() => undefined)]);
  if (!b) notFound();
  const mapOrigin = brandPageOrigin({ slug: b.slug, name: b.name });
  // Chỉ nhãn có hàng trên trang "Tiết kiệm với Refill" mới mang lối vào. API xét mọi sản phẩm của nhãn qua bảng cặp (`refillProductSlugs`), trang
  // khớp các slug đó với cặp mà trang Refill thật sự hiện (chỉ gói rẻ hơn, tối đa 60 cặp); API cũ thì dò theo 30 món nhận được. Cờ tắt thì trang
  // Refill rỗng; API Refill lỗi thì bỏ lối vào, trang vẫn dựng.
  const refillEntry =
    b.hasRefillProducts === false ? null : (refillEntryOf(landing, new Set(b.refillProductSlugs ?? b.products.map((p) => p.slug))) ?? null);
  // CollectionPage + ItemList (đúng các thẻ nổi bật có trong HTML máy chủ) + BreadcrumbList. Tên trong JSON-LD là tên nhãn, không mang dấu ✓.
  const ld = browseCollectionJsonLd(
    { ...brandMeta(b), title: b.name },
    [{ name: 'Trang chủ', href: '/' }, { name: b.name, href: brandPath(b) }],
    b.products.slice(0, BRAND_FEATURED_MAX),
  );

  // Thân trang là client (Theo dõi, tab, phân trang) nên chỉ nhận dữ liệu thuần; điện thoại bìa tràn mép nên main không đệm.
  return (
    <main data-page-bleed className={`${PAGE_WIDE} py-6 max-md:p-0 max-md:pb-[calc(90px+var(--safe-bottom))]`}>
      <BrandBody brand={b} mapOriginId={mapOrigin?.id ?? null} originFallback={mapOrigin?.text ?? null} refillEntry={refillEntry} />
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }} />}
    </main>
  );
}
