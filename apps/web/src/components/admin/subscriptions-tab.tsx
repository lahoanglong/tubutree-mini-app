'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listAdminSubscriptions, type AdminSubscription, type SubscriptionStatus } from '@/lib/admin-client';
import { intervalLabel, subscriptionStatusLabel } from '@/lib/admin-pickers';
import { PageNav } from './page-nav';
import { Notice, ToneBadge, chipClass } from './ui';
import { formatDate } from '@/lib/format-date';

const PAGE_SIZE = 20;
const STATUS_CHIPS: { k: SubscriptionStatus | ''; label: string }[] = [
  { k: '', label: 'Tất cả' },
  { k: 'ACTIVE', label: 'Đang chạy' },
  { k: 'PAUSED', label: 'Tạm dừng' },
  { k: 'CANCELLED', label: 'Đã huỷ' },
];
const STATUS_TONE = { ACTIVE: 'success', PAUSED: 'warning', CANCELLED: 'neutral' } as const;

/** Gói mua định kỳ cho CSKH tra cứu — chỉ xem: khách tự tạm dừng/huỷ trong Mini App, cron tự tạo đơn. */
export function SubscriptionsTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<SubscriptionStatus | ''>('');
  const q = useQuery({
    queryKey: ['admin-subscriptions', page, status],
    queryFn: () => listAdminSubscriptions(page, status || undefined, PAGE_SIZE),
  });

  return (
    <div className="space-y-3">
      <h2 className="font-display text-lg font-semibold text-stone-900">Gói định kỳ</h2>
      <Notice>Chỉ xem. Khách tự tạm dừng hoặc huỷ gói trong Mini App; hệ thống tự tạo đơn vào ngày giao kế tiếp của gói đang chạy.</Notice>
      <div role="tablist" aria-label="Lọc gói định kỳ theo trạng thái" className="flex flex-wrap gap-2">
        {STATUS_CHIPS.map((c) => (
          <button
            key={c.k || 'all'}
            type="button"
            role="tab"
            aria-selected={status === c.k}
            onClick={() => {
              setPage(1);
              setStatus(c.k);
            }}
            className={chipClass(status === c.k)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {q.isError && (
        <p role="alert" className="text-sm text-danger-fg">
          {(q.error as Error).message || 'Không tải được danh sách gói định kỳ.'}
        </p>
      )}
      {q.isLoading && <p className="text-sm text-stone-500">Đang tải gói định kỳ…</p>}
      {q.data && q.data.data.length === 0 && <p className="rounded-card border border-stone-200 bg-stone-0 p-4 text-sm text-stone-500">Chưa có gói định kỳ nào khớp bộ lọc.</p>}
      <div className="space-y-3">
        {q.data?.data.map((s) => <SubscriptionRow key={s.id} sub={s} />)}
      </div>
      {q.data && <PageNav page={q.data.meta.page} limit={q.data.meta.limit} total={q.data.meta.total} onPage={setPage} noun="gói" />}
    </div>
  );
}

function SubscriptionRow({ sub: s }: { sub: AdminSubscription }) {
  return (
    <article className="rounded-card border border-stone-200 bg-stone-0 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge tone={STATUS_TONE[s.status] ?? 'neutral'}>{subscriptionStatusLabel(s.status)}</ToneBadge>
        <span className="text-xs text-stone-500">{intervalLabel(s.intervalWeeks)}</span>
        {s.status === 'ACTIVE' && (
          <span className="ml-auto text-xs text-stone-500">Giao kế tiếp: {formatDate(s.nextRunAt)}</span>
        )}
      </div>
      <div className="mt-1 font-medium">
        {s.variation.product.name} · {s.variation.name} ({s.variation.sku}) × {s.quantity}
      </div>
      <div className="text-xs text-stone-500">
        {s.user.fullName?.trim() || 'Chưa có tên'} · {s.user.phone || 'chưa có SĐT'}
      </div>
    </article>
  );
}
