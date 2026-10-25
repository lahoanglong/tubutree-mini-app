import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { AlertTriangle, Truck } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { useActiveOrderCount } from '../../hooks/use-active-order-count';
import { useRemaining } from '../../hooks/use-remaining';
import { fetchOrders, type OrderView } from '../../services/shop-api';
import { useAuthStore } from '../../store/auth';
import { formatVnd } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import { canPayOrderNow, showsPaymentDeadline } from '../../utils/refund-rules';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { ListRow } from '../ui/list-row';
import { Skeleton } from '../ui/skeleton';

const SECTION_PAD = '0 16px 12px';
const ROW_PADDING = '8px 4px';
const PLACEHOLDER_ROW_HEIGHT = 60;

/** Đơn chuyển khoản chờ tiền: giờ còn lại và nút "Thanh toán ngay" mở thẳng trang chuyển khoản. */
function PendingPaymentRow({ order }: { order: OrderView }) {
  const navigate = useNavigate();
  const remaining = useRemaining(showsPaymentDeadline(order) ? order.paymentDeadline : null);
  const payable = canPayOrderNow(order);
  const detail = remaining.expired ? homeCopy.todo.payOverdue : remaining.text;
  return (
    <ListRow
      icon={<Icon icon={AlertTriangle} tone="current" style={{ color: 'var(--color-text-warning)' }} />}
      title={homeCopy.todo.payTitle(formatVnd(order.total))}
      subtitle={detail || undefined}
      trailing={
        payable ? (
          <Button
            aria-label={homeCopy.todo.payNowLabel(order.code)}
            onPress={() => {
              haptic('light');
              navigate(`/bank-payment/${encodeURIComponent(order.code)}`);
            }}
            style={{ minWidth: 0, flex: '0 0 auto' }}
          >
            {homeCopy.todo.payNow}
          </Button>
        ) : (
          'chevron'
        )
      }
      onPress={payable ? undefined : () => navigate(`/order/${encodeURIComponent(order.code)}`)}
      style={{ padding: ROW_PADDING }}
    />
  );
}

/**
 * "Việc cần làm" ở Trang chủ: đơn chờ chuyển khoản (có giờ hết hạn, nút Thanh toán ngay) rồi tới đơn đang giao, tối đa hai dòng.
 * Chỉ hiện khi có việc. Danh sách đơn chỉ tải khi số đơn đang xử lý (cùng query với thanh đáy) lớn hơn 0; khách chưa đăng
 * nhập, không có việc hay lỗi → ẩn. Khung chờ giữ chỗ một dòng chỉ trong lúc tải đơn, vì lúc đó gần như chắc chắn có việc.
 */
export function TodoStrip() {
  const navigate = useNavigate();
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const activeCount = useActiveOrderCount(true);
  const enabled = authed && activeCount > 0;
  const pending = useQuery({
    queryKey: ['orders', 'home-todo-pending'],
    queryFn: () => fetchOrders({ status: 'PENDING_PAYMENT' }, 1, 1),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
  const shipping = useQuery({
    queryKey: ['orders', 'home-strip'],
    queryFn: () => fetchOrders({ status: 'SHIPPING' }, 1, 1),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
  if (!authed) return null;

  if (enabled && (pending.isLoading || shipping.isLoading)) {
    return (
      <div data-testid="todo-strip-loading" aria-hidden="true" style={{ padding: SECTION_PAD }}>
        <Skeleton height={PLACEHOLDER_ROW_HEIGHT + 18} radius="var(--radius-card)" />
      </div>
    );
  }

  const payOrder = pending.data?.data[0];
  const shipOrder = shipping.data?.data[0];
  const shipTotal = shipping.data?.meta.total ?? 0;
  if (!payOrder && !shipOrder) return null;

  return (
    <section aria-label={homeCopy.todo.title} style={{ padding: SECTION_PAD }}>
      <Card variant="outline" padding={8}>
        {payOrder && <PendingPaymentRow order={payOrder} />}
        {shipOrder && (
          <ListRow
            icon={<Icon icon={Truck} tone="brand" />}
            title={shipTotal > 1 ? homeCopy.todo.shippingMany(shipTotal) : homeCopy.todo.shipping(shipOrder.code)}
            subtitle={homeCopy.todo.shippingHint}
            trailing="chevron"
            onPress={() => navigate(shipTotal > 1 ? '/orders?tab=shipping' : `/order/${encodeURIComponent(shipOrder.code)}`)}
            style={{ padding: ROW_PADDING, borderTop: payOrder ? '1px solid var(--color-border-subtle)' : undefined }}
          />
        )}
      </Card>
    </section>
  );
}

