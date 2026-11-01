'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { collectRows, filterVouchers, historyRows, mineRows, voucherFilters, VOUCHER_TABS, type VoucherFilter, type VoucherRow, type VoucherTab } from '@tubutree/app-core/commerce/voucher-center';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { isCouponExpiring } from '@tubutree/app-core/home-layout';
import { collectableCouponsQuery, collectableMineQuery, couponHistoryQuery, couponsQuery } from '@tubutree/app-core/queries/loyalty';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Chip, EmptyState, SegmentedTabs, Skeleton, VoucherTicket } from '@/components/mini';
import { LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { loadErrorText } from '@/lib/error-text';
import { useClaimCoupon } from '@/lib/use-claim-coupon';
import { useCouponUse } from '@/lib/use-coupon-use';

const BASE = '/ma-giam-gia';
const TAB_KEYS = VOUCHER_TABS.map((t) => t.key);
const parseTab = (raw: string | null): VoucherTab => (TAB_KEYS.includes(raw as VoucherTab) ? (raw as VoucherTab) : 'claim');

/**
 * Mã giảm giá của web, cùng ba tab với `pages/vouchers.tsx` của Mini App: Nhận mã (kho công khai, khách chưa đăng nhập xem được),
 * Mã của tôi (ví) và Đã dùng–hết hạn (lịch sử). Tab nằm trên URL (`?tab=`, replace: Back rời trang chứ không tua từng tab). Chỉ tab cần
 * tài khoản mới gọi `/me/*`. Tab và chip lọc dính chung một khối: hai hàng dính riêng sẽ phải đoán chiều cao hàng tab để đặt hàng chip.
 */
export default function VouchersView() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = parseTab(params.get('tab'));
  const search = params.toString();
  const returnTo = search ? `${BASE}?${search}` : BASE;
  const [filter, setFilter] = useState<VoucherFilter>('all');
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const { claim, pendingCode, notice: claimNotice } = useClaimCoupon(returnTo);
  const { use: applyCoupon, notice: couponNotice } = useCouponUse();

  const collectableQ = useQuery(collectableCouponsQuery(coreHttp));
  const walletQ = useQuery({ ...couponsQuery(coreHttp), enabled: authed });
  const mineQ = useQuery({ ...collectableMineQuery(coreHttp), enabled: authed });
  const historyQ = useQuery({ ...couponHistoryQuery(coreHttp), enabled: authed && tab === 'history' });

  const now = Date.now();
  const walletCodes = useMemo(() => new Set((walletQ.data ?? []).map((c) => c.code)), [walletQ.data]);
  const rows = useMemo<VoucherRow[]>(() => {
    if (tab === 'claim') return collectRows(collectableQ.data ?? [], walletCodes, Date.now(), mineQ.data);
    if (tab === 'mine') return mineRows(walletQ.data ?? [], Date.now());
    return historyRows(historyQ.data ?? [], Date.now());
  }, [tab, collectableQ.data, walletCodes, mineQ.data, walletQ.data, historyQ.data]);

  const filters = voucherFilters(rows.map((r) => r.view));
  const activeFilter = filters.some((f) => f.key === filter) ? filter : 'all';
  const shown = filterVouchers(rows, activeFilter, now);
  const activeLabel = VOUCHER_TABS.find((t) => t.key === tab)!.label;

  const pickTab = (key: string) => {
    if (key === tab) return;
    setFilter('all');
    router.replace(key === 'claim' ? BASE : `${BASE}?tab=${key}`);
  };

  const primaryFor = (row: VoucherRow) => {
    if (row.view.state === 'collectable') return { label: fillCopy('coupon.save'), onClick: () => void claim(row.view.code), busy: pendingCode === row.view.code };
    if (row.view.state === 'saved') return { label: fillCopy('coupon.use'), onClick: () => void applyCoupon(row.view.code) };
    return undefined;
  };

  const skeleton = (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height={88} radius="var(--radius-card)" />
      ))}
    </div>
  );

  const needsAccount = tab !== 'claim' && !authed;
  const source = tab === 'claim' ? collectableQ : tab === 'mine' ? walletQ : historyQ;
  let body: ReactNode;
  if (needsAccount) {
    body = phase === 'loading' ? skeleton : phase === 'unavailable' ? <SessionUnavailable /> : <LoginRequired message={homeCopy.offers.loginBody} returnTo={returnTo} />;
  } else if (source.isError && rows.length === 0) {
    body = <ErrorState variant="inline" title={fillCopy('coupon.loadError')} message={loadErrorText(source.error)} onRetry={() => void source.refetch()} />;
  } else if (source.isLoading || (tab === 'claim' && (authed ? walletQ.isLoading || mineQ.isLoading : phase === 'loading'))) {
    body = skeleton;
  } else if (rows.length === 0) {
    body = <EmptyState variant="inline" art="leaf" heading={emptyHeading(tab)} body={tab === 'mine' ? fillCopy('coupon.emptyMineBody') : undefined} />;
  } else if (shown.length === 0) {
    body = <EmptyState variant="inline" art="leaf" heading={fillCopy('coupon.emptyFilterTitle')} />;
  } else {
    body = (
      <div data-testid="voucher-grid" className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {shown.map((row) => (
          <VoucherTicket key={row.view.code} voucher={row.view} variant="ticket" primary={primaryFor(row)} reason={row.reason} expiring={isCouponExpiring(row.coupon, now)} />
        ))}
      </div>
    );
  }

  const notice = couponNotice ?? claimNotice;
  return (
    <>
      <PageHeader title={fillCopy('coupon.title')} subtitle={fillCopy('coupon.oneCodeHint')} backHref="/uu-dai" />
      {/* Dính dưới thanh lùi đặc ở điện thoại (`sticky-below-back` đặt top đúng), dưới thanh đầu từ md. */}
      <div className="sticky-below-back sticky top-0 z-[2] -mx-4 bg-[var(--color-bg-canvas)] px-4 pb-1 pt-2 md:top-[var(--header-h)] md:mx-0 md:px-0">
        <div className="md:w-fit md:max-w-full">
          <SegmentedTabs scroll label={fillCopy('coupon.tabsLabel')} items={[...VOUCHER_TABS]} value={tab} onChange={pickTab} />
        </div>
        {!needsAccount && rows.length > 0 && (
          <div className="scroll-x flex gap-2 pb-1 pt-2">
            {filters.map((f) => (
              <Chip key={f.key} selected={f.key === activeFilter} onPress={() => setFilter(f.key)}>
                {f.label}
              </Chip>
            ))}
          </div>
        )}
      </div>
      {notice && (
        <p role={notice.error ? 'alert' : 'status'} className={`mt-2 text-caption ${notice.error ? 'text-danger-fg' : 'text-stone-700'}`}>
          {notice.text}
        </p>
      )}
      <div role="tabpanel" aria-label={activeLabel} className="pb-6 pt-2">
        {body}
      </div>
    </>
  );
}

function emptyHeading(tab: VoucherTab): string {
  if (tab === 'claim') return fillCopy('coupon.emptyClaimTitle');
  if (tab === 'mine') return fillCopy('coupon.emptyMineTitle');
  return fillCopy('coupon.emptyHistoryTitle');
}
