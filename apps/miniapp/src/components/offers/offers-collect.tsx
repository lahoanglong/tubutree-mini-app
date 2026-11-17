import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CouponDTO } from '@tubutree/app-core/api/loyalty';
import { seeAllLabel } from '@tubutree/app-core/commerce/see-all';
import { collectRows, filterVouchers, isVoucherRowExpiring, voucherFilters, walletCodeSet, type VoucherFilter, type VoucherRow } from '@tubutree/app-core/commerce/voucher-center';
import { collectSkeletonHeight, COLLECT_HINT_MAX, readCollectHint, writeCollectHint } from '@tubutree/app-core/home-layout';
import { collectableCouponsQuery, collectableMineQuery } from '@tubutree/app-core/queries/loyalty';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useAuthPhase } from '../../hooks/use-auth-phase';
import { useClaimCoupon } from '../../hooks/use-claim-coupon';
import { useCouponUse } from '../../hooks/use-coupon-use';
import { getLoadErrorMessage } from '../../services/api';
import { coreHttp } from '../../services/core-http';
import { browserStorage } from '../../utils/recently-viewed';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { EmptyState, ErrorState } from '../ui/empty-state';
import { SectionHeader } from '../ui/section-header';
import { Skeleton } from '../ui/skeleton';
import { VoucherTicket } from '../ui/voucher-ticket';

const HEADER_HEIGHT = 44;
const BLOCK: CSSProperties = {
  padding: 'var(--space-inset-card) var(--space-gutter) 0',
  // Mở từ link thì trang cuộn tới khối: chừa chỗ cho hàng tab dính ở đầu trang để tiêu đề khối không nằm dưới nó.
  scrollMarginTop: 'calc(var(--safe-top) + var(--section-header-h) + var(--space-gutter))',
};
const LIST: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-inset-card)' };
// Hàng chip trong `.scroll-x` cần đệm dọc để vùng chạm 44px của chip không bị cắt (xem Chip).
const CHIP_ROW: CSSProperties = { display: 'flex', gap: 'var(--space-stack-sm)', padding: 'var(--space-stack-xs) 0 var(--space-stack-sm)' };

/** Ví mã của khách là query của trang (khoá ['coupons'], tab Mã của tôi dùng chung): khối chỉ cần biết mã nào trong ví và ví có tải lỗi không. */
export interface OffersWallet {
  data: readonly CouponDTO[] | undefined;
  isError: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => unknown;
}

/**
 * Nhận mã ở Ưu đãi (Q10). Gập: 3 mã đầu còn nhận được ngay; mã đã nhận (còn trong ví hay đã dùng hết), hết lượt hoặc chỉ dành khách mới mà khách đã có đơn
 * không chiếm chỗ, nên thẻ ở đây luôn nhận được thật. "Tất cả (n)" mở ngay tại chỗ CẢ kho (thay trang Mã giảm giá cũ): mọi mã kể cả đã lưu ("Dùng ngay"),
 * đã dùng, hết lượt, kèm chip lọc; "Thu gọn" về 3 mã. `openAll` (`?codes=all`, lối tắt Mã giảm giá, link cũ `/vouchers`) mở sẵn và cuộn tới khối.
 * Khách chưa đăng nhập vẫn thấy mã, bấm "Lưu mã" mở đăng nhập. Gập mà không có mã nào nhận được thì ẩn khối; tải lỗi thì báo tại chỗ với "Thử lại".
 * Lần mở trước có n thẻ thì lúc tải giữ chỗ đúng n thẻ (header + thẻ), mở sẵn thì giữ chỗ 3 thẻ, nên khối vào chỗ không đẩy các khối dưới.
 * Ví tải lỗi (chưa có dữ liệu): mã đã nhận không bị ghi "Đã dùng" (`walletCodeSet` trả null) và khối mở có dải báo lỗi kèm "Thử lại" tải lại ví.
 */
export function OffersCollect({ wallet, openAll = false }: { wallet: OffersWallet; openAll?: boolean }) {
  const titleId = useId();
  const listId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const chipRowRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const { claim, pendingCode } = useClaimCoupon();
  const { apply } = useCouponUse();
  const q = useQuery(collectableCouponsQuery(coreHttp));
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const mineQ = useQuery({ ...collectableMineQuery(coreHttp), enabled: authed });
  const [hinted] = useState(() => readCollectHint(browserStorage()));
  const [expanded, setExpanded] = useState(openAll);
  const [filter, setFilter] = useState<VoucherFilter>('all');

  // `null` = ví lỗi mà chưa có dữ liệu: không đủ căn cứ nói mã đã nhận là "Đã dùng" (xem `collectRows`).
  const walletCodes = useMemo(() => walletCodeSet(wallet.data, wallet.isError), [wallet.data, wallet.isError]);
  const walletLoading = phase === 'loading' || (authed && wallet.isLoading);
  // Cả kho (kể cả mã đã lưu, đã dùng): nhãn "Tất cả n mã" bằng số thẻ khối mở sẽ vẽ.
  const all = useMemo(() => collectRows(q.data ?? [], walletCodes, Date.now(), mineQ.data), [q.data, walletCodes, mineQ.data]);
  const claimable = useMemo(() => all.filter((r) => r.view.state === 'collectable'), [all]);
  const shown = claimable.slice(0, COLLECT_HINT_MAX);
  const loadingMine = authed && mineQ.isLoading;
  const settled = q.isSuccess && !walletLoading && !loadingMine;
  const loading = q.isLoading || ((walletLoading || loadingMine) && q.isSuccess);
  useEffect(() => {
    if (settled) writeCollectHint(browserStorage(), shown.length);
  }, [settled, shown.length]);
  // Mở từ link: cuộn một lần, khi khối đã có nội dung thật (khung chờ cao khác khối thật).
  // Đang ở Ưu đãi mà bấm lối tắt Mã giảm giá (`?codes=all`): trang không dựng lại nên mở kho và cuộn tới khối lần nữa.
  useEffect(() => {
    if (!openAll) return;
    setExpanded(true);
    scrolled.current = false;
  }, [openAll]);
  useEffect(() => {
    if (!openAll || loading || scrolled.current) return;
    scrolled.current = true;
    sectionRef.current?.scrollIntoView?.({ block: 'start' });
  }, [openAll, loading]);

  const title = fillCopy('coupon.tabClaim');
  if (loading) {
    const height = collectSkeletonHeight(expanded ? COLLECT_HINT_MAX : hinted);
    if (height === 0) return null;
    return (
      <div data-testid="offers-collect-loading" aria-hidden="true" style={BLOCK}>
        <div style={{ height: HEADER_HEIGHT }} />
        <Skeleton height={height} radius="var(--radius-card)" />
      </div>
    );
  }
  if (q.isError && (expanded ? all.length === 0 : shown.length === 0)) {
    return (
      <section ref={sectionRef} aria-labelledby={titleId} style={BLOCK}>
        <SectionHeader id={titleId} title={title} icon="ticket" />
        <ErrorState variant="inline" title={fillCopy('coupon.loadError')} message={getLoadErrorMessage(q.error)} retrying={q.isFetching} onRetry={() => q.refetch()} />
      </section>
    );
  }
  if (!expanded && shown.length === 0) return null;

  const now = Date.now();
  // Cùng cách ghi với "Mã của tôi" ("Tất cả (n)"); tên đọc mang đủ nhãn nhìn thấy cộng đích đến.
  const seeAll = seeAllLabel(all.length);
  const focusSelectedChip = () => requestAnimationFrame(() => chipRowRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus());
  const expand = () => {
    setExpanded(true);
    // Nút vừa bấm biến mất (khối mở không có "Tất cả"): đưa focus vào chip đang chọn để người dùng bàn phím không rơi về đầu trang.
    focusSelectedChip();
  };
  const collapse = () => {
    setExpanded(false);
    setFilter('all');
    requestAnimationFrame(() => {
      const el = sectionRef.current;
      el?.querySelector<HTMLButtonElement>('[data-testid="section-header"] button')?.focus({ preventScroll: true });
      // Danh sách vừa ngắn lại: khách đang ở cuối kho thì đưa tiêu đề khối về tầm nhìn thay vì để trang nhảy sang khối dưới.
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView?.({ block: 'start' });
    });
  };
  const resetFilter = () => {
    setFilter('all');
    // Nút vừa bấm nằm trong khối trạng thái rỗng sắp biến mất: trả focus về chip Tất cả.
    focusSelectedChip();
  };

  if (!expanded) {
    return (
      <section ref={sectionRef} aria-labelledby={titleId} style={BLOCK}>
        <SectionHeader id={titleId} title={title} icon="ticket" action={seeAll ? { label: seeAll, onPress: expand, spoken: `${seeAll} ${fillCopy('coupon.title')}` } : undefined} />
        <div style={LIST}>
          {shown.map((row) => (
            <VoucherTicket
              key={row.view.code}
              voucher={row.view}
              variant="ticket"
              primary={{ label: fillCopy('coupon.save'), onClick: () => void claim(row.view.code), busy: pendingCode === row.view.code }}
              expiring={isVoucherRowExpiring(row, now)}
            />
          ))}
        </div>
      </section>
    );
  }

  const filters = voucherFilters(all.map((r) => r.view));
  const activeFilter = filters.some((f) => f.key === filter) ? filter : 'all';
  const rows = filterVouchers(all, activeFilter, now);
  const primaryFor = (row: VoucherRow) => {
    if (row.unverified) return undefined;
    if (row.view.state === 'collectable') return { label: fillCopy('coupon.save'), onClick: () => void claim(row.view.code), busy: pendingCode === row.view.code };
    if (row.view.state === 'saved') return { label: fillCopy('coupon.use'), onClick: () => void apply(row.view.code) };
    return undefined;
  };
  return (
    <section ref={sectionRef} aria-labelledby={titleId} style={BLOCK}>
      <SectionHeader id={titleId} title={title} icon="ticket" subtitle={fillCopy('coupon.oneCodeHint')} />
      {authed && walletCodes === null && (
        <div style={{ marginBottom: 'var(--space-inset-card)' }}>
          <ErrorState variant="inline" title={fillCopy('coupon.walletLoadError')} message={getLoadErrorMessage(wallet.error)} retrying={wallet.isFetching} onRetry={() => wallet.refetch()} />
        </div>
      )}
      {all.length > 0 && (
        <div ref={chipRowRef} className="scroll-x" style={CHIP_ROW}>
          {filters.map((f) => (
            <Chip key={f.key} selected={f.key === activeFilter} onPress={() => setFilter(f.key)}>
              {f.label}
            </Chip>
          ))}
        </div>
      )}
      <div id={listId} style={LIST}>
        {all.length === 0 ? (
          <EmptyState variant="inline" art="leaf" heading={fillCopy('coupon.emptyClaimTitle')} />
        ) : rows.length === 0 ? (
          <EmptyState variant="inline" art="leaf" heading={fillCopy('coupon.emptyFilterTitle')} ctaLabel={fillCopy('coupon.emptyFilterCta')} onCta={resetFilter} />
        ) : (
          rows.map((row) => (
            <VoucherTicket key={row.view.code} voucher={row.view} variant="ticket" primary={primaryFor(row)} reason={row.reason} expiring={isVoucherRowExpiring(row, now)} />
          ))
        )}
      </div>
      {all.length > 0 && (
        <Button variant="ghost" fullWidth aria-expanded aria-controls={listId} onPress={collapse} style={{ marginTop: 'var(--space-stack-sm)' }}>
          {fillCopy('offers.codesCollapse')}
        </Button>
      )}
    </section>
  );
}
