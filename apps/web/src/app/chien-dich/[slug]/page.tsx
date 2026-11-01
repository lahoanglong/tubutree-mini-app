import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { fetchCampaign, fetchCampaignProducts, type CampaignDetail } from '@tubutree/app-core/api/campaign';
import { CAMPAIGN_PRODUCTS_PAGE } from '@tubutree/app-core/commerce/campaign';
import { ApiNotFoundError, createServerHttp } from '@/lib/core-http-server';
import { PAGE_WIDE } from '@/lib/page-frame';
import { CampaignBody } from '@/components/campaign/campaign-body';

// Admin tắt chiến dịch không làm mới được trang này, nên hạn ngắn để chiến dịch đã tắt không còn hiện lâu; vẫn dựng phía server cho SEO.
export const revalidate = 60;

/** null chỉ khi API nói 404 (hết hạn, chưa mở, không có). API tạm lỗi thì ném: Next giữ bản đã render thay vì báo "đã kết thúc" nhầm. */
async function loadCampaign(slug: string): Promise<CampaignDetail | null> {
  try {
    return await fetchCampaign(createServerHttp({ revalidate }), slug);
  } catch (e) {
    if (e instanceof ApiNotFoundError) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = await loadCampaign(slug);
  if (!c) return { title: 'Chương trình — Tubu Tree' };
  const title = `${c.title} — Tubu Tree`;
  const description = c.subtitle ?? 'Ưu đãi đang diễn ra trên Tubu Tree';
  return { title, description, openGraph: { title, description, images: c.image ? [c.image] : [], type: 'website' } };
}

export default async function CampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await loadCampaign(slug);
  if (!c) notFound();
  // Lưới trang 1 có trong HTML đầu; lỗi thì để client tự tải lại (không biến một lỗi tạm thành trang trống hay 404).
  const first = c.productCount > 0 ? await fetchCampaignProducts(createServerHttp({ revalidate }), slug, { page: 1, limit: CAMPAIGN_PRODUCTS_PAGE }).catch(() => undefined) : undefined;
  return (
    <main className={`${PAGE_WIDE} py-6 max-md:pt-0`}>
      <CampaignBody campaign={c} initialProducts={first} />
    </main>
  );
}
