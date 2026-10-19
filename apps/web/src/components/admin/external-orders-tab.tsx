'use client';

import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  getExternalOrder,
  listExternalOrders,
  listExternalOrderSources,
  nextPageParam,
  type ExternalOrder,
  type ExternalOrderSource,
  type ExternalOrderSourceRow,
  type ExternalOrderStatus,
} from '@/lib/admin-client';
import { formatDateTime } from '@/lib/format-date';
import { formatVnd } from '@/lib/shop-client';
import { useDebounced } from './search-picker';
import { BTN_SECONDARY, BTN_XS_SECONDARY, DlRow, FIELD_XS, Notice, ScrollRegion, ToneBadge, LoadError } from './ui';

const SOURCE_LABEL: Record<ExternalOrderSource, string> = {
  MARKETPLACE: 'Đơn sàn',
  CHAT: 'Chat / điện thoại',
  UNKNOWN: 'Chưa biết nguồn',
};

const STATUS_LABEL: Record<ExternalOrderStatus, string> = {
  OPEN: 'Chưa giao xong',
  DELIVERED: 'Đã giao',
  RETURNING: 'Đang hoàn',
  RETURNED: 'Đã hoàn',
  CANCELLED: 'Đã huỷ',
  PARTIAL_RETURN: 'Hoàn một phần',
  DELETED: 'Đã xoá',
};

const STATUS_TONE: Record<ExternalOrderStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  OPEN: 'neutral',
  DELIVERED: 'success',
  RETURNING: 'warning',
  RETURNED: 'danger',
  CANCELLED: 'danger',
  PARTIAL_RETURN: 'warning',
  DELETED: 'danger',
};

const kindLabel = (kind: ExternalOrderSource | 'APP', channel: string | null) =>
  kind === 'MARKETPLACE' && channel ? `Đơn sàn · ${channel}` : kind === 'APP' ? 'Đơn app' : SOURCE_LABEL[kind];

/**
 * Đơn Pancake không đặt trong app (đơn sàn Shopee/Lazada/TikTok, đơn chat/điện thoại), chỉ xem. Chưa cộng điểm cho đơn nào.
 * Bảng "Nguồn đã thấy" cho chủ shop biết khoá nguồn nào đang rơi vào "Chưa biết" để điền `pancake.order_source_map` ở tab Cấu hình.
 */
export function ExternalOrdersTab({ isAdmin }: { isAdmin: boolean }) {
  const [typed, setTyped] = useState('');
  const [source, setSource] = useState<ExternalOrderSource | ''>('');
  const [status, setStatus] = useState<ExternalOrderStatus | ''>('');
  const q = useDebounced(typed.trim(), 300);
  const orders = useInfiniteQuery({
    queryKey: ['admin-external-orders', q, source, status],
    queryFn: ({ pageParam }) =>
      listExternalOrders({ q: q || undefined, source: source || undefined, status: status || undefined }, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => nextPageParam(last.meta),
  });
  const rows = orders.data?.pages.flatMap((p) => p.data) ?? [];
  const total = orders.data?.pages[0]?.meta.total;
  const filtered = Boolean(q || source || status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-stone-900">Đơn ngoài app</h2>
        {total !== undefined && <span className="text-xs text-stone-500">{total} đơn</span>}
      </div>
      <Notice>
        Đơn Pancake không đặt trong Mini App/Web (đơn sàn, đơn chat, đơn gọi điện). Chỉ để xem và tra cứu, chưa cộng điểm cho khách. SĐT
        khách luôn được che.
      </Notice>
      <SourcesTable />
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Tìm đơn ngoài app"
          placeholder="Mã vận đơn, mã đơn sàn, mã đơn Pancake hoặc SĐT đầy đủ"
          maxLength={100}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className={`${FIELD_XS} w-full sm:w-96`}
        />
        <select aria-label="Lọc theo nguồn" value={source} onChange={(e) => setSource(e.target.value as ExternalOrderSource | '')} className={FIELD_XS}>
          <option value="">Mọi nguồn</option>
          {(Object.keys(SOURCE_LABEL) as ExternalOrderSource[]).map((s) => (
            <option key={s} value={s}>{SOURCE_LABEL[s]}</option>
          ))}
        </select>
        <select aria-label="Lọc theo trạng thái" value={status} onChange={(e) => setStatus(e.target.value as ExternalOrderStatus | '')} className={FIELD_XS}>
          <option value="">Mọi trạng thái</option>
          {(Object.keys(STATUS_LABEL) as ExternalOrderStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>
      {orders.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {orders.isError && <LoadError onRetry={() => void orders.refetch()} retrying={orders.isFetching}>Không tải được đơn ngoài app.</LoadError>}
      {orders.isSuccess && rows.length === 0 && (
        <p className="text-sm text-stone-500">{filtered ? 'Không có đơn nào khớp bộ lọc.' : 'Chưa nhận được đơn ngoài app nào từ Pancake.'}</p>
      )}
      <ul className="space-y-2">
        {rows.map((o) => <OrderRow key={o.id} order={o} isAdmin={isAdmin} />)}
      </ul>
      {orders.hasNextPage && (
        <div className="text-center">
          <button type="button" onClick={() => void orders.fetchNextPage()} disabled={orders.isFetchingNextPage} className={BTN_SECONDARY}>
            {orders.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
          </button>
        </div>
      )}
    </div>
  );
}

function SourcesTable() {
  const sources = useQuery({ queryKey: ['admin-external-order-sources'], queryFn: listExternalOrderSources });
  const rows: ExternalOrderSourceRow[] = sources.data?.sources ?? [];
  return (
    <section aria-label="Nguồn đã thấy" className="space-y-2">
      <h3 className="text-sm font-semibold text-stone-900">Nguồn đã thấy</h3>
      {sources.isError && <LoadError onRetry={() => void sources.refetch()} retrying={sources.isFetching}>Không tải được bảng nguồn đã thấy.</LoadError>}
      {sources.isSuccess && rows.length === 0 && <p className="text-sm text-stone-500">Chưa thấy nguồn nào.</p>}
      {rows.length > 0 && (
        <ScrollRegion label="Bảng nguồn đã thấy">
          <table className="w-full min-w-[34rem] text-left text-xs">
            <thead className="text-stone-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Khoá nguồn (order_sources | account | marketplace_id)</th>
                <th className="py-1 pr-3 font-medium">Số đơn</th>
                <th className="py-1 pr-3 font-medium">Đang xếp loại</th>
                <th className="py-1 font-medium">Thấy lần cuối</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sourceKey} data-source-key className="border-t border-stone-200 align-top">
                  <td className="break-all py-1.5 pr-3 font-mono text-stone-900">{r.sourceKey}</td>
                  <td className="py-1.5 pr-3 text-stone-700">{r.total}</td>
                  <td className="py-1.5 pr-3">
                    <ToneBadge tone={r.currentKind === 'UNKNOWN' ? 'warning' : 'info'} wrap>
                      {kindLabel(r.currentKind, r.currentChannel)}
                    </ToneBadge>
                  </td>
                  <td className="py-1.5 text-stone-600">{r.lastSeenAt ? formatDateTime(r.lastSeenAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
      {sources.data?.truncated && <p className="text-xs text-stone-500">Chỉ hiện các nguồn nhiều đơn nhất.</p>}
    </section>
  );
}

function OrderRow({ order: o, isAdmin }: { order: ExternalOrder; isAdmin: boolean }) {
  const [showRaw, setShowRaw] = useState(false);
  const detail = useQuery({ queryKey: ['admin-external-order', o.id], queryFn: () => getExternalOrder(o.id), enabled: showRaw });
  return (
    <li data-external-order className="rounded-card border border-stone-200 bg-stone-0 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 break-all font-mono text-xs font-medium text-stone-900">{o.trackingCode ?? `#${o.pancakeOrderId}`}</span>
        <span className="flex shrink-0 flex-wrap gap-1">
          <ToneBadge tone="info">{kindLabel(o.source, o.channel)}</ToneBadge>
          <ToneBadge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</ToneBadge>
        </span>
      </div>
      <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-stone-600 sm:grid-cols-2">
        <DlRow label="Đơn Pancake"><span className="font-mono">#{o.pancakeOrderId}</span></DlRow>
        {o.marketplaceOrderSn && <DlRow label="Mã đơn sàn"><span className="font-mono">{o.marketplaceOrderSn}</span></DlRow>}
        <DlRow label="SĐT">{o.phone ?? 'không có hoặc bị che'}</DlRow>
        <DlRow label="Tiền hàng">{o.goodsValue === null ? 'chưa tính được' : formatVnd(o.goodsValue)}</DlRow>
        <DlRow label="Giao lúc">{o.deliveredAt ? formatDateTime(o.deliveredAt) : '—'}</DlRow>
        <DlRow label="Pancake cập nhật">{o.pancakeUpdatedAt ? formatDateTime(o.pancakeUpdatedAt) : '—'}</DlRow>
        <DlRow label="Khoá nguồn" className="break-all sm:col-span-2"><span className="font-mono">{o.sourceKey}</span></DlRow>
      </dl>
      {isAdmin && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowRaw((v) => !v)} className={BTN_XS_SECONDARY}>
            {showRaw ? 'Ẩn payload Pancake' : 'Xem payload Pancake'}
          </button>
          {showRaw && detail.isLoading && <p className="mt-1 text-xs text-stone-500">Đang tải…</p>}
          {showRaw && detail.isError && <p className="mt-1 text-xs text-danger-fg">Không tải được payload.</p>}
          {showRaw && detail.data && (
            <pre data-raw-payload className="mt-1 max-h-80 overflow-auto rounded-control bg-stone-100 p-2 text-xs text-stone-800">
              {JSON.stringify(detail.data.lastPayload ?? null, null, 2)}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}
