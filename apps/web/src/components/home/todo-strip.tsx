'use client';

import { useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, PackageCheck, Truck } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { readLastTodoRows, readTodoRows, todoSkeletonHeight, writeTodoRows } from '@tubutree/app-core/home-layout';
import { fetchOrders } from '@tubutree/app-core/api/orders';
import { activeOrderCountQuery } from '@tubutree/app-core/queries/orders';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { syncHomeHintCookie } from './use-home-customer-kind';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { HomeRestoreHintContext, subscribeStorageEvent } from '@/lib/home-restore-context';
import { browserStorage } from '@/lib/recently-viewed';
import { useRemaining } from '@/lib/use-remaining';
import { canPayNow, showsPaymentDeadline } from '@/components/orders/order-rules';
import { Button, Card, Icon, ListRow, Skeleton } from '@/components/mini';

const ROW_PADDING = '8px 4px';

type TodoOrder = Awaited<ReturnType<typeof fetchOrders>>['data'][number];

/** Đơn chuyển khoản chờ tiền: giờ còn lại và nút "Thanh toán ngay" mở thẳng trang chuyển khoản. */
function PendingPaymentRow({ order }: { order: TodoOrder }) {
  const router = useRouter();
  const remaining = useRemaining(showsPaymentDeadline(order) ? order.paymentDeadline : null);
  const payable = canPayNow(order);
  const detail = remaining.expired ? homeCopy.todo.payOverdue : remaining.text;
  return (
    <ListRow
      icon={<Icon icon={AlertTriangle} tone="current" style={{ color: 'var(--color-text-warning)' }} />}
      title={homeCopy.todo.payTitle(formatVnd(order.total))}
      subtitle={detail || undefined}
      trailing={
        payable ? (
          <Button aria-label={homeCopy.todo.payNowLabel(order.code)} onPress={() => router.push(`/thanh-toan/chuyen-khoan/${encodeURIComponent(order.code)}`)} style={{ minWidth: 0, flex: '0 0 auto' }}>
            {homeCopy.todo.payNow}
          </Button>
        ) : (
          'chevron'
        )
      }
      onPress={payable ? undefined : () => router.push(`/tai-khoan/don-hang/${encodeURIComponent(order.code)}`)}
      style={{ padding: ROW_PADDING }}
    />
  );
}

function TodoSkeleton({ rows }: { rows: number }) {
  return (
    <div data-testid="todo-strip-loading" aria-hidden="true" style={{ padding: '0 0 12px' }}>
      <Skeleton height={todoSkeletonHeight(rows)} radius="var(--radius-card)" />
    </div>
  );
}

/**
 * "Việc cần làm" ở Trang chủ (bản web của `todo-strip.tsx` ở Mini App): đơn chờ chuyển khoản (giờ hết hạn, nút Thanh toán ngay) rồi
 * tới đơn đang giao và đơn đang chuẩn bị (COD vừa đặt), tối đa hai dòng. Chỉ hiện khi có việc. Danh sách đơn chỉ tải khi số đơn đang xử lý (cùng query với thanh đáy)
 * lớn hơn 0; chưa đăng nhập, không có việc hay lỗi thì ẩn. Khung chờ chỉ hiện khi lần mở trước của tài khoản này có việc (nhớ số dòng).
 */
export function TodoStrip({ restoring = false }: { restoring?: boolean }) {
  const router = useRouter();
  const authed = useAuthPhase() === 'authenticated';
  const count = useQuery({ ...activeOrderCountQuery(coreHttp), enabled: authed, staleTime: 30_000, retry: false });
  const enabled = authed && (count.data ?? 0) > 0;
  const pending = useQuery({
    queryKey: ['orders', 'home-todo-pending'],
    queryFn: () => fetchOrders(coreHttp, { status: 'PENDING_PAYMENT' }, 1, 1),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
  const shipping = useQuery({
    queryKey: ['orders', 'home-strip'],
    queryFn: () => fetchOrders(coreHttp, { status: 'SHIPPING' }, 1, 1),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
  const processing = useQuery({
    queryKey: ['orders', 'home-processing'],
    queryFn: () => fetchOrders(coreHttp, { group: 'processing' }, 1, 1),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
  const userId = useAuth().user?.id;
  const rememberedRows = useMemo(() => (authed ? readTodoRows(browserStorage(), userId) : 0), [authed, userId]);
  // Số dòng của lần mở trước (bất kể tài khoản) cho khung chờ lúc khôi phục phiên; lần hydrate đầu dùng gợi ý của bản server.
  const prebuilt = useContext(HomeRestoreHintContext);
  const lastRows = useSyncExternalStore(subscribeStorageEvent, () => readLastTodoRows(browserStorage()), () => prebuilt?.rows ?? 0);
  const loading = authed && (count.isPending || (enabled && (pending.isLoading || shipping.isLoading || processing.isLoading)));
  const payOrder = pending.data?.data[0];
  const shipOrder = shipping.data?.data[0];
  const shipTotal = shipping.data?.meta.total ?? 0;
  const prepOrder = processing.data?.data[0];
  const prepTotal = processing.data?.meta.total ?? 0;
  // Tối đa hai dòng để khối gọn: đơn chờ thanh toán, đơn đang giao, rồi đơn đang chuẩn bị theo thứ tự đó.
  const showShip = Boolean(shipOrder);
  const showPrep = Boolean(prepOrder) && (payOrder ? 1 : 0) + (shipOrder ? 1 : 0) < 2;
  const rows = (payOrder ? 1 : 0) + (showShip ? 1 : 0) + (showPrep ? 1 : 0);
  const settled =
    authed &&
    (enabled
      ? !pending.isLoading && !shipping.isLoading && !processing.isLoading && !pending.isError && !shipping.isError && !processing.isError
      : count.isSuccess);
  useEffect(() => {
    if (settled && userId) {
      writeTodoRows(browserStorage(), userId, rows);
      syncHomeHintCookie();
    }
  }, [settled, userId, rows]);
  if (restoring) return lastRows > 0 ? <TodoSkeleton rows={lastRows} /> : null;
  if (!authed) return null;

  // Khung chờ chỉ khi lần mở trước có việc thật (chắc chắn sẽ có dòng); không thì chờ im lặng, khối hiện khi có việc.
  if (loading) {
    return rememberedRows > 0 ? <TodoSkeleton rows={rememberedRows} /> : null;
  }
  if (rows === 0) return null;

  return (
    <section aria-label={homeCopy.todo.title} style={{ padding: '0 0 12px' }}>
      <Card variant="outline" padding={8}>
        {payOrder && <PendingPaymentRow order={payOrder} />}
        {showShip && shipOrder && (
          <ListRow
            icon={<Icon icon={Truck} tone="brand" />}
            title={shipTotal > 1 ? homeCopy.todo.shippingMany(shipTotal) : homeCopy.todo.shipping(shipOrder.code)}
            subtitle={homeCopy.todo.shippingHint}
            trailing="chevron"
            onPress={() => router.push(shipTotal > 1 ? '/tai-khoan/don-hang?tab=shipping' : `/tai-khoan/don-hang/${encodeURIComponent(shipOrder.code)}`)}
            style={{ padding: ROW_PADDING, borderTop: payOrder ? '1px solid var(--color-border-subtle)' : undefined }}
          />
        )}
        {showPrep && prepOrder && (
          <ListRow
            icon={<Icon icon={PackageCheck} tone="brand" />}
            title={prepTotal > 1 ? homeCopy.todo.preparingMany(prepTotal) : homeCopy.todo.preparing(prepOrder.code)}
            subtitle={homeCopy.todo.preparingHint}
            trailing="chevron"
            onPress={() => router.push(prepTotal > 1 ? '/tai-khoan/don-hang?tab=processing' : `/tai-khoan/don-hang/${encodeURIComponent(prepOrder.code)}`)}
            style={{ padding: ROW_PADDING, borderTop: payOrder || showShip ? '1px solid var(--color-border-subtle)' : undefined }}
          />
        )}
      </Card>
    </section>
  );
}
