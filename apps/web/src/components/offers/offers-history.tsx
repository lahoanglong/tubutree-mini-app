'use client';

// Nguồn: apps/miniapp/src/components/offers/offers-history.tsx
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { historyRows } from '@tubutree/app-core/commerce/voucher-center';
import { couponHistoryQuery } from '@tubutree/app-core/queries/loyalty';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Button, EmptyState, Skeleton, VoucherTicket } from '@/components/mini';
import { ErrorState } from '@/components/ui/error-state';
import { coreHttp } from '@/lib/core-http';
import { loadErrorText } from '@/lib/error-text';

/**
 * "Mã đã dùng, hết hạn" ở cuối Mã của tôi: mở/đóng ngay tại chỗ (thay tab lịch sử của trang Mã giảm giá cũ), chỉ gọi `/me/coupons/history` khi mở.
 * Phiếu lịch sử không có nút (mã đã đóng), xếp cùng lưới với ví. `initialOpen` (`?history=1`, link cũ `/ma-giam-gia?tab=history`) mở sẵn và cuộn tới
 * mục một lần khi `scrollReady` (ví phía trên đã vẽ xong, không thì vị trí còn đổi).
 */
export function OffersHistory({ initialOpen, scrollReady }: { initialOpen: boolean; scrollReady: boolean }) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const [open, setOpen] = useState(initialOpen);
  const q = useQuery({ ...couponHistoryQuery(coreHttp), enabled: open });
  const rows = useMemo(() => historyRows(q.data ?? [], Date.now()), [q.data]);
  useEffect(() => {
    if (!initialOpen || !scrollReady || scrolled.current) return;
    scrolled.current = true;
    rootRef.current?.scrollIntoView?.({ block: 'start' });
  }, [initialOpen, scrollReady]);

  let body: ReactNode = null;
  if (open) {
    if (q.isLoading) body = <Skeleton height={88} radius="var(--radius-card)" />;
    else if (q.isError && rows.length === 0) {
      body = (
        <div className="col-span-full">
          <ErrorState variant="inline" title={fillCopy('coupon.loadError')} message={loadErrorText(q.error)} onRetry={() => q.refetch()} />
        </div>
      );
    } else if (rows.length === 0) {
      body = (
        <div className="col-span-full">
          <EmptyState variant="inline" art="leaf" heading={fillCopy('coupon.emptyHistoryTitle')} />
        </div>
      );
    } else body = rows.map((row, i) => <VoucherTicket key={`${row.view.code}-${i}`} voucher={row.view} variant="ticket" />);
  }

  return (
    <div
      ref={rootRef}
      className="scroll-mt-[calc(var(--safe-top)+var(--section-header-h)+var(--space-gutter))] md:scroll-mt-[calc(var(--header-h)+var(--section-header-h)+var(--space-gutter))]"
    >
      <div className="md:max-w-xs">
        <Button variant="ghost" fullWidth icon={open ? ChevronUp : ChevronDown} aria-expanded={open} aria-controls={panelId} onPress={() => setOpen((v) => !v)}>
          {fillCopy('offers.walletHistory')}
        </Button>
      </div>
      <div
        id={panelId}
        data-testid="offers-history-grid"
        hidden={!open}
        aria-busy={open && q.isLoading ? true : undefined}
        className={open ? 'mt-2 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3' : undefined}
      >
        {body}
      </div>
    </div>
  );
}
