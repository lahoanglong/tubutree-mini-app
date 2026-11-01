import { useEffect, useMemo, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { AlertTriangle, PackageCheck, Truck } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { readLastTodoRows, readTodoRows, todoSkeletonHeight, writeTodoRows } from '@tubutree/app-core/home-layout';
import { ACTIVE_ORDER_COUNT_KEY } from '../../hooks/use-active-order-count';
import { useRemaining } from '../../hooks/use-remaining';
import { fetchActiveOrderCount, fetchHomeTodo, type OrderView } from '../../services/shop-api';
import { useAuthStore } from '../../store/auth';
import { formatVnd } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import { browserStorage } from '../../utils/recently-viewed';
import { canPayOrderNow, showsPaymentDeadline } from '../../utils/refund-rules';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { ListRow } from '../ui/list-row';
import { Skeleton } from '../ui/skeleton';

const SECTION_PAD = '0 16px';
/** Mỗi việc đúng một dòng 64px (HM-06): `todoSkeletonHeight` cũng tính theo số này. Đường kẻ giữa hai dòng là bóng trong, không cộng chiều cao. */
const ROW_HEIGHT = 64;
const rowStyle = (divider: boolean): CSSProperties => ({
  height: ROW_HEIGHT,
  padding: '0 12px 0 8px',
  boxSizing: 'border-box',
  ...(divider ? { boxShadow: 'inset 0 1px 0 var(--color-border-subtle)' } : {}),
});
// Viền trái 3px màu cảnh báo là dấu hiệu "việc cần làm"; viền ngoài là bóng trong để thẻ không cao thêm 2px so với khung chờ.
const CARD_STYLE: CSSProperties = { border: 'none', borderLeft: '3px solid var(--color-status-warning-fg)', boxShadow: 'inset 0 0 0 1px var(--color-border-subtle)', overflow: 'hidden' };

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
      style={rowStyle(false)}
    />
  );
}

function TodoSkeleton({ rows }: { rows: number }) {
  return (
    <div data-testid="todo-strip-loading" aria-hidden="true" style={{ padding: SECTION_PAD }}>
      <Skeleton height={todoSkeletonHeight(rows)} radius="var(--radius-card)" />
    </div>
  );
}

/** Dữ liệu của "Việc cần làm"; Trang chủ dùng riêng `loading` để biết khối đã chốt chưa (cùng query nên không thêm request). */
export function useHomeTodoQueries() {
  const authed = useAuthStore((s) => s.status === 'authenticated');
  // Cùng khoá và hàm tải với useActiveOrderCount (thanh đáy) để dùng chung dữ liệu, nhưng cần cả trạng thái đã tải xong hay chưa.
  const countQ = useQuery({ queryKey: ACTIVE_ORDER_COUNT_KEY, queryFn: fetchActiveOrderCount, enabled: authed, staleTime: 30_000, retry: false });
  const enabled = authed && (countQ.data ?? 0) > 0;
  const todoQ = useQuery({
    queryKey: ['orders', 'home-todo'],
    queryFn: fetchHomeTodo,
    enabled,
    staleTime: 30_000,
    retry: false,
  });
  const loading = authed && (countQ.isPending || (enabled && todoQ.isLoading));
  return { authed, countQ, enabled, todoQ, loading };
}

/**
 * "Việc cần làm" ở Trang chủ: đơn chờ chuyển khoản (có giờ hết hạn, nút Thanh toán ngay) rồi tới đơn đang giao, tối đa hai dòng.
 * Chỉ hiện khi có việc. Danh sách đơn chỉ tải khi số đơn đang xử lý (cùng query với thanh đáy) lớn hơn 0; khách chưa đăng
 * nhập, không có việc hay lỗi → ẩn. Khung chờ chỉ hiện khi lần mở trước của tài khoản này có việc (nhớ số dòng), để khối không hiện khung rồi sụp mất.
 */
export function TodoStrip({ restoring = false }: { restoring?: boolean }) {
  const navigate = useNavigate();
  const { authed, countQ, enabled, todoQ, loading } = useHomeTodoQueries();
  const userId = useAuthStore((s) => s.user?.id);
  const rememberedRows = useMemo(() => (authed ? readTodoRows(browserStorage(), userId) : 0), [authed, userId]);
  const payOrder = todoQ.data?.pending?.order;
  const shipOrder = todoQ.data?.shipping?.order;
  const shipTotal = todoQ.data?.shipping?.total ?? 0;
  const prepOrder = todoQ.data?.processing?.order;
  const prepTotal = todoQ.data?.processing?.total ?? 0;
  // Tối đa hai dòng để khối gọn: đơn chờ thanh toán, đơn đang giao, rồi đơn đang chuẩn bị theo thứ tự đó.
  const showShip = Boolean(shipOrder);
  const showPrep = Boolean(prepOrder) && (payOrder ? 1 : 0) + (shipOrder ? 1 : 0) < 2;
  const rows = (payOrder ? 1 : 0) + (showShip ? 1 : 0) + (showPrep ? 1 : 0);
  const settled =
    authed &&
    (enabled
      ? !todoQ.isLoading && !todoQ.isError
      : countQ.isSuccess);
  useEffect(() => {
    if (settled && userId) writeTodoRows(browserStorage(), userId, rows);
  }, [settled, userId, rows]);
  if (restoring) {
    const rows = readLastTodoRows(browserStorage());
    return rows > 0 ? <TodoSkeleton rows={rows} /> : null;
  }
  if (!authed) return null;

  // Khung chờ chỉ khi lần mở trước có việc thật (chắc chắn sẽ có dòng); không thì chờ im lặng, khối hiện khi có việc.
  if (loading) {
    return rememberedRows > 0 ? <TodoSkeleton rows={rememberedRows} /> : null;
  }
  if (rows === 0) return null;

  return (
    <section aria-label={homeCopy.todo.title} style={{ padding: SECTION_PAD }}>
      <Card variant="outline" padding={0} style={CARD_STYLE}>
        {payOrder && <div data-todo-row style={{ height: ROW_HEIGHT }}><PendingPaymentRow order={payOrder} /></div>}
        {showShip && shipOrder && (
          <div data-todo-row style={{ height: ROW_HEIGHT }}><ListRow
            icon={<Icon icon={Truck} tone="brand" />}
            title={shipTotal > 1 ? homeCopy.todo.shippingMany(shipTotal) : homeCopy.todo.shipping(shipOrder.code)}
            subtitle={homeCopy.todo.shippingHint}
            trailing="chevron"
            onPress={() => navigate(shipTotal > 1 ? '/orders?tab=shipping' : `/order/${encodeURIComponent(shipOrder.code)}`)}
            style={rowStyle(Boolean(payOrder))}
          /></div>
        )}
        {showPrep && prepOrder && (
          <div data-todo-row style={{ height: ROW_HEIGHT }}><ListRow
            icon={<Icon icon={PackageCheck} tone="brand" />}
            title={prepTotal > 1 ? homeCopy.todo.preparingMany(prepTotal) : homeCopy.todo.preparing(prepOrder.code)}
            subtitle={homeCopy.todo.preparingHint}
            trailing="chevron"
            onPress={() => navigate(prepTotal > 1 ? '/orders?tab=processing' : `/order/${encodeURIComponent(prepOrder.code)}`)}
            style={rowStyle(Boolean(payOrder || showShip))}
          /></div>
        )}
      </Card>
    </section>
  );
}

