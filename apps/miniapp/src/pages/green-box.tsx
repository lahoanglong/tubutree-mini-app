import { useEffect, useRef, type CSSProperties } from 'react';
import { Page } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { fetchGreenBoxPage, type GreenBoxPage as GreenBoxPageData } from '@tubutree/app-core/api/bundle';
import { greenBoxBarText, greenBoxPageIntro, greenBoxWebCopy, readGreenBox } from '@tubutree/app-core/commerce/green-box';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { HomeQuickAddProvider } from '../components/home/home-quick-add';
import { Button } from '../components/ui/button';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';
import { ProductGrid } from '../components/ui/product-grid';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { Heading, Text } from '../components/ui/text';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { useSmartNavigate } from '../lib/smart-nav';
import { trackEvent } from '../services/analytics';
import { getLoadErrorMessage } from '../services/api';
import { useCartKey } from '../services/cart-key';
import { coreHttp } from '../services/core-http';
import { getCart } from '../services/shop-api';

const PAGE_STYLE: CSSProperties = { background: 'var(--color-bg-canvas)', paddingBottom: 'calc(var(--sticky-bar-h, 6rem) + var(--space-stack-md))' };
const BODY: CSSProperties = { padding: '0 var(--space-inset-page)' };

/** Cùng khoá với web `/hop-xanh`: danh sách đổi theo tồn kho nên hỏi lại sau một phút. */
const greenBoxPageQuery = { queryKey: ['bundles', 'green-box'] as const, queryFn: () => fetchGreenBoxPage(coreHttp), staleTime: 60_000 };

/**
 * Trang ghép Hộp Xanh của Mini App (lối vào: "Ghép thêm" ở dải Hộp Xanh của giỏ), cùng dữ liệu và luật với web `/hop-xanh`: món đủ điều kiện nhóm theo danh mục,
 * nút ＋ trên thẻ thêm vào giỏ thường (giỏ nhanh của Trang chủ, mời đăng nhập khi cần). Thanh đáy đọc tiến độ máy chủ trả trong giỏ. Một nút chính: "Xem giỏ".
 */
export default function GreenBoxPage() {
  const goSmart = useSmartNavigate();
  const q = useQuery(greenBoxPageQuery);
  const page = q.data;
  const enabled = page?.enabled === true && page.tiers.length > 0;

  const viewed = useRef(false);
  useEffect(() => {
    if (!enabled || viewed.current) return;
    viewed.current = true;
    trackEvent('green_box_page_viewed', 'miniapp', {});
  }, [enabled]);

  const title = greenBoxWebCopy('pageTitle');
  if (q.isLoading) {
    return (
      <Page className="page" style={PAGE_STYLE}>
        <PageHeader title={title} />
        <div style={{ ...BODY, paddingTop: 'var(--space-stack-sm)' }}>
          <ProductGrid items={[]} variant="grid" loading skeletonCount={6} />
        </div>
      </Page>
    );
  }
  if (q.isError && !page) {
    return (
      <Page className="page" style={PAGE_STYLE}>
        <PageHeader title={title} />
        <div style={BODY}>
          <ErrorState variant="inline" message={getLoadErrorMessage(q.error)} onRetry={() => q.refetch()} />
        </div>
      </Page>
    );
  }
  if (!page || !enabled) {
    return (
      <Page className="page" style={PAGE_STYLE}>
        <PageHeader title={title} />
        <div style={BODY}>
          <EmptyState variant="inline" art="basket" heading={greenBoxWebCopy('pageClosed')} ctaLabel={fillCopy('flash.emptyCta')} onCta={() => goSmart('/browse')} />
        </div>
      </Page>
    );
  }
  return <GreenBoxBody page={page} title={title} onViewCart={() => goSmart('/cart')} onBrowse={() => goSmart('/browse')} />;
}

function GreenBoxBody({ page, title, onViewCart, onBrowse }: { page: GreenBoxPageData; title: string; onViewCart: () => void; onBrowse: () => void }) {
  const authed = useAuthPhase() === 'authenticated';
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: authed });
  // Số món và mức giảm do máy chủ tính trên giỏ thật; chưa đăng nhập thì giỏ trống (0 món).
  const barText = greenBoxBarText(readGreenBox(cartQ.data));
  const empty = page.groups.every((g) => g.products.length === 0);

  return (
    <HomeQuickAddProvider>
      <Page className="page" style={PAGE_STYLE}>
        <PageHeader title={title} subtitle={greenBoxPageIntro(page.tiers)} />
        <div style={BODY}>
          <Text variant="caption" tone="secondary" as="p" style={{ paddingTop: 'var(--space-stack-xs)' }}>
            {greenBoxWebCopy('pageRule')}
          </Text>
          {empty ? (
            <EmptyState variant="inline" art="basket" heading={greenBoxWebCopy('pageEmpty')} ctaLabel={fillCopy('flash.emptyCta')} onCta={onBrowse} />
          ) : (
            page.groups.map((g) => {
              const id = `green-box-${g.category?.id ?? 'other'}`;
              return (
                <section key={id} aria-labelledby={id} style={{ paddingTop: 'var(--space-stack-md)' }}>
                  <Heading variant="title-sm" font="ui" as="h2" id={id} style={{ paddingBottom: 'var(--space-stack-xs)' }}>
                    {g.category?.name ?? greenBoxWebCopy('otherGroup')}
                  </Heading>
                  <ProductGrid items={g.products} variant="grid" />
                </section>
              );
            })
          )}
        </div>
        <StickyActionBar
          label={title}
          lead={
            <div role="status" data-testid="green-box-bar-text">
              <Text variant="body-sm" as="p" numeric style={{ fontWeight: 600 }}>
                {barText}
              </Text>
            </div>
          }
          primary={
            <Button onPress={onViewCart} data-testid="green-box-view-cart">
              {greenBoxWebCopy('viewCart')}
            </Button>
          }
        />
      </Page>
    </HomeQuickAddProvider>
  );
}
