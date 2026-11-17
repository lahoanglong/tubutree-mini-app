import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { historyRows } from '@tubutree/app-core/commerce/voucher-center';
import { couponHistoryQuery } from '@tubutree/app-core/queries/loyalty';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { getLoadErrorMessage } from '../../services/api';
import { coreHttp } from '../../services/core-http';
import { Button } from '../ui/button';
import { EmptyState, ErrorState } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';
import { VoucherTicket } from '../ui/voucher-ticket';

const ROOT: CSSProperties = {
  marginTop: 'var(--space-gutter)',
  // Mở từ link thì trang cuộn tới mục: chừa chỗ cho hàng tab dính ở đầu trang.
  scrollMarginTop: 'calc(var(--safe-top) + var(--section-header-h) + var(--space-gutter))',
};
const PANEL: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-inset-card)', marginTop: 'var(--space-stack-sm)' };

/**
 * "Mã đã dùng, hết hạn" ở cuối Mã của tôi: mở/đóng ngay tại chỗ (thay tab lịch sử của trang Mã giảm giá cũ), chỉ gọi `/me/coupons/history` khi mở.
 * Phiếu lịch sử không có nút (mã đã đóng). `initialOpen` (`?history=1`, link cũ `/vouchers?tab=history`) mở sẵn và cuộn tới mục một lần khi
 * `scrollReady` (ví phía trên đã vẽ xong, không thì vị trí còn đổi).
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
      body = <ErrorState variant="inline" title={fillCopy('coupon.loadError')} message={getLoadErrorMessage(q.error)} retrying={q.isFetching} onRetry={() => q.refetch()} />;
    } else if (rows.length === 0) body = <EmptyState variant="inline" art="leaf" heading={fillCopy('coupon.emptyHistoryTitle')} />;
    else body = rows.map((row, i) => <VoucherTicket key={`${row.view.code}-${i}`} voucher={row.view} variant="ticket" />);
  }

  return (
    <div ref={rootRef} style={ROOT}>
      <Button variant="ghost" fullWidth icon={open ? ChevronUp : ChevronDown} aria-expanded={open} aria-controls={panelId} onPress={() => setOpen((v) => !v)}>
        {fillCopy('offers.walletHistory')}
      </Button>
      <div id={panelId} hidden={!open} aria-busy={open && q.isLoading ? true : undefined} style={open ? PANEL : undefined}>
        {body}
      </div>
    </div>
  );
}
