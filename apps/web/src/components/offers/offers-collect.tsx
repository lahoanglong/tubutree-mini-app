'use client';

// Nguồn: apps/miniapp/src/components/offers/offers-collect.tsx
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CouponDTO } from '@tubutree/app-core/api/loyalty';
import { OFFERS_CODES_ALL, OFFERS_CODES_PARAM } from '@tubutree/app-core/commerce/offers-hub';
import { seeAllLabel } from '@tubutree/app-core/commerce/see-all';
import { collectRows, filterVouchers, isVoucherRowExpiring, voucherFilters, walletCodeSet, type VoucherFilter, type VoucherRow } from '@tubutree/app-core/commerce/voucher-center';
import { COLLECT_HINT_MAX, readCollectHint, writeCollectHint } from '@tubutree/app-core/home-layout';
import { collectableCouponsQuery, collectableMineQuery } from '@tubutree/app-core/queries/loyalty';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Button, Chip, EmptyState, SectionHeader, Skeleton, VoucherTicket } from '@/components/mini';
import { ErrorState } from '@/components/ui/error-state';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { loadErrorText } from '@/lib/error-text';
import { browserStorage } from '@/lib/recently-viewed';
import { useClaimCoupon } from '@/lib/use-claim-coupon';
import { useCouponUse } from '@/lib/use-coupon-use';

const HEADER_HEIGHT = 44;
const TICKET_HEIGHT = 88;
/** Một cột ở điện thoại như Mini App, hai ở md, ba từ lg; khung chờ dùng đúng lưới này để không lệch ở mọi cỡ. */
const GRID = 'grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3';
// Mở từ link thì trang cuộn tới khối: chừa chỗ cho hàng tab dính (dưới vùng an toàn ở điện thoại, dưới thanh đầu từ md).
const SCROLL_MARGIN = 'scroll-mt-[calc(var(--safe-top)+var(--section-header-h)+var(--space-gutter))] md:scroll-mt-[calc(var(--header-h)+var(--section-header-h)+var(--space-gutter))]';
const BASE = '/uu-dai';

/** Ví mã của khách là query của trang (khoá ['coupons'], tab Mã của tôi dùng chung): khối chỉ cần biết mã nào trong ví và ví có tải lỗi không. */
export interface OffersWallet {
  data: readonly CouponDTO[] | undefined;
  isError: boolean;
  isLoading: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
}

/**
 * Nhận mã ở Ưu đãi (Q10). Gập: 3 mã đầu còn nhận được ngay; mã đã nhận (còn trong ví hay đã dùng hết), hết lượt hoặc chỉ dành khách mới mà khách đã có đơn
 * không chiếm chỗ, nên thẻ ở đây luôn nhận được thật. "Tất cả (n)" mở ngay tại chỗ CẢ kho (thay trang Mã giảm giá cũ): mọi mã kể cả đã lưu ("Dùng ngay"),
 * đã dùng, hết lượt, kèm chip lọc; "Thu gọn" về 3 mã. `openAll` (`?codes=all`, lối tắt Mã giảm giá, link cũ `/ma-giam-gia`) mở sẵn và cuộn tới khối.
 * Khách chưa đăng nhập vẫn thấy mã, bấm "Lưu mã" đi tới đăng nhập (quay lại đúng trạng thái mở). Gập mà không có mã nào nhận được thì ẩn khối; tải lỗi thì
 * báo tại chỗ với "Thử lại". Lần mở trước có n thẻ thì lúc tải giữ chỗ đúng n ô, mở sẵn thì 3 ô, nên khối vào chỗ không đẩy các khối dưới.
 * Ví tải lỗi (chưa có dữ liệu): mã đã nhận không bị ghi "Đã dùng" (`walletCodeSet` trả null) và khối mở có dải báo lỗi kèm "Thử lại" tải lại ví.
 * Web không có snackbar: kết quả nhận/dùng mã là một dòng ngay dưới tiêu đề.
 */
export function OffersCollect({ wallet, openAll = false }: { wallet: OffersWallet; openAll?: boolean }) {
  const titleId = useId();
  const listId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const chipRowRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const [expanded, setExpanded] = useState(openAll);
  const [filter, setFilter] = useState<VoucherFilter>('all');
  const { claim, pendingCode, notice: claimNotice } = useClaimCoupon(expanded ? `${BASE}?${OFFERS_CODES_PARAM}=${OFFERS_CODES_ALL}` : BASE);
  const { use: applyCoupon, notice: useNotice, usingCode } = useCouponUse();
  const q = useQuery(collectableCouponsQuery(coreHttp));
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const mineQ = useQuery({ ...collectableMineQuery(coreHttp), enabled: authed });
  const [hinted] = useState(() => readCollectHint(browserStorage()));

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
    const slots = expanded ? COLLECT_HINT_MAX : hinted;
    if (slots === 0) return null;
    return (
      <div data-testid="offers-collect-loading" aria-hidden="true">
        <div style={{ height: HEADER_HEIGHT }} />
        <div className={GRID}>
          {Array.from({ length: slots }, (_, i) => (
            <Skeleton key={i} height={TICKET_HEIGHT} radius="var(--radius-card)" />
          ))}
        </div>
      </div>
    );
  }
  if (q.isError && (expanded ? all.length === 0 : shown.length === 0)) {
    return (
      <section ref={sectionRef} aria-labelledby={titleId} className={SCROLL_MARGIN}>
        <SectionHeader id={titleId} title={title} icon="ticket" />
        <ErrorState variant="inline" title={fillCopy('coupon.loadError')} message={loadErrorText(q.error)} onRetry={() => q.refetch()} />
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
  const notice = useNotice ?? claimNotice;
  const noticeLine = notice && (
    <p role={notice.error ? 'alert' : 'status'} className={`mb-2 text-caption ${notice.error ? 'text-danger-fg' : 'text-[color:var(--color-text-secondary)]'}`}>
      {notice.text}
    </p>
  );
  const saveButton = (row: VoucherRow) => ({
    label: fillCopy('coupon.save'),
    onClick: () => void claim(row.view.code),
    busy: pendingCode === row.view.code,
    disabled: Boolean(pendingCode) && pendingCode !== row.view.code,
  });

  if (!expanded) {
    return (
      <section ref={sectionRef} aria-labelledby={titleId} className={SCROLL_MARGIN}>
        <SectionHeader id={titleId} title={title} icon="ticket" action={seeAll ? { label: seeAll, onPress: expand, spoken: `${seeAll} ${fillCopy('coupon.title')}` } : undefined} />
        {noticeLine}
        <div data-testid="offers-collect-grid" className={GRID}>
          {shown.map((row) => (
            <VoucherTicket key={row.view.code} voucher={row.view} variant="ticket" primary={saveButton(row)} expiring={isVoucherRowExpiring(row, now)} />
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
    if (row.view.state === 'collectable') return saveButton(row);
    if (row.view.state === 'saved') {
      return {
        label: fillCopy('coupon.use'),
        onClick: () => void applyCoupon(row.view.code),
        busy: usingCode === row.view.code,
        disabled: Boolean(usingCode) && usingCode !== row.view.code,
      };
    }
    return undefined;
  };
  return (
    <section ref={sectionRef} aria-labelledby={titleId} className={SCROLL_MARGIN}>
      <SectionHeader id={titleId} title={title} icon="ticket" subtitle={fillCopy('coupon.oneCodeHint')} />
      {noticeLine}
      {authed && walletCodes === null && (
        <div className="mb-3">
          <ErrorState variant="inline" title={fillCopy('coupon.walletLoadError')} message={loadErrorText(wallet.error)} onRetry={() => wallet.refetch()} />
        </div>
      )}
      {all.length > 0 && (
        <div ref={chipRowRef} className="scroll-x flex gap-2 pb-2 pt-1">
          {filters.map((f) => (
            <Chip key={f.key} selected={f.key === activeFilter} onPress={() => setFilter(f.key)}>
              {f.label}
            </Chip>
          ))}
        </div>
      )}
      <div id={listId} data-testid="offers-collect-grid" className={GRID}>
        {all.length === 0 ? (
          <div className="col-span-full">
            <EmptyState variant="inline" art="leaf" heading={fillCopy('coupon.emptyClaimTitle')} />
          </div>
        ) : rows.length === 0 ? (
          <div className="col-span-full">
            <EmptyState variant="inline" art="leaf" heading={fillCopy('coupon.emptyFilterTitle')} ctaLabel={fillCopy('coupon.emptyFilterCta')} onCta={resetFilter} />
          </div>
        ) : (
          rows.map((row) => (
            <VoucherTicket key={row.view.code} voucher={row.view} variant="ticket" primary={primaryFor(row)} reason={row.reason} expiring={isVoucherRowExpiring(row, now)} />
          ))
        )}
      </div>
      {all.length > 0 && (
        <div className="mt-2 md:max-w-xs">
          <Button variant="ghost" fullWidth aria-expanded aria-controls={listId} onPress={collapse}>
            {fillCopy('offers.codesCollapse')}
          </Button>
        </div>
      )}
    </section>
  );
}
