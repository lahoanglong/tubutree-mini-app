import { useMemo, useState } from 'react';
import { Page, useNavigate, useParams } from 'zmp-ui';
import { useQueries, useQuery } from '@tanstack/react-query';
import { campaignDateRange, campaignProductPages, campaignVoucherViews } from '@tubutree/app-core/commerce/campaign';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { campaignProductsQuery, campaignQuery } from '@tubutree/app-core/queries/campaign';
import { coreHttp } from '../services/core-http';
import { getLoadErrorMessage, isNotFoundError } from '../services/api';
import { useCouponUse } from '../hooks/use-coupon-use';
import { serverNow } from '../utils/server-clock';
import { Button } from '../components/ui/button';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';
import { ProductGrid } from '../components/ui/product-grid';
import { SectionHeader } from '../components/ui/section-header';
import { Skeleton } from '../components/ui/skeleton';
import { Text } from '../components/ui/text';
import { VoucherTicket } from '../components/ui/voucher-ticket';

/** Tiêu đề khi chưa có tên chương trình (đang tải, lỗi); tải xong thì tên chương trình là h1 duy nhất của trang. */
const PAGE_TITLE = 'Chương trình';
const STALE_MS = 60_000;

function Products({ slug }: { slug: string }) {
  const [pages, setPages] = useState(1);
  const results = useQueries({
    queries: Array.from({ length: pages }, (_, i) => ({ ...campaignProductsQuery(coreHttp, slug, i + 1), staleTime: STALE_MS })),
  });
  const view = useMemo(() => campaignProductPages(results.map((r) => r.data)), [results]);
  const last = results[results.length - 1];
  const first = results[0];
  if (first?.isPending) return <ProductGrid items={[]} variant="grid" loading />;
  if (first?.isError) return <ErrorState variant="inline" message={getLoadErrorMessage(first.error)} onRetry={() => void first.refetch()} retrying={first.isFetching} />;
  return (
    <>
      <ProductGrid items={view.items} variant="grid" listSource="campaign" />
      {last?.isError && <ErrorState variant="inline" message={getLoadErrorMessage(last.error)} onRetry={() => void last.refetch()} retrying={last.isFetching} />}
      {view.hasMore && !last?.isError && (
        <div style={{ marginTop: 16 }}>
          <Button variant="secondary" fullWidth loading={last?.isPending} onPress={() => setPages((n) => n + 1)}>
            {fillCopy('shop.loadMore')}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Trang một chiến dịch (banner bấm vào): ảnh đầu trang, tên, thời gian, mã giảm giá gắn kèm (sao chép được, khách chưa đăng nhập cũng xem) và
 * lưới sản phẩm "Xem thêm" từng 20 món. Chiến dịch hết hạn, chưa mở hay không có đều 404 như nhau nên cùng một màn "đã kết thúc" kèm đường về Trang chủ.
 */
export default function CampaignPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { copy } = useCouponUse();
  const q = useQuery({ ...campaignQuery(coreHttp, slug), staleTime: STALE_MS });
  const c = q.data;
  const vouchers = useMemo(() => (c ? campaignVoucherViews(c.coupons, serverNow()) : []), [c]);

  if (!c) {
    return (
      <Page style={{ background: 'var(--color-bg-canvas)' }}>
        <PageHeader title={PAGE_TITLE} />
        {q.isLoading ? (
          <div data-testid="campaign-loading" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton height="auto" radius="var(--radius-media)" style={{ aspectRatio: 'var(--banner-ratio)' }} />
            <ProductGrid items={[]} variant="grid" loading />
          </div>
        ) : (
          <div style={{ padding: 24 }}>
            {isNotFoundError(q.error) ? (
              <EmptyState
                art="search"
                heading={fillCopy('campaign.endedTitle')}
                body={fillCopy('campaign.endedBody')}
                ctaLabel={fillCopy('campaign.backHome')}
                onCta={() => navigate('/', { replace: true })}
              />
            ) : (
              <ErrorState message={getLoadErrorMessage(q.error)} onRetry={() => void q.refetch()} retrying={q.isFetching} />
            )}
          </div>
        )}
      </Page>
    );
  }

  const range = campaignDateRange(c);
  const couponsLabel = fillCopy('campaign.sectionCoupons');
  const productsLabel = fillCopy('campaign.sectionProducts');
  const showProducts = c.productCount > 0;
  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 32 }}>
      <PageHeader title={c.title} {...(c.subtitle ? { subtitle: c.subtitle } : {})} />
      <div style={{ padding: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {c.image && (
          <img
            src={c.image}
            alt=""
            decoding="async"
            style={{ display: 'block', width: '100%', aspectRatio: 'var(--banner-ratio)', objectFit: 'cover', borderRadius: 'var(--radius-media)' }}
          />
        )}
        {range && (
          <Text variant="caption" tone="tertiary">
            {range}
          </Text>
        )}
        {vouchers.length > 0 && (
          <section aria-label={couponsLabel}>
            <SectionHeader title={couponsLabel} icon="ticket" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {vouchers.map((v) => (
                <VoucherTicket key={v.code} voucher={v} variant="ticket" primary={{ label: fillCopy('campaign.copyCode'), onClick: () => void copy(v.code) }} />
              ))}
            </div>
          </section>
        )}
        {showProducts ? (
          <section aria-label={productsLabel}>
            <SectionHeader title={productsLabel} />
            <Products slug={slug} />
          </section>
        ) : (
          vouchers.length === 0 && (
            <Text variant="body-sm" tone="secondary" style={{ textAlign: 'center', padding: '24px 0' }}>
              {fillCopy('campaign.productsEmpty')}
            </Text>
          )
        )}
      </div>
    </Page>
  );
}
