'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Truck } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { fetchOrders } from '@tubutree/app-core/api/orders';
import { activeOrderCountQuery } from '@tubutree/app-core/queries/orders';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { useRemaining } from '@/lib/use-remaining';
import { canPayNow, showsPaymentDeadline } from '@/components/orders/order-rules';
import { Button, Card, Icon, ListRow, Skeleton } from '@/components/mini';

const ROW_PADDING = '8px 4px';
const PLACEHOLDER_ROW_HEIGHT = 60;

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

/**
 * "Việc cần làm" ở Trang chủ (bản web của `todo-strip.tsx` ở Mini App): đơn chờ chuyển khoản (giờ hết hạn, nút Thanh toán ngay) rồi
 * tới đơn đang giao, tối đa hai dòng. Chỉ hiện khi có việc. Danh sách đơn chỉ tải khi số đơn đang xử lý (cùng query với thanh đáy)
 * lớn hơn 0; chưa đăng nhập, không có việc hay lỗi thì ẩn.
 */
export function TodoStrip() {
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
  if (!authed) return null;

  if (enabled && (pending.isLoading || shipping.isLoading)) {
    return (
      <div data-testid="todo-strip-loading" aria-hidden="true" style={{ padding: '0 0 12px' }}>
        <Skeleton height={PLACEHOLDER_ROW_HEIGHT + 18} radius="var(--radius-card)" />
      </div>
    );
  }

  const payOrder = pending.data?.data[0];
  const shipOrder = shipping.data?.data[0];
  const shipTotal = shipping.data?.meta.total ?? 0;
  if (!payOrder && !shipOrder) return null;

  return (
    <section aria-label={homeCopy.todo.title} style={{ padding: '0 0 12px' }} className="md:max-w-xl">
      <Card variant="outline" padding={8}>
        {payOrder && <PendingPaymentRow order={payOrder} />}
        {shipOrder && (
          <ListRow
            icon={<Icon icon={Truck} tone="brand" />}
            title={shipTotal > 1 ? homeCopy.todo.shippingMany(shipTotal) : homeCopy.todo.shipping(shipOrder.code)}
            subtitle={homeCopy.todo.shippingHint}
            trailing="chevron"
            onPress={() => router.push(shipTotal > 1 ? '/tai-khoan/don-hang?tab=shipping' : `/tai-khoan/don-hang/${encodeURIComponent(shipOrder.code)}`)}
            style={{ padding: ROW_PADDING, borderTop: payOrder ? '1px solid var(--color-border-subtle)' : undefined }}
          />
        )}
      </Card>
    </section>
  );
}
