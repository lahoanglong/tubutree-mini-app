import { useEffect, useMemo, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { AlertTriangle, ChevronRight, PackageCheck, Truck } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { HOME_CONTEXT_HEIGHT, homeTodoCount, homeTodoLead, readLastTodoRows, readTodoRows, writeTodoRows } from '@tubutree/app-core/home-layout';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useMeSummary } from '../../hooks/use-me-summary';
import { useRemaining } from '../../hooks/use-remaining';
import { fetchHomeTodo, type HomeTodo, type OrderView } from '../../services/shop-api';
import { useAuthStore } from '../../store/auth';
import { formatVnd } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import { browserStorage } from '../../utils/recently-viewed';
import { canPayOrderNow, showsPaymentDeadline } from '../../utils/refund-rules';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { ListRow } from '../ui/list-row';

const SECTION_PAD = '0 16px';
const ROW_HEIGHT = HOME_CONTEXT_HEIGHT;
// Viền trái 3px màu cảnh báo là dấu hiệu "việc cần làm"; viền ngoài là bóng trong để thẻ không cao thêm 2px so với khung chờ.
const CARD_STYLE: CSSProperties = { border: 'none', borderLeft: '3px solid var(--color-status-warning-fg)', boxShadow: 'inset 0 0 0 1px var(--color-border-subtle)', overflow: 'hidden' };
const ONE_LINE: CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

// Mũi tên bên phải chỉ có khi còn việc khác: hàng nhường lề phải cho vùng chạm 44px của nó.
const rowStyle = (hasMore: boolean): CSSProperties => ({ height: ROW_HEIGHT, padding: hasMore ? '0 0 0 var(--space-inline-sm)' : '0 var(--space-inline-md) 0 var(--space-inline-sm)', boxSizing: 'border-box' });

/** Đơn chuyển khoản chờ tiền: giờ còn lại và nút "Thanh toán" mở thẳng trang chuyển khoản. `note` thay dòng giờ còn lại khi dải phải nói "còn việc khác". */
function PendingPaymentRow({ order, note, hasMore }: { order: OrderView; note?: string; hasMore: boolean }) {
  const navigate = useNavigate();
  const remaining = useRemaining(showsPaymentDeadline(order) ? order.paymentDeadline : null);
  const payable = canPayOrderNow(order);
  const detail = note ?? (remaining.expired ? homeCopy.todo.payOverdue : remaining.text);
  return (
    <ListRow
      icon={<Icon icon={AlertTriangle} tone="current" style={{ color: 'var(--color-text-warning)' }} />}
      title={<span style={ONE_LINE}>{homeCopy.todo.payTitle(formatVnd(order.total))}</span>}
      subtitle={detail ? <span style={ONE_LINE}>{detail}</span> : undefined}
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
        ) : hasMore ? undefined : (
          'chevron'
        )
      }
      onPress={payable ? undefined : () => navigate(`/order/${encodeURIComponent(order.code)}`)}
      style={rowStyle(hasMore)}
    />
  );
}

/** Dữ liệu của "Việc cần làm"; Trang chủ dùng riêng `loading` để biết khối đã chốt chưa (cùng query nên không thêm request). */
export function useHomeTodoQueries() {
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const restoring = useAuthStore((s) => s.status === 'loading');
  const userId = useAuthStore((s) => s.user?.id);
  // Cùng query /me/summary với useActiveOrderCount (thanh đáy) để dùng chung dữ liệu, nhưng cần cả trạng thái đã tải xong hay chưa.
  const countQ = useMeSummary({ select: (s) => s.orders.active, staleTime: 30_000 });
  const enabled = authed && (countQ.data ?? 0) > 0;
  const todoQ = useQuery({
    queryKey: ['orders', 'home-todo'],
    queryFn: fetchHomeTodo,
    enabled,
    staleTime: 30_000,
    retry: false,
  });
  const loading = authed && (countQ.isPending || (enabled && todoQ.isLoading));

  // Lần mở trước của CHÍNH tài khoản này có việc (đang khôi phục phiên thì của tài khoản dùng gần nhất): dải ngữ cảnh giữ khung chờ thay vì vẽ Quà hay thẻ thành viên rồi đổi.
  const remembered = useMemo(() => (restoring ? readLastTodoRows(browserStorage()) : authed ? readTodoRows(browserStorage(), userId) : 0) > 0, [restoring, authed, userId]);
  const has = homeTodoCount(todoQ.data) > 0;
  const settled = authed && (enabled ? !todoQ.isLoading && !todoQ.isError && !todoQ.data?.partial : countQ.isSuccess);
  useEffect(() => {
    if (settled && userId) writeTodoRows(browserStorage(), userId, has ? 1 : 0);
  }, [settled, userId, has]);

  return { authed, countQ, enabled, todoQ, loading, pending: restoring || loading, remembered };
}

/**
 * "Việc cần làm" ở dải ngữ cảnh của Trang chủ: MỘT dòng cao `HOME_CONTEXT_HEIGHT` cho việc dẫn đầu (đơn chờ chuyển khoản, rồi đang giao, rồi đang chuẩn bị). Còn việc khác thì
 * dòng ghi "+N việc khác" và có mũi tên mở danh sách đơn. Biến thể và khung chờ do `HomeContextStrip` quyết; thành phần này chỉ vẽ khi có việc.
 */
export function TodoStrip({ data }: { data: HomeTodo | undefined }) {
  const navigate = useNavigate();
  const lead = homeTodoLead(data);
  if (!data || !lead) return null;
  const hasMore = lead.more > 0;
  const note = hasMore ? fillCopy('home.todo.more', { n: lead.more }) : undefined;
  const ship = data.shipping?.order;
  const prep = data.processing?.order;

  return (
    <section aria-label={homeCopy.todo.title} style={{ padding: SECTION_PAD }}>
      <Card variant="outline" padding={0} style={CARD_STYLE}>
        <div data-todo-row style={{ height: ROW_HEIGHT, display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {lead.kind === 'pending' && data.pending && <PendingPaymentRow order={data.pending.order} note={note} hasMore={hasMore} />}
            {lead.kind === 'shipping' && ship && (
              <ListRow
                icon={<Icon icon={Truck} tone="brand" />}
                title={<span style={ONE_LINE}>{homeCopy.todo.shipping(ship.code)}</span>}
                subtitle={<span style={ONE_LINE}>{note ?? homeCopy.todo.shippingHint}</span>}
                trailing={hasMore ? undefined : 'chevron'}
                onPress={() => navigate(`/order/${encodeURIComponent(ship.code)}`)}
                style={rowStyle(hasMore)}
              />
            )}
            {lead.kind === 'processing' && prep && (
              <ListRow
                icon={<Icon icon={PackageCheck} tone="brand" />}
                title={<span style={ONE_LINE}>{homeCopy.todo.preparing(prep.code)}</span>}
                subtitle={<span style={ONE_LINE}>{note ?? homeCopy.todo.preparingHint}</span>}
                trailing={hasMore ? undefined : 'chevron'}
                onPress={() => navigate(`/order/${encodeURIComponent(prep.code)}`)}
                style={rowStyle(hasMore)}
              />
            )}
          </div>
          {hasMore && (
            <button
              type="button"
              aria-label={fillCopy('home.todo.moreAria', { n: lead.more })}
              className="tubu-press tubu-hit-44-square"
              onClick={() => {
                haptic('light');
                navigate('/orders');
              }}
              style={{ flex: '0 0 auto', width: 'var(--space-stack-lg)', height: 'var(--space-stack-lg)', margin: '0 var(--space-inline-md)', padding: 0, border: 'none', background: 'transparent', color: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <Icon icon={ChevronRight} size="sm" tone="muted" />
            </button>
          )}
        </div>
      </Card>
    </section>
  );
}
