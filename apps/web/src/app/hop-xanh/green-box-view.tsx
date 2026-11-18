'use client';

import { useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { fetchGreenBoxPage, type GreenBoxPage } from '@tubutree/app-core/api/bundle';
import { greenBoxBarText, greenBoxPageIntro, greenBoxWebCopy, readGreenBox } from '@tubutree/app-core/commerce/green-box';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { HomeQuickAddProvider } from '@/components/home/home-quick-add';
import { EmptyState } from '@/components/empty-state';
import { ProductGrid } from '@/components/mini';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { trackWebEvent } from '@/lib/analytics';
import { useAuthPhase } from '@/lib/auth-phase';
import { useCartKey } from '@/lib/cart-key';
import { coreHttp } from '@/lib/core-http';
import { loadErrorText } from '@/lib/error-text';
import { useGuestCartLines } from '@/lib/guest-cart/use-guest-cart';
import { uiBar } from '@/lib/guest-ui';
import { getCart } from '@/lib/shop-client';

const GRID = 'grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-5';

/**
 * Trang ghép Hộp Xanh của web: món đủ điều kiện nhóm theo danh mục, nút ＋ thêm vào giỏ thường (khách chưa đăng nhập dùng giỏ khách khi cờ bật, như
 * Trang chủ). Thanh đáy đọc tiến độ máy chủ trả trong giỏ; giỏ khách chưa được máy chủ tính nên chỉ đếm món, không hứa mức giảm. Một nút chính: "Xem giỏ".
 */
export default function GreenBoxView({ initial }: { initial?: GreenBoxPage }) {
  const q = useQuery({
    queryKey: ['bundles', 'green-box'],
    queryFn: () => fetchGreenBoxPage(coreHttp),
    staleTime: 60_000,
    // Bản máy chủ (ISR 5 phút) vẽ ngay rồi hỏi lại một lần khi mở: danh sách đổi theo tồn kho.
    ...(initial ? { initialData: initial, initialDataUpdatedAt: 0 } : {}),
  });
  const page = q.data;
  const enabled = page?.enabled === true && page.tiers.length > 0;

  const viewed = useRef(false);
  useEffect(() => {
    if (!enabled || viewed.current) return;
    viewed.current = true;
    trackWebEvent('green_box_page_viewed', {});
  }, [enabled]);

  const title = greenBoxWebCopy('pageTitle');
  if (q.isLoading) {
    return (
      <>
        <PageHeader title={title} backHref="/" />
        <ProductGrid items={[]} variant="grid" loading skeletonCount={8} className={`${GRID} pt-3`} />
      </>
    );
  }
  if (q.isError && !page) {
    return (
      <>
        <PageHeader title={title} backHref="/" />
        <ErrorState message={loadErrorText(q.error)} onRetry={() => q.refetch()} />
      </>
    );
  }
  if (!page || !enabled) {
    return (
      <>
        <PageHeader title={title} backHref="/" />
        <EmptyState title={greenBoxWebCopy('pageClosed')} actionHref="/san-pham" actionLabel={fillCopy('flash.emptyCta')} />
      </>
    );
  }
  return <GreenBoxBody page={page} title={title} />;
}

function GreenBoxBody({ page, title }: { page: GreenBoxPage; title: string }) {
  const authed = useAuthPhase() === 'authenticated';
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: authed });
  const guestLines = useGuestCartLines();
  const slugs = useMemo(() => new Set(page.groups.flatMap((g) => g.products.map((p) => p.slug))), [page.groups]);
  // Khách đã đăng nhập: số món và mức giảm máy chủ tính trên giỏ thật. Khách chưa đăng nhập: chỉ đếm món của trang đã có trong giỏ khách.
  const barText = authed
    ? greenBoxBarText(readGreenBox(cartQ.data))
    : greenBoxWebCopy('barSelectedNone', { n: new Set(guestLines.filter((l) => slugs.has(l.slug)).map((l) => l.slug)).size });
  const empty = page.groups.every((g) => g.products.length === 0);

  const bar = (
    <>
      <p data-testid="green-box-bar-text" role="status" className="min-w-0 flex-[1000_1_0%] text-sm font-semibold tabular-nums text-[color:var(--color-text-primary)]">
        {barText}
      </p>
      <Link href="/gio-hang" className={`${uiBar.primary} flex-[1_0_9.25rem]`}>
        {greenBoxWebCopy('viewCart')}
      </Link>
    </>
  );

  return (
    <HomeQuickAddProvider>
      <PageHeader title={title} subtitle={greenBoxPageIntro(page.tiers)} backHref="/" />
      <p className="pt-2 text-caption text-[color:var(--color-text-secondary)]">{greenBoxWebCopy('pageRule')}</p>
      {/* Từ md thanh đếm dính dưới thanh đầu trang (thanh đáy chỉ có ở điện thoại). */}
      <div className="sticky top-[var(--header-h)] z-[2] -mx-6 mt-3 hidden items-center gap-3 bg-[var(--color-bg-canvas)] px-6 py-2 md:flex">{bar}</div>
      {empty ? (
        <EmptyState title={greenBoxWebCopy('pageEmpty')} actionHref="/san-pham" actionLabel={fillCopy('flash.emptyCta')} />
      ) : (
        page.groups.map((g) => (
          <section key={g.category?.id ?? 'other'} aria-labelledby={`hop-xanh-${g.category?.id ?? 'other'}`} className="pt-4">
            <h2 id={`hop-xanh-${g.category?.id ?? 'other'}`} className="pb-2 font-display text-base font-semibold text-[color:var(--color-text-primary)]">
              {g.category?.name ?? greenBoxWebCopy('otherGroup')}
            </h2>
            <ProductGrid items={g.products} variant="grid" className={GRID} />
          </section>
        ))
      )}
      <StickyActionBar label={greenBoxWebCopy('pageTitle')}>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">{bar}</div>
      </StickyActionBar>
    </HomeQuickAddProvider>
  );
}
