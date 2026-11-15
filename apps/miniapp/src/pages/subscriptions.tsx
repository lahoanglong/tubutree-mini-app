import { Page } from 'zmp-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { bestSellersListQuery } from '@tubutree/app-core/queries/browse';
import { PullToRefresh } from '../components/pull-to-refresh';
import { SubscriptionsPanel } from '../components/subscriptions-panel';
import { Button } from '../components/ui/button';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';
import { ProductGrid } from '../components/ui/product-grid';
import { Heading, Text } from '../components/ui/text';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { useHasSubscription } from '../hooks/use-has-subscription';
import { usePublicConfig } from '../hooks/use-public-config';
import { useSmartNavigate } from '../lib/smart-nav';
import { getLoadErrorMessage } from '../services/api';
import { coreHttp } from '../services/core-http';
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
  const basePct = Math.max(10, Math.round((cfg.subscribeDiscountPct || 0.12) * 100));
  const { hasSubscription } = useHasSubscription(authed);

  const products = useInfiniteQuery(bestSellersListQuery(coreHttp, undefined));
  const list = uniqueById(products.data?.pages.flatMap((pg) => pg.data) ?? []).filter(
    (p) => p.fulfiller?.kind !== 'MERCHANT' && p.fulfiller?.kind !== 'UNAVAILABLE',
  );

  return (
    <Page className="tubu-subs-page">
      <PullToRefresh onRefresh={() => products.refetch()} />
      <PageHeader title="Mua xoay vòng" subtitle="Đặt định kỳ tự động · Tiết kiệm mỗi kỳ giao" />

      <div className="tubu-subs-body">
        <section aria-label="Quyền lợi Mua xoay vòng" data-testid="subscription-hero" className="tubu-subs-hero">
          <span className="tubu-subs-eyebrow">Đặt định kỳ · Tiết kiệm tới 17%</span>
          <Heading variant="title-md" font="ui">Chẳng lo hết đồ thiết yếu giữa chừng</Heading>
          <ul className="tubu-subs-perks">
            <li className="tubu-subs-perk">
              <span aria-hidden="true" className="tubu-subs-dot" />
              <span>Giảm từ {basePct}% ngay kỳ đầu, tăng tới 17% ở các kỳ tiếp theo.</span>
            </li>
            <li className="tubu-subs-perk">
              <span aria-hidden="true" className="tubu-subs-dot" />
              <span>Chu kỳ linh hoạt 4 · 6 · 8 · 10 tuần theo nhịp sinh hoạt gia đình.</span>
            </li>
            <li className="tubu-subs-perk">
              <span aria-hidden="true" className="tubu-subs-dot" />
              <span>Đổi ngày nhận, bỏ qua kỳ hoặc tạm dừng bất cứ lúc nào chỉ với 1 chạm.</span>
            </li>
          </ul>
          <Text variant="caption" tone="secondary" as="p">
            Chọn sản phẩm bên dưới, mở chi tiết món và bấm Đặt định kỳ để bắt đầu.
          </Text>
          {authed && !hasSubscription && (
            <div>
              <Button variant="secondary" size="md" onPress={() => goSmart('/orders?tab=subscriptions')}>
                Xem mục Định kỳ trong Đơn hàng
              </Button>
            </div>
          )}
        </section>

        {authed && hasSubscription && (
          <section aria-label="Lịch định kỳ của tôi" className="tubu-subs-section">
            <Heading variant="title-md" font="ui">Lịch định kỳ đang chạy</Heading>
            <SubscriptionsPanel />
          </section>
        )}

        <section aria-label="Sản phẩm đặt xoay vòng" data-testid="subscription-products" className="tubu-subs-section">
          <Heading variant="title-md" font="ui">Sản phẩm tiêu dùng phù hợp đặt xoay vòng</Heading>
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
    </Page>
  );
}
