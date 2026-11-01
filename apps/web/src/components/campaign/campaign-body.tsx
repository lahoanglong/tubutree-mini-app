'use client';

import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { CampaignDetail } from '@tubutree/app-core/api/campaign';
import type { PageResponse, ProductCard } from '@tubutree/app-core/api/catalog';
import { campaignDateRange, campaignProductPages, campaignVoucherViews } from '@tubutree/app-core/commerce/campaign';
import { campaignProductsQuery } from '@tubutree/app-core/queries/campaign';
import { serverNow } from '@tubutree/app-core/server-clock';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { coreHttp } from '@/lib/core-http';
import { loadErrorText } from '@/lib/error-text';
import { useCouponUse } from '@/lib/use-coupon-use';
import { Button, ProductGrid, SectionHeader, Text, VoucherTicket } from '@/components/mini';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';

const STALE_MS = 60_000;

function Products({ slug, initial }: { slug: string; initial?: PageResponse<ProductCard> | undefined }) {
  const [pages, setPages] = useState(1);
  const results = useQueries({
    queries: Array.from({ length: pages }, (_, i) => ({
      ...campaignProductsQuery(coreHttp, slug, i + 1),
      staleTime: STALE_MS,
      retry: false,
      // Trang 1 do server dựng sẵn (cùng khoá với lần tải của client): có ngay trong HTML đầu, không gọi lại.
      ...(i === 0 && initial ? { initialData: initial } : {}),
    })),
  });
  const view = useMemo(() => campaignProductPages(results.map((r) => r.data)), [results]);
  const first = results[0];
  const last = results[results.length - 1];
  if (first?.isPending) return <ProductGrid items={[]} variant="grid" loading />;
  if (first?.isError) return <ErrorState variant="inline" message={loadErrorText(first.error)} onRetry={() => void first.refetch()} />;
  return (
    <>
      <ProductGrid items={view.items} variant="grid" />
      {last?.isError && <ErrorState variant="inline" message={loadErrorText(last.error)} onRetry={() => void last.refetch()} />}
      {view.hasMore && !last?.isError && (
        <div className="mt-4">
          <Button variant="secondary" fullWidth loading={last?.isPending} onPress={() => setPages((n) => n + 1)}>
            {fillCopy('shop.loadMore')}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Thân trang một chiến dịch (banner bấm vào), bản web của `pages/campaign.tsx` ở Mini App: ảnh đầu trang, tên (h1 duy nhất), thời gian, mã giảm giá
 * gắn kèm (sao chép được, khách chưa đăng nhập cũng xem) và lưới sản phẩm "Xem thêm" từng 20 món. Trang 1 của lưới do server dựng sẵn.
 */
export function CampaignBody({ campaign: c, initialProducts }: { campaign: CampaignDetail; initialProducts?: PageResponse<ProductCard> | undefined }) {
  const { copy, notice } = useCouponUse();
  const vouchers = useMemo(() => campaignVoucherViews(c.coupons, serverNow()), [c.coupons]);
  const range = campaignDateRange(c);
  const couponsLabel = fillCopy('campaign.sectionCoupons');
  const productsLabel = fillCopy('campaign.sectionProducts');
  const showProducts = c.productCount > 0;
  return (
    <>
      <PageHeader title={c.title} {...(c.subtitle ? { subtitle: c.subtitle } : {})} backHref="/" backLabel={fillCopy('campaign.backHome')} />
      <div className="mt-3 flex flex-col gap-4">
        {c.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={c.image}
            alt=""
            decoding="async"
            className="md:mx-auto md:max-w-3xl"
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
            <div className="grid gap-2 md:grid-cols-2">
              {vouchers.map((v) => (
                <div key={v.code}>
                  <VoucherTicket voucher={v} variant="ticket" primary={{ label: fillCopy('campaign.copyCode'), onClick: () => void copy(v.code) }} />
                  {notice && notice.code === v.code && (
                    <p role={notice.error ? 'alert' : 'status'} className={`mt-1.5 text-caption ${notice.error ? 'text-danger-fg' : 'text-stone-700'}`}>
                      {notice.text}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        {showProducts ? (
          <section aria-label={productsLabel}>
            <SectionHeader title={productsLabel} />
            <Products slug={c.slug} initial={initialProducts} />
          </section>
        ) : (
          vouchers.length === 0 && (
            <Text variant="body-sm" tone="secondary" style={{ textAlign: 'center', padding: '24px 0' }}>
              {fillCopy('campaign.productsEmpty')}
            </Text>
          )
        )}
      </div>
    </>
  );
}
