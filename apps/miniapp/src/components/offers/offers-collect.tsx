import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { collectRows } from '@tubutree/app-core/commerce/voucher-center';
import { collectSkeletonHeight, COLLECT_HINT_MAX, isCouponExpiring, readCollectHint, writeCollectHint } from '@tubutree/app-core/home-layout';
import { collectableCouponsQuery } from '@tubutree/app-core/queries/loyalty';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useClaimCoupon } from '../../hooks/use-claim-coupon';
import { getLoadErrorMessage } from '../../services/api';
import { coreHttp } from '../../services/core-http';
import { browserStorage } from '../../utils/recently-viewed';
import { ErrorState } from '../ui/empty-state';
import { SectionHeader } from '../ui/section-header';
import { Skeleton } from '../ui/skeleton';
import { VoucherTicket } from '../ui/voucher-ticket';

const HEADER_HEIGHT = 44;

/**
 * Nhận mã ở Ưu đãi (Q10): 3 mã đầu còn nhận được ngay; mã đã có trong ví hoặc hết lượt không chiếm chỗ (chúng nằm ở Mã của tôi và ở `/vouchers`).
 * Khách chưa đăng nhập vẫn thấy mã, bấm "Lưu mã" mở đăng nhập. Không có mã nào thì ẩn khối; tải lỗi thì báo tại chỗ với "Thử lại", không kéo cả trang.
 * Lần mở trước có n thẻ thì lúc tải giữ chỗ đúng n thẻ (header + thẻ), nên khối vào chỗ không đẩy các khối dưới.
 */
export function OffersCollect({ walletCodes, walletLoading }: { walletCodes: ReadonlySet<string>; walletLoading: boolean }) {
  const titleId = useId();
  const navigate = useNavigate();
  const { claim, pendingCode } = useClaimCoupon();
  const q = useQuery(collectableCouponsQuery(coreHttp));
  const [hinted] = useState(() => readCollectHint(browserStorage()));

  const claimable = useMemo(() => collectRows(q.data ?? [], walletCodes, Date.now()).filter((r) => r.view.state === 'collectable'), [q.data, walletCodes]);
  const shown = claimable.slice(0, COLLECT_HINT_MAX);
  const settled = q.isSuccess && !walletLoading;
  useEffect(() => {
    if (settled) writeCollectHint(browserStorage(), shown.length);
  }, [settled, shown.length]);

  const title = fillCopy('coupon.tabClaim');
  if (q.isLoading || (walletLoading && q.isSuccess)) {
    const height = collectSkeletonHeight(hinted);
    if (height === 0) return null;
    return (
      <div data-testid="offers-collect-loading" aria-hidden="true" style={{ padding: '12px 16px 0' }}>
        <div style={{ height: HEADER_HEIGHT }} />
        <Skeleton height={height} radius="var(--radius-card)" />
      </div>
    );
  }
  if (q.isError && shown.length === 0) {
    return (
      <section aria-labelledby={titleId} style={{ padding: '12px 16px 0' }}>
        <SectionHeader id={titleId} title={title} icon="ticket" />
        <ErrorState variant="inline" title={fillCopy('coupon.loadError')} message={getLoadErrorMessage(q.error)} retrying={q.isFetching} onRetry={() => void q.refetch()} />
      </section>
    );
  }
  if (shown.length === 0) return null;

  const now = Date.now();
  return (
    <section aria-labelledby={titleId} style={{ padding: '12px 16px 0' }}>
      <SectionHeader
        id={titleId}
        title={title}
        icon="ticket"
        action={{
          label: fillCopy('coupon.allCount', { n: claimable.length }),
          onPress: () => navigate('/vouchers'),
          spoken: fillCopy('section.seeAllSpoken', { title: fillCopy('coupon.title') }),
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {shown.map((row) => (
          <VoucherTicket
            key={row.view.code}
            voucher={row.view}
            variant="ticket"
            primary={{ label: fillCopy('coupon.save'), onClick: () => void claim(row.view.code), busy: pendingCode === row.view.code }}
            expiring={isCouponExpiring(row.coupon, now)}
          />
        ))}
      </div>
    </section>
  );
}
