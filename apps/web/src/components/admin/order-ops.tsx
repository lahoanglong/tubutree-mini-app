'use client';

import type { AdminOrder, OrderOpsCounts } from '@/lib/admin-client';
import { formatDateTime } from '@/lib/format-date';
import { ToneBadge } from './ui';

/** Ô KPI đầu tab Đơn hàng: mỗi ô là một bộ lọc nhanh, bấm lần nữa để tắt. */
export type OrderOpsKey = 'guest' | 'bankPending' | 'overdueCancelled';

const ACTOR_LABELS: Record<string, string> = {
  ADMIN: 'Quản trị huỷ',
  CUSTOMER: 'Khách huỷ',
  MERCHANT: 'Gian hàng huỷ',
  PANCAKE: 'Pancake báo huỷ',
  SYSTEM: 'Hệ thống huỷ',
};

/** Nhãn ô tự huỷ theo hạn đang cấu hình (mặc định 24 giờ), để nhãn không nói sai khi đổi TTL. */
export const overdueCancelledLabel = (ttlHours?: number) => `Tự huỷ quá hạn CK ${ttlHours ?? 24}h`;

const num = (n: number | undefined) => (n === undefined ? '—' : n.toLocaleString('vi-VN'));

export function OrderOpsStrip({
  counts,
  active,
  onToggle,
}: {
  /** Chưa có (đang tải hay lỗi) thì hiện "—", không in 0 để khỏi đọc nhầm là hết việc. */
  counts?: OrderOpsCounts;
  active: Record<OrderOpsKey, boolean>;
  onToggle: (k: OrderOpsKey) => void;
}) {
  const tiles: { k: OrderOpsKey; label: string; value?: number; sub: string | null; alert: boolean }[] = [
    {
      k: 'guest',
      label: 'Khách vãng lai (Web)',
      value: counts?.guestWeb,
      sub: counts ? `${num(counts.guestWebUnmerged)} chưa gộp Zalo` : null,
      alert: false,
    },
    {
      k: 'bankPending',
      label: 'Chờ chuyển khoản',
      value: counts?.bankTransferPending,
      sub: counts && counts.bankTransferOverdue > 0 ? `${num(counts.bankTransferOverdue)} quá hạn` : null,
      alert: (counts?.bankTransferOverdue ?? 0) > 0,
    },
    {
      k: 'overdueCancelled',
      label: overdueCancelledLabel(counts?.ttlHours),
      value: counts?.overdueCancelled,
      sub: null,
      alert: false,
    },
  ];
  return (
    <div role="group" aria-label="Lọc nhanh vận hành đơn" data-order-ops className="grid grid-cols-3 gap-2">
      {tiles.map((t) => {
        const on = active[t.k];
        return (
          <button
            key={t.k}
            type="button"
            aria-pressed={on}
            data-ops-tile={t.k}
            onClick={() => onToggle(t.k)}
            className={`flex min-h-[44px] min-w-0 flex-col items-start rounded-card border px-2.5 py-2 text-left shadow-card ${
              on ? 'border-forest-600 bg-forest-50' : 'border-stone-200 bg-stone-0 hover:bg-stone-50'
            }`}
          >
            <span className="text-[11px] font-medium leading-tight text-stone-600">{t.label}</span>
            <span className="mt-0.5 font-display text-xl font-semibold tabular-nums leading-none text-stone-900">{num(t.value)}</span>
            {t.sub && <span className={`mt-1 text-[11px] font-medium tabular-nums leading-tight ${t.alert ? 'text-danger-fg' : 'text-stone-500'}`}>{t.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Badge nguồn khách: đơn vãng lai (chưa gộp) hay đơn vãng lai web đã gộp vào tài khoản Zalo. */
export function OrderGuestBadge({ order: o }: { order: AdminOrder }) {
  if (o.guestSource === 'guest') return <ToneBadge tone="warning">Vãng lai</ToneBadge>;
  if (o.guestSource === 'merged') return <ToneBadge tone="info">Đã gộp Zalo</ToneBadge>;
  return null;
}

/** SĐT hiện ở dòng khách: đơn vãng lai web không có SĐT tài khoản, lấy SĐT khách gõ lúc đặt. */
export function orderCustomerPhone(o: AdminOrder): string | null {
  return o.user?.phone ?? o.guestPhone ?? null;
}

/** Dòng hạn chuyển khoản của đơn chờ tiền: còn hạn ghi giờ, đã qua hạn tô đỏ (cron sắp huỷ, hoặc đơn được giữ vì khoản chưa gắn). */
export function OrderPaymentDeadline({ order: o, now = Date.now() }: { order: AdminOrder; now?: number }) {
  if (!o.paymentDeadline) return null;
  const overdue = Date.parse(o.paymentDeadline) <= now;
  return (
    <span data-payment-deadline className={`block text-[11px] font-medium tabular-nums ${overdue ? 'text-danger-fg' : 'text-stone-600'}`}>
      {overdue ? `Quá hạn CK từ ${formatDateTime(o.paymentDeadline)}` : `Hạn CK ${formatDateTime(o.paymentDeadline)}`}
    </span>
  );
}

/** Lý do huỷ và lúc nhả giữ kho (cùng transaction với lần huỷ) của đơn đã huỷ. */
export function OrderCancellationLine({ order: o }: { order: AdminOrder }) {
  const c = o.status === 'CANCELLED' ? o.cancellation : null;
  if (!c) return null;
  const who = c.overdue ? 'Tự huỷ quá hạn CK' : (ACTOR_LABELS[c.actorType] ?? c.actorType);
  return (
    <span data-cancellation className="block text-[11px] leading-snug text-stone-600">
      <span className={c.overdue ? 'font-medium text-danger-fg' : 'font-medium text-stone-700'}>{who}</span>
      <span className="tabular-nums"> · nhả kho {formatDateTime(c.at)}</span>
      {c.note && <span className="block break-words text-stone-500">{c.note}</span>}
    </span>
  );
}
