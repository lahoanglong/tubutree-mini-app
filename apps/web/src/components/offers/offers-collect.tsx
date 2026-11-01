'use client';

// Nguồn: apps/miniapp/src/components/offers/offers-collect.tsx
import { useEffect, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { collectRows } from '@tubutree/app-core/commerce/voucher-center';
import { COLLECT_HINT_MAX, isCouponExpiring, readCollectHint, writeCollectHint } from '@tubutree/app-core/home-layout';
import { collectableCouponsQuery, collectableMineQuery } from '@tubutree/app-core/queries/loyalty';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { SectionHeader, Skeleton, VoucherTicket } from '@/components/mini';
import { ErrorState } from '@/components/ui/error-state';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { loadErrorText } from '@/lib/error-text';
import { browserStorage } from '@/lib/recently-viewed';
import { useClaimCoupon } from '@/lib/use-claim-coupon';

const HEADER_HEIGHT = 44;
const TICKET_HEIGHT = 88;
/** Một cột ở điện thoại như Mini App, hai ở md, ba từ lg; khung chờ dùng đúng lưới này để không lệch ở mọi cỡ. */
const GRID = 'grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3';

/**
 * Nhận mã ở Ưu đãi (Q10): 3 mã đầu còn nhận được ngay; mã đã nhận (còn trong ví hay đã dùng hết), hết lượt hoặc chỉ dành khách mới mà khách đã có đơn
 * không chiếm chỗ (chúng nằm ở Mã của tôi và ở `/ma-giam-gia`), nên thẻ ở đây luôn nhận được thật.
 * Khách chưa đăng nhập vẫn thấy mã, bấm "Lưu mã" đi tới đăng nhập. Không có mã nào thì ẩn khối; tải lỗi thì báo tại chỗ với "Thử lại", không kéo cả trang.
 * Lần mở trước có n thẻ thì lúc tải giữ chỗ đúng n ô (tiêu đề + ô thẻ), nên khối vào chỗ không đẩy các khối dưới. Web không có snackbar: kết quả nhận mã là một dòng ngay dưới tiêu đề.
 */
export function OffersCollect({ walletCodes, walletLoading }: { walletCodes: ReadonlySet<string>; walletLoading: boolean }) {
  const titleId = useId();
  const router = useRouter();
  const { claim, pendingCode, notice } = useClaimCoupon('/uu-dai');
  const q = useQuery(collectableCouponsQuery(coreHttp));
  const authed = useAuthPhase() === 'authenticated';
  const mineQ = useQuery({ ...collectableMineQuery(coreHttp), enabled: authed });
  const [hinted] = useState(() => readCollectHint(browserStorage()));

  // Cả kho (kể cả mã đã lưu, đã dùng): nhãn "Tất cả n mã" phải bằng số thẻ `/ma-giam-gia` sẽ vẽ.
  const all = useMemo(() => collectRows(q.data ?? [], walletCodes, Date.now(), mineQ.data), [q.data, walletCodes, mineQ.data]);
  const claimable = useMemo(() => all.filter((r) => r.view.state === 'collectable'), [all]);
  const shown = claimable.slice(0, COLLECT_HINT_MAX);
  const loadingMine = authed && mineQ.isLoading;
  const settled = q.isSuccess && !walletLoading && !loadingMine;
  useEffect(() => {
    if (settled) writeCollectHint(browserStorage(), shown.length);
  }, [settled, shown.length]);

  const title = fillCopy('coupon.tabClaim');
  if (q.isLoading || ((walletLoading || loadingMine) && q.isSuccess)) {
    if (hinted === 0) return null;
    return (
      <div data-testid="offers-collect-loading" aria-hidden="true">
        <div style={{ height: HEADER_HEIGHT }} />
        <div className={GRID}>
          {Array.from({ length: hinted }, (_, i) => (
            <Skeleton key={i} height={TICKET_HEIGHT} radius="var(--radius-card)" />
          ))}
        </div>
      </div>
    );
  }
  if (q.isError && shown.length === 0) {
    return (
      <section aria-labelledby={titleId}>
        <SectionHeader id={titleId} title={title} icon="ticket" />
        <ErrorState variant="inline" title={fillCopy('coupon.loadError')} message={loadErrorText(q.error)} onRetry={() => void q.refetch()} />
      </section>
    );
  }
  if (shown.length === 0) return null;

  const now = Date.now();
  return (
    <section aria-labelledby={titleId}>
      <SectionHeader
        id={titleId}
        title={title}
        icon="ticket"
        action={{
          label: fillCopy('coupon.allCount', { n: all.length }),
          onPress: () => router.push('/ma-giam-gia'),
          spoken: fillCopy('section.seeAllSpoken', { title: fillCopy('coupon.title') }),
        }}
      />
      {notice && (
        <p role={notice.error ? 'alert' : 'status'} className={`mb-2 text-caption ${notice.error ? 'text-danger-fg' : 'text-stone-700'}`}>
          {notice.text}
        </p>
      )}
      <div data-testid="offers-collect-grid" className={GRID}>
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
