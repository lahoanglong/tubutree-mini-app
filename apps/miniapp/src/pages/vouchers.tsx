import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Page } from 'zmp-ui';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { collectRows, filterVouchers, historyRows, isVoucherRowExpiring, mineRows, voucherFilters, VOUCHER_TABS, walletCodeSet, type VoucherFilter, type VoucherRow, type VoucherTab } from '@tubutree/app-core/commerce/voucher-center';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { collectableCouponsQuery, collectableMineQuery, couponHistoryQuery, couponsQuery } from '@tubutree/app-core/queries/loyalty';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { PullToRefresh } from '../components/pull-to-refresh';
import { GuestLinkCard } from '../components/home/guest-link-card';
import { AuthPhaseView } from '../components/ui/auth-gate';
import { Chip } from '../components/ui/chip';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { Skeleton } from '../components/ui/skeleton';
import { VoucherTicket } from '../components/ui/voucher-ticket';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { useMarkExpiringSeen } from '../hooks/use-offers-dot';
import { useClaimCoupon } from '../hooks/use-claim-coupon';
import { useCouponUse } from '../hooks/use-coupon-use';
import { getLoadErrorMessage } from '../services/api';
import { coreHttp } from '../services/core-http';
import { useAuthStore } from '../store/auth';

const PAGE_STYLE: CSSProperties = { background: 'var(--color-bg-canvas)', paddingBottom: 32 };

/**
 * Tab và chip lọc dính chung một khối ngay dưới thanh lùi đặc (xem `/best-sellers`): hai hàng dính riêng sẽ phải đoán chiều cao
 * hàng tab để đặt hàng chip, lệch một pixel là thẻ lộ ra giữa hai hàng. Trang không dùng lớp `page`: `top` là `--safe-top` và lớp `sticky-below-back` đẩy
 * xuống dưới thanh lùi khi có nút lùi (xem `/best-sellers`).
 */
const STICKY_BAR: CSSProperties = { position: 'sticky', top: 'var(--safe-top)', zIndex: 2, padding: '8px 16px 4px', background: 'var(--color-bg-canvas)' };
const CHIP_ROW: CSSProperties = { display: 'flex', gap: 8, padding: '8px 0 4px' };

const TAB_KEYS = VOUCHER_TABS.map((t) => t.key);
const parseTab = (raw: string | null): VoucherTab => (TAB_KEYS.includes(raw as VoucherTab) ? (raw as VoucherTab) : 'claim');

/**
 * Mã giảm giá: ba tab Nhận mã (kho công khai, khách chưa đăng nhập xem được), Mã của tôi (ví) và Đã dùng–hết hạn (lịch sử). Tab nằm
 * trên URL (`?tab=`, replace: Back rời trang chứ không tua từng tab). Chỉ tab cần tài khoản mới gọi `/me/*`. Mọi thao tác nhận mã
 * đi qua `useClaimCoupon`; chip lọc tính trên chính tab đang xem và đặt lại khi đổi tab.
 */
export default function VouchersPage() {
  const [params, setParams] = useSearchParams();
  const anchorRef = useRef<HTMLDivElement>(null);
  const chipRowRef = useRef<HTMLDivElement>(null);
  const tab = parseTab(params.get('tab'));
  const [filter, setFilter] = useState<VoucherFilter>('all');
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const { claim, pendingCode } = useClaimCoupon();
  const { apply } = useCouponUse();

  const collectableQ = useQuery(collectableCouponsQuery(coreHttp));
  const walletQ = useQuery({ ...couponsQuery(coreHttp), enabled: authed });
  const mineQ = useQuery({ ...collectableMineQuery(coreHttp), enabled: authed });
  const historyQ = useQuery({ ...couponHistoryQuery(coreHttp), enabled: authed && tab === 'history' });

  const now = Date.now();
  // `null` = ví tải lỗi và chưa có dữ liệu nào: không đủ căn cứ nói mã đã nhận là "Đã dùng" (xem `collectRows`).
  const walletCodes = useMemo(() => walletCodeSet(walletQ.data, walletQ.isError), [walletQ.data, walletQ.isError]);
  const rows = useMemo<VoucherRow[]>(() => {
    if (tab === 'claim') return collectRows(collectableQ.data ?? [], walletCodes, Date.now(), mineQ.data);
    if (tab === 'mine') return mineRows(walletQ.data ?? [], Date.now());
    return historyRows(historyQ.data ?? [], Date.now());
  }, [tab, collectableQ.data, walletCodes, mineQ.data, walletQ.data, historyQ.data]);

  const filters = voucherFilters(rows.map((r) => r.view));
  const activeFilter = filters.some((f) => f.key === filter) ? filter : 'all';
  const shown = filterVouchers(rows, activeFilter, now);
  const activeLabel = VOUCHER_TABS.find((t) => t.key === tab)!.label;
  // Ghi "đã xem" cho mã sắp hết hạn chỉ ở tab Mã của tôi và chỉ các thẻ đang vẽ (đã qua chip lọc), cùng quy tắc với trang Ưu đãi.
  useMarkExpiringSeen(authed && tab === 'mine' ? shown.map((r) => r.coupon) : undefined);

  const pickTab = (key: string) => {
    if (key === tab) return;
    // Về đầu trang trước khi ghi URL: nội dung mới ngắn hơn có thể kẹp vị trí cuộn về giữa trang.
    const scroller = anchorRef.current?.closest<HTMLElement>('.zaui-page');
    if (scroller) scroller.scrollTop = 0;
    const next = new URLSearchParams(params);
    if (key === 'claim') next.delete('tab');
    else next.set('tab', key);
    setFilter('all');
    setParams(next, { replace: true });
  };

  const resetFilter = () => {
    setFilter('all');
    // Nút vừa bấm nằm trong khối trạng thái rỗng sắp biến mất: trả focus về chip Tất cả để người dùng bàn phím không rơi về đầu trang.
    requestAnimationFrame(() => chipRowRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus());
  };

  const refresh = () =>
    Promise.all([collectableQ.refetch(), authed ? walletQ.refetch() : null, authed ? mineQ.refetch() : null, authed && tab === 'history' ? historyQ.refetch() : null]);

  const primaryFor = (row: VoucherRow) => {
    if (row.unverified) return undefined;
    if (row.view.state === 'collectable') {
      return { label: fillCopy('coupon.save'), onClick: () => void claim(row.view.code), busy: pendingCode === row.view.code };
    }
    if (row.view.state === 'saved') return { label: fillCopy('coupon.use'), onClick: () => void apply(row.view.code) };
    return undefined;
  };

  const loginPrompt = (
    <EmptyState art="sprout" heading={homeCopy.offers.loginTitle} body={homeCopy.offers.loginBody} ctaLabel="Đăng nhập ngay" onCta={() => void useAuthStore.getState().login()} />
  );
  const skeleton = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-busy="true">
      <Skeleton height={88} radius="var(--radius-card)" />
      <Skeleton height={88} radius="var(--radius-card)" />
      <Skeleton height={88} radius="var(--radius-card)" />
    </div>
  );
  const failed = (q: { error: unknown; isFetching: boolean; refetch: () => unknown }) => (
    <ErrorState variant="inline" title={fillCopy('coupon.loadError')} message={getLoadErrorMessage(q.error)} retrying={q.isFetching} onRetry={() => q.refetch()} />
  );

  const needsAccount = tab !== 'claim' && phase !== 'authenticated';
  const source = tab === 'claim' ? collectableQ : tab === 'mine' ? walletQ : historyQ;
  let body: ReactNode;
  if (phase !== 'authenticated' && tab !== 'claim') {
    body = <AuthPhaseView phase={phase} loading={skeleton} guest={loginPrompt} />;
  } else if (source.isError && rows.length === 0) {
    body = failed(source);
  } else if (source.isLoading || (tab === 'claim' && (authed ? walletQ.isLoading || mineQ.isLoading : phase === 'loading'))) {
    body = skeleton;
  } else if (rows.length === 0) {
    // Ví trống: một chạm về tab Nhận mã (chữ hướng dẫn đã nhắc "Lưu mã ở mục Nhận mã"). Nhận mã và Lịch sử trống không có việc tiếp theo.
    body = (
      <EmptyState
        variant="inline"
        art="leaf"
        heading={emptyHeading(tab)}
        body={tab === 'mine' ? fillCopy('coupon.emptyMineBody') : undefined}
        ctaLabel={tab === 'mine' ? fillCopy('coupon.tabClaim') : undefined}
        onCta={tab === 'mine' ? () => pickTab('claim') : undefined}
      />
    );
  } else if (shown.length === 0) {
    body = <EmptyState variant="inline" art="leaf" heading={fillCopy('coupon.emptyFilterTitle')} ctaLabel={fillCopy('coupon.emptyFilterCta')} onCta={resetFilter} />;
  } else {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {shown.map((row) => (
          <VoucherTicket key={row.view.code} voucher={row.view} variant="ticket" primary={primaryFor(row)} reason={row.reason} expiring={isVoucherRowExpiring(row, now)} />
        ))}
      </div>
    );
  }

  return (
    <Page className="tubu-nums" style={PAGE_STYLE}>
      <PullToRefresh onRefresh={refresh} />
      <div ref={anchorRef} />
      <PageHeader title={fillCopy('coupon.title')} subtitle={fillCopy('coupon.oneCodeHint')} />
      <div className="sticky-below-back" style={STICKY_BAR}>
        <SegmentedTabs scroll label={fillCopy('coupon.tabsLabel')} items={[...VOUCHER_TABS]} value={tab} onChange={pickTab} />
        {!needsAccount && rows.length > 0 && (
          <div ref={chipRowRef} className="scroll-x" style={CHIP_ROW}>
            {filters.map((f) => (
              <Chip key={f.key} selected={f.key === activeFilter} onPress={() => setFilter(f.key)}>
                {f.label}
              </Chip>
            ))}
          </div>
        )}
      </div>
      {authed && tab !== 'claim' && <GuestLinkCard title={homeCopy.offers.guestTitle} body={homeCopy.offers.guestBody} cta={homeCopy.profile.guestCta} />}
      <div role="tabpanel" aria-label={activeLabel} style={{ padding: '8px 16px 24px' }}>
        {tab === 'claim' && authed && walletCodes === null && (
          <div style={{ marginBottom: 12 }}>
            <ErrorState variant="inline" title={fillCopy('coupon.walletLoadError')} message={getLoadErrorMessage(walletQ.error)} retrying={walletQ.isFetching} onRetry={() => walletQ.refetch()} />
          </div>
        )}
        {body}
      </div>
    </Page>
  );
}

function emptyHeading(tab: VoucherTab): string {
  if (tab === 'claim') return fillCopy('coupon.emptyClaimTitle');
  if (tab === 'mine') return fillCopy('coupon.emptyMineTitle');
  return fillCopy('coupon.emptyHistoryTitle');
}
