'use client';

import { useEffect, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, PackageCheck, Truck } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { HOME_CONTEXT_HEIGHT, homeTodoCount, homeTodoLead, writeTodoRows } from '@tubutree/app-core/home-layout';
import type { HomeTodo, HomeTodoPart } from '@tubutree/app-core/api/orders';
import { meSummaryQuery } from '@tubutree/app-core/api/me-summary';
import { ordersHomeTodoQuery } from '@tubutree/app-core/queries/orders';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useAuthPhase } from '@/lib/auth-phase';
import { syncHomeHintCookie } from './use-home-customer-kind';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { browserStorage } from '@/lib/recently-viewed';
import { useRemaining } from '@/lib/use-remaining';
import { canPayNow, showsPaymentDeadline } from '@/components/orders/order-rules';
import { Button, Card, Icon, ListRow } from '@/components/mini';

/** Dải một dòng đúng `HOME_CONTEXT_HEIGHT`: `ListRow` cao bằng đó và nút mũi tên 44 nằm gọn trong đó. */
const ROW_HEIGHT = HOME_CONTEXT_HEIGHT;
const rowStyle = (arrow: boolean): CSSProperties => ({
  height: ROW_HEIGHT,
  padding: arrow ? '0 0 0 var(--space-inline-sm)' : '0 var(--space-inline-md) 0 var(--space-inline-sm)',
  boxSizing: 'border-box',
});
// Viền trái 3px màu cảnh báo là dấu hiệu "việc cần làm"; viền ngoài là bóng trong để thẻ không cao thêm 2px so với khung chờ.
const CARD_STYLE: CSSProperties = { border: 'none', borderLeft: '3px solid var(--color-status-warning-fg)', boxShadow: 'inset 0 0 0 1px var(--color-border-subtle)', overflow: 'hidden' };
const ONE_LINE: CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

type TodoOrder = HomeTodoPart['order'];

/** Đơn chuyển khoản chờ tiền: giờ còn lại (hoặc "+N việc khác") và nút "Thanh toán" mở thẳng trang chuyển khoản. */
function PendingPaymentRow({ order, moreText, arrow }: { order: TodoOrder; moreText?: string; arrow: boolean }) {
  const router = useRouter();
  const remaining = useRemaining(showsPaymentDeadline(order) ? order.paymentDeadline : null);
  const payable = canPayNow(order);
  const detail = moreText ?? (remaining.expired ? homeCopy.todo.payOverdue : remaining.text);
  return (
    <ListRow
      icon={<Icon icon={AlertTriangle} tone="current" style={{ color: 'var(--color-text-warning)' }} />}
      title={<span style={ONE_LINE}>{homeCopy.todo.payTitle(formatVnd(order.total))}</span>}
      subtitle={detail ? <span style={ONE_LINE}>{detail}</span> : undefined}
      trailing={
        payable ? (
          <Button aria-label={homeCopy.todo.payNowLabel(order.code)} onPress={() => router.push(`/thanh-toan/chuyen-khoan/${encodeURIComponent(order.code)}`)} style={{ minWidth: 0, flex: '0 0 auto' }}>
            {homeCopy.todo.payNow}
          </Button>
        ) : arrow ? undefined : (
          'chevron'
        )
      }
      onPress={payable ? undefined : () => router.push(`/tai-khoan/don-hang/${encodeURIComponent(order.code)}`)}
      style={rowStyle(arrow)}
    />
  );
}

/** Mũi tên cuối dòng mở danh sách đơn khi còn việc khác ngoài việc đang hiện. */
function MoreOrdersLink({ n }: { n: number }) {
  return (
    <Link
      href="/tai-khoan/don-hang"
      aria-label={fillCopy('home.todo.moreAria', { n })}
      className="tubu-press mr-1 inline-flex h-11 w-11 flex-none items-center justify-center"
    >
      <Icon icon={ChevronRight} size="sm" tone="muted" />
    </Link>
  );
}

/** Dữ liệu của "Việc cần làm"; Trang chủ dùng riêng `loading` để biết dải ngữ cảnh đã chốt chưa (cùng query nên không thêm request). */
export function useHomeTodoQueries() {
  const authed = useAuthPhase() === 'authenticated';
  const count = useQuery({ ...meSummaryQuery(coreHttp), select: (s) => s.orders.active, enabled: authed, staleTime: 30_000, retry: false });
  const enabled = authed && (count.data ?? 0) > 0;
  const todoQ = useQuery({ ...ordersHomeTodoQuery(coreHttp), enabled, staleTime: 30_000, retry: false });
  const loading = authed && (count.isPending || (enabled && todoQ.isLoading));
  return { authed, count, enabled, todoQ, loading };
}

/**
 * Nhớ "lần mở này có việc cần làm không" (1 hoặc 0) cho tài khoản này, để lần mở sau dải ngữ cảnh giữ khung chờ thay vì vẽ quà hay thẻ thành viên rồi đổi.
 * Chỉ ghi khi dữ liệu đã chốt: lỗi hay trả thiếu (`partial`) thì không ghi, kẻo xoá dấu nhớ đúng.
 */
export function useHomeTodoHint(todo: ReturnType<typeof useHomeTodoQueries>, userId: string | undefined): void {
  const { authed, enabled, count, todoQ } = todo;
  const rows = homeTodoCount(todoQ.data) > 0 ? 1 : 0;
  const settled = authed && (enabled ? !todoQ.isLoading && !todoQ.isError && !todoQ.data?.partial : count.isSuccess);
  useEffect(() => {
    if (settled && userId) {
      writeTodoRows(browserStorage(), userId, rows);
      syncHomeHintCookie();
    }
  }, [settled, userId, rows]);
}

/**
 * "Việc cần làm" trong dải ngữ cảnh (bản web của `todo-strip.tsx` ở Mini App): MỘT dòng cao 64px cho việc dẫn đầu (`homeTodoLead`: chờ chuyển khoản, rồi đang giao,
 * rồi đang chuẩn bị). Còn việc khác thì chữ phụ nói "+N việc khác" và mũi tên cuối dòng mở danh sách đơn. Chỉ vẽ khi có việc: biến thể nào của dải
 * được hiện là do `homeContextVariant` quyết, nên component này không tự chờ dữ liệu.
 */
export function TodoStrip({ data }: { data: HomeTodo | undefined }) {
  const router = useRouter();
  const lead = homeTodoLead(data);
  if (!data || !lead) return null;
  const arrow = lead.more > 0;
  const moreText = arrow ? fillCopy('home.todo.more', { n: lead.more }) : undefined;
  const payOrder = data.pending?.order;
  const shipOrder = data.shipping?.order;
  const prepOrder = data.processing?.order;

  return (
    <section aria-label={homeCopy.todo.title}>
      <Card variant="outline" padding={0} style={CARD_STYLE}>
        <div data-todo-row style={{ display: 'flex', alignItems: 'center', height: ROW_HEIGHT }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {lead.kind === 'pending' && payOrder && <PendingPaymentRow order={payOrder} moreText={moreText} arrow={arrow} />}
            {lead.kind === 'shipping' && shipOrder && (
              <ListRow
                icon={<Icon icon={Truck} tone="brand" />}
                title={<span style={ONE_LINE}>{homeCopy.todo.shipping(shipOrder.code)}</span>}
                subtitle={<span style={ONE_LINE}>{moreText ?? homeCopy.todo.shippingHint}</span>}
                trailing={arrow ? undefined : 'chevron'}
                onPress={() => router.push(`/tai-khoan/don-hang/${encodeURIComponent(shipOrder.code)}`)}
                style={rowStyle(arrow)}
              />
            )}
            {lead.kind === 'processing' && prepOrder && (
              <ListRow
                icon={<Icon icon={PackageCheck} tone="brand" />}
                title={<span style={ONE_LINE}>{homeCopy.todo.preparing(prepOrder.code)}</span>}
                subtitle={<span style={ONE_LINE}>{moreText ?? homeCopy.todo.preparingHint}</span>}
                trailing={arrow ? undefined : 'chevron'}
                onPress={() => router.push(`/tai-khoan/don-hang/${encodeURIComponent(prepOrder.code)}`)}
                style={rowStyle(arrow)}
              />
            )}
          </div>
          {arrow && <MoreOrdersLink n={lead.more} />}
        </div>
      </Card>
    </section>
  );
}
