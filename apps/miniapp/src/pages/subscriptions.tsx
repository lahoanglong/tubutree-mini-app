import { useState } from 'react';
import { Page } from 'zmp-ui';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { bestSellersListQuery } from '@tubutree/app-core/queries/browse';
import { subscribePct } from '@tubutree/app-core/commerce/pdp-info';
import type { SubscriptionSuggestion } from '@tubutree/app-core/commerce/green-box';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { PullToRefresh } from '../components/pull-to-refresh';
import { SubscriptionSuggestionRow, SuggestedSubscribe, useSubscriptionSuggestion } from '../components/reorder/subscription-suggestion';
import { SubscriptionsPanel } from '../components/subscriptions-panel';
import { Button } from '../components/ui/button';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';
import { ProductGrid } from '../components/ui/product-grid';
import { Heading } from '../components/ui/text';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { hasLiveSubscription } from '../hooks/use-has-subscription';
import { usePublicConfig } from '../hooks/use-public-config';
import { useSmartNavigate } from '../lib/smart-nav';
import { getLoadErrorMessage } from '../services/api';
import { coreHttp } from '../services/core-http';
import { getSubscriptions } from '../services/subscriptions-api';
import { uniqueById } from '../utils/unique-by-id';
import '../css/ecosystem-hub.css';

/**
 * Trang đích "Mua xoay vòng (Đặt định kỳ)" của Mini App (/subscriptions):
 * - Khách vãng lai và khách mới chưa đăng nhập vẫn xem rõ 3 quyền lợi xoay vòng + danh sách sản phẩm đặt định kỳ ngay lập tức.
 * - Khách đã đăng nhập và đang có gói định kỳ thấy ngay bảng quản lý gói (SubscriptionsPanel) ngay trên kệ sản phẩm.
 */
export default function SubscriptionsPage() {
  const goSmart = useSmartNavigate();
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const cfg = usePublicConfig();
  // Số trên màn phải đúng số máy chủ tính: cấu hình thiếu hay sai thì không nêu số, không tự đặt sàn.
  const pct = subscribePct(cfg.subscribeDiscountPct);
  // Đọc thẳng danh sách gói (cùng khoá với tab Định kỳ): `useHasSubscription` chỉ gọi API khi Mini App tắt lối tạo gói, nên khi cờ bật nó luôn báo "chưa có".
  const subsQ = useQuery({ queryKey: ['subscriptions'], queryFn: getSubscriptions, enabled: authed });
  const hasSubscription = hasLiveSubscription(subsQ.data);
  const noOpenSub = authed && subsQ.isSuccess && !hasSubscription;
  const { suggestion, discountFraction } = useSubscriptionSuggestion(noOpenSub);
  const [subscribeTo, setSubscribeTo] = useState<SubscriptionSuggestion | null>(null);

  const products = useInfiniteQuery(bestSellersListQuery(coreHttp, undefined));
  const list = uniqueById(products.data?.pages.flatMap((pg) => pg.data) ?? []).filter(
    (p) => p.fulfiller?.kind !== 'MERCHANT' && p.fulfiller?.kind !== 'UNAVAILABLE',
  );

  return (
    <Page className="tubu-subs-page">
      <PullToRefresh onRefresh={() => products.refetch()} />
      <PageHeader title="Mua xoay vòng" />

      <div className="tubu-subs-body">
        {/* Một dải 40px (UAT iPhone): số % tiết kiệm + lối sang lịch định kỳ, để thẻ sản phẩm lên ngay nửa trên màn; cùng chữ với web /san-pham?filter=subscription. */}
        <section aria-label="Quyền lợi Mua xoay vòng" data-testid="subscription-hero" className="tubu-subs-strip">
          <span className="tubu-subs-strip-text">{pct ? fillCopy('subs.heroEyebrow', { pct }) : fillCopy('subs.heroEyebrowNoPct')}</span>
          <button type="button" className="tubu-subs-strip-link tubu-press" onClick={() => goSmart('/orders?tab=subscriptions')}>
            {fillCopy('subs.myScheduleLink')}
          </button>
        </section>
        {noOpenSub && suggestion && <SubscriptionSuggestionRow suggestion={suggestion} discountFraction={discountFraction} onAccept={setSubscribeTo} />}

        {authed && hasSubscription && (
          <section aria-label="Lịch định kỳ của tôi" className="tubu-subs-section">
            <Heading variant="title-md" font="ui">Lịch định kỳ đang chạy</Heading>
            <SubscriptionsPanel showIntro={false} />
          </section>
        )}

        <section aria-label="Sản phẩm đặt xoay vòng" data-testid="subscription-products" className="tubu-subs-section">
          {products.isLoading ? (
            <ProductGrid items={[]} variant="grid" loading skeletonCount={6} />
          ) : products.isError && list.length === 0 ? (
            <ErrorState message={getLoadErrorMessage(products.error)} retrying={products.isFetching} onRetry={() => products.refetch()} />
          ) : list.length === 0 ? (
            <EmptyState
              art="leaf"
              heading="Xem toàn bộ danh mục sản phẩm"
              body="Mở chi tiết sản phẩm bất kỳ để chọn chu kỳ giao định kỳ."
              ctaLabel="Khám phá sản phẩm"
              onCta={() => goSmart('/browse?all=1')}
            />
          ) : (
            <>
              <ProductGrid items={list} variant="grid" listSource="subscription_hub" />
              <div className="tubu-subs-more">
                <Button variant="secondary" onPress={() => goSmart('/browse?all=1')}>
                  Xem tất cả sản phẩm
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
      {subscribeTo && <SuggestedSubscribe suggestion={subscribeTo} onDone={() => setSubscribeTo(null)} />}
    </Page>
  );
}
