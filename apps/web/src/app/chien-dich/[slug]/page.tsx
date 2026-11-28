import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { fetchCampaign, fetchCampaignProducts, type CampaignDetail } from '@tubutree/app-core/api/campaign';
import { CAMPAIGN_PRODUCTS_PAGE } from '@tubutree/app-core/commerce/campaign';
import { ApiNotFoundError, createServerHttp } from '@/lib/core-http-server';
import { ogBase, withBrand } from '@/lib/og';
import { PAGE_WIDE } from '@/lib/page-frame';
import { jsonLdScript } from '@/lib/product-seo';
import { browseCollectionJsonLd } from '@/lib/seo/browse-structured-data';
import { CampaignBody } from '@/components/campaign/campaign-body';

// Admin tắt chiến dịch không làm mới được trang này, nên hạn ngắn để chiến dịch đã tắt không còn hiện lâu; vẫn dựng phía server cho SEO.
export const revalidate = 60;

// Không dựng sẵn trang nào lúc build; trang đầu tiên của mỗi đường dẫn dựng khi có người vào rồi giữ theo revalidate (ISR thay vì dựng mỗi lượt).
export function generateStaticParams() {
  return [];
}

/** null chỉ khi API nói 404 (hết hạn, chưa mở, không có). API tạm lỗi thì ném: Next giữ bản đã render thay vì báo "đã kết thúc" nhầm. */
async function loadCampaign(slug: string): Promise<CampaignDetail | null> {
  try {
    return await fetchCampaign(createServerHttp({ revalidate }), slug);
  } catch (e) {
    if (e instanceof ApiNotFoundError) return null;
    throw e;
  }
}

/** Tiêu đề, mô tả, canonical của trang: thẻ meta, og và CollectionPage của JSON-LD đọc cùng một nguồn. */
function campaignMeta(c: CampaignDetail): { title: string; description: string; alternates: { canonical: string } } {
  return {
    title: c.title,
    description: c.subtitle ?? 'Ưu đãi đang diễn ra trên Tubu Tree',
    alternates: { canonical: `/chien-dich/${encodeURIComponent(c.slug)}` },
  };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = await loadCampaign(slug);
  if (!c) return { title: 'Chương trình' };
  const { title, description, alternates } = campaignMeta(c);
  const path = alternates.canonical;
  return {
    title,
    description,
    alternates,
    openGraph: { ...ogBase, url: path, title: withBrand(title), description, images: c.image ? [c.image] : ogBase.images },
  };
}

export default async function CampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await loadCampaign(slug);
  if (!c) notFound();
  // Lưới trang 1 có trong HTML đầu; lỗi thì để client tự tải lại (không biến một lỗi tạm thành trang trống hay 404).
  const first = c.productCount > 0 ? await fetchCampaignProducts(createServerHttp({ revalidate }), slug, { page: 1, limit: CAMPAIGN_PRODUCTS_PAGE }).catch(() => undefined) : undefined;
  // CollectionPage + ItemList (đúng các sản phẩm của trang 1 có trong HTML máy chủ) + BreadcrumbList, cùng khuôn với /brand/[slug] và /bo-qua-tang.
  const ld = browseCollectionJsonLd(campaignMeta(c), [{ name: 'Trang chủ', href: '/' }, { name: c.title }], first?.data ?? []);
  return (
    <main className={`${PAGE_WIDE} py-6 max-md:pt-0`}>
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }} />}
      <CampaignBody campaign={c} initialProducts={first} />
    </main>
  );
}
