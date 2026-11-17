import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicConfig } from '@tubutree/app-core/api/config';
import { inviteFriendGiftLine, inviteLandingOn, inviteLandingTarget, isInviteCode } from '@tubutree/app-core/commerce/invite-card';
import { welcomeOfferOf } from '@tubutree/app-core/commerce/share-offer';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { createServerHttp } from '@/lib/core-http-server';
import { ui } from '@/lib/guest-ui';
import { PAGE_NARROW } from '@/lib/page-frame';
import { InviteLandingCta } from './invite-landing-cta';

type Props = { params: Promise<{ code: string }> };

/**
 * Dựng mỗi lần mở, không lưu trang theo đường dẫn: mã nào cũng ra trang (kể cả mã bịa), lưu theo đường dẫn thì ai đó gọi hàng loạt mã ngẫu nhiên
 * sẽ làm đầy bộ đệm trên đĩa máy chủ. Cấu hình công khai vẫn được đệm 5 phút (một mục chung cho mọi mã).
 */
export const dynamic = 'force-dynamic';
const CONFIG_REVALIDATE_S = 300;

/** Cấu hình công khai; lỗi API coi như cờ tắt (trang 404), không dựng trang mời khi chưa biết chắc tính năng đang bật. */
const loadConfig = () => getPublicConfig(createServerHttp({ revalidate: CONFIG_REVALIDATE_S })).catch(() => null);

/**
 * Trang đích của link mời (cờ `referral.share_card_enabled`): lời chào chung, quà cho bạn mới và một nút vào Trang chủ kèm `?ref=` để
 * cơ chế ghi nhận lượt giới thiệu sẵn có chạy như link cũ. Không tra mã có thật hay không, không có tên hay số của người mời: mã nào
 * (kể cả sai khuôn) cũng ra cùng một trang, nên trang không lộ mã nào tồn tại. Không lập chỉ mục.
 */
export async function generateMetadata(): Promise<Metadata> {
  const title = fillCopy('invite.landing.title');
  const description = fillCopy('invite.landing.body');
  // Ảnh xem trước là tệp tĩnh `opengraph-image.png` cạnh trang (thẻ chung, không mã, không tên); không khai og:url để link chia sẻ giữ nguyên.
  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: false },
    alternates: null,
    openGraph: { type: 'website', siteName: 'Tubu Tree', locale: 'vi_VN', title, description },
  };
}

export default async function InviteLandingPage({ params }: Props) {
  const [{ code }, cfg] = await Promise.all([params, loadConfig()]);
  if (!inviteLandingOn(cfg)) notFound();
  const gift = isInviteCode(code) ? inviteFriendGiftLine(welcomeOfferOf(cfg)) : null;
  return (
    <main className={`${PAGE_NARROW} py-6 md:py-10`}>
      <section data-testid="invite-landing" className={`flex flex-col items-center gap-3 p-6 text-center ${ui.card}`}>
        <h1 className={ui.pageTitle}>{fillCopy('invite.landing.title')}</h1>
        <p className="text-sm text-[color:var(--color-text-secondary)]">{fillCopy('invite.landing.body')}</p>
        {gift && <p className="text-sm font-semibold text-[color:var(--color-text-brand)]">{gift}</p>}
        <InviteLandingCta href={inviteLandingTarget(code)} />
      </section>
    </main>
  );
}
