'use client';

import React, { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Clock, PackageCheck, Truck } from 'lucide-react';
import {
  acceptFulfilOrder,
  cancelFulfilOrder,
  deliverFulfilOrder,
  failFulfilOrder,
  listFulfilOrders,
  packFulfilOrder,
  shipFulfilOrder,
  type FulfilOrder,
  type FulfilStatus,
  type SlaState,
} from '@/lib/merchant-client';
import { pageRange } from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import { formatDateTime } from '@/lib/format-date';
import { ORDER_STATUS_LABELS } from '@/lib/export-csv';
import {
  BTN_SMALL,
  BTN_XS_DANGER,
  BTN_XS_PRIMARY,
  BTN_XS_SECONDARY,
  FIELD_XS,
  Notice,
  ToneBadge,
  TOUCH_H,
  chipClass,
} from '@/components/admin/ui';

const FILTERS: { k: FulfilStatus | ''; label: string }[] = [
  { k: 'CONFIRMED', label: 'Chờ xử lý' },
  { k: 'PACKED', label: 'Đã đóng gói' },
  { k: 'SHIPPING', label: 'Đang giao' },
  { k: 'DELIVERED', label: 'Đã giao' },
  { k: 'CANCELLED', label: 'Đã huỷ' },
  { k: '', label: 'Tất cả' },
];

const SLA_LABEL: Record<Exclude<SlaState, null>, string> = {
  CONFIRM_OVERDUE: 'Quá hạn xác nhận',
  SHIP_OVERDUE: 'Quá hạn gửi hàng',
  DELIVER_OVERDUE: 'Quá hạn giao',
};

/** Bước đối tác đang phải làm, để ghi hạn bên cạnh. */
function dueLabel(o: FulfilOrder): string | null {
  if (!o.sla.dueAt) return null;
  if (o.status === 'CONFIRMED' && !o.merchantAcceptedAt) return `Xác nhận trước ${formatDateTime(o.sla.dueAt)}`;
  if (o.status === 'CONFIRMED' || o.status === 'PACKED') return `Gửi hàng trước ${formatDateTime(o.sla.dueAt)}`;
  if (o.status === 'SHIPPING') return `Giao xong trước ${formatDateTime(o.sla.dueAt)}`;
  return null;
}

/** "Đơn cần giao": đơn khách đặt hàng do gian hàng tự giao (D4). Đối tác xác nhận, đóng gói, nhập vận đơn, báo đã giao. */
export function FulfilOrdersTab() {
  const [status, setStatusState] = useState<FulfilStatus | ''>('CONFIRMED');
  const [page, setPage] = useState(1);
  const setStatus = (s: FulfilStatus | '') => {
    setStatusState(s);
    setPage(1);
  };
  const q = useQuery({
    queryKey: ['merchant-fulfil-orders', status, page],
    queryFn: () => listFulfilOrders(status || undefined, page),
    placeholderData: keepPreviousData,
  });
  const orders = q.data?.data ?? [];
  const lastPage = q.data ? pageRange(q.data.meta, q.data.meta.total, orders.length).totalPages : 1;
  useEffect(() => {
    if (q.data && !q.isPlaceholderData && page > lastPage) setPage(lastPage);
  }, [q.data, q.isPlaceholderData, page, lastPage]);
  const sla = q.data?.slaConfig;
  const counts = q.data?.counts ?? {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display font-semibold text-stone-900">Đơn cần giao</h2>
        {sla && (
          <p className="text-xs text-stone-500">
            Hạn: xác nhận trong {sla.confirmHours} giờ, gửi hàng trong {sla.shipHours} giờ kể từ lúc khách đặt.
          </p>
        )}
      </div>
      <Notice>
        Đây là đơn của sản phẩm bạn tự giao. Tubu Tree đã thu tiền khách (trừ đơn COD, bạn thu khi giao). Bạn đóng gói, gửi qua
        đơn vị vận chuyển và nhập mã vận đơn để khách theo dõi. Tiền hàng được đối soát ở tab Đối soát sau khi đơn giao xong.
      </Notice>

      <div role="group" aria-label="Lọc đơn theo trạng thái" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const n = f.k ? counts[f.k] : undefined;
          return (
            <button key={f.k || 'all'} type="button" onClick={() => setStatus(f.k)} aria-pressed={status === f.k} className={chipClass(status === f.k)}>
              {f.label}
              {n ? ` (${n})` : ''}
            </button>
          );
        })}
      </div>

      {q.isLoading && <p className="text-sm text-stone-500">Đang tải đơn cần giao…</p>}
      {q.isError && <p className="text-sm text-danger-fg">Không tải được đơn cần giao.</p>}
      {q.data && orders.length === 0 && (
        <p className="rounded-card border border-stone-200 bg-stone-0 p-6 text-center text-sm text-stone-500">
          {status ? 'Không có đơn nào ở trạng thái này.' : 'Gian hàng chưa có đơn tự giao nào.'}
        </p>
      )}
      <div className="space-y-3">
        {orders.map((o) => (
          <FulfilOrderCard key={o.id} order={o} />
        ))}
      </div>

      {q.data && lastPage > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-stone-500">
          <button type="button" onClick={() => setPage(page - 1)} disabled={page <= 1 || q.isPlaceholderData} className={BTN_SMALL}>
            ← Trang trước
          </button>
          <span>
            Trang {page}/{lastPage}
          </span>
          <button type="button" onClick={() => setPage(page + 1)} disabled={page >= lastPage || q.isPlaceholderData} className={BTN_SMALL}>
            Trang sau →
          </button>
        </div>
      )}
    </div>
  );
}

type Panel = 'ship' | 'cancel' | 'fail' | null;

export function FulfilOrderCard({ order: o }: { order: FulfilOrder }) {
  const qc = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [carrier, setCarrier] = useState('');
  const [trackingCode, setTrackingCode] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setError(null);
      setPanel(null);
      void qc.invalidateQueries({ queryKey: ['merchant-fulfil-orders'] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Không cập nhật được đơn.'),
  });
  const busy = mut.isPending;
  const open = (p: Panel) => {
    setError(null);
    setPanel(panel === p ? null : p);
  };

  const a = o.shippingAddress;
  const address = a ? [a.street, a.ward, a.district, a.province].filter(Boolean).join(', ') : '';
  const due = dueLabel(o);
  const canCancel = o.status === 'CONFIRMED' || o.status === 'PACKED';

  return (
    <article className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card" aria-label={`Đơn ${o.code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-stone-900">{o.code}</h3>
        <ToneBadge tone={o.status === 'CANCELLED' || o.status === 'RETURNED' ? 'danger' : o.status === 'DELIVERED' ? 'success' : 'info'}>
          {o.status === 'CONFIRMED' && !o.merchantAcceptedAt ? 'Chờ bạn xác nhận' : (ORDER_STATUS_LABELS[o.status] ?? o.status)}
        </ToneBadge>
        {o.sla.state && (
          <ToneBadge tone="danger">
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
            {SLA_LABEL[o.sla.state]}
          </ToneBadge>
        )}
        <span className="ml-auto text-xs text-stone-500">Đặt lúc {formatDateTime(o.createdAt)}</span>
      </div>
      {due && !o.sla.state && (
        <p className="mt-1 flex items-center gap-1 text-xs text-stone-600">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {due}
        </p>
      )}

      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-stone-500">Người nhận</p>
          <p className="font-medium text-stone-900">
            {[a?.recipient, a?.phone].filter(Boolean).join(' · ') || 'Khách mua'}
          </p>
          {address && <p className="text-xs text-stone-600">{address}</p>}
          {o.note && <p className="mt-1 text-xs text-stone-600">Ghi chú của khách: {o.note}</p>}
        </div>
        <div>
          <p className="text-xs font-medium text-stone-500">Hàng cần gửi</p>
          <ul className="space-y-0.5">
            {o.items.map((it) => (
              <li key={it.id} className="text-xs text-stone-700">
                {it.productName}
                {it.variationName && it.variationName !== 'Mặc định' ? ` (${it.variationName})` : ''}{' '}
                <span className="font-semibold">x{it.quantity}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-stone-700">
            {o.paymentMethod === 'COD' ? (
              <>
                Thu hộ khi giao: <span className="font-semibold text-stone-900">{formatVnd(o.total)}</span>
              </>
            ) : (
              <>Khách đã thanh toán qua Tubu Tree, không thu thêm.</>
            )}
          </p>
        </div>
      </div>

      {o.shippingCode && (
        <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-stone-600">
          <Truck className="h-3 w-3" aria-hidden="true" />
          {o.shippingPartner} · {o.shippingCode}
          {o.trackingLink && (
            <a href={o.trackingLink} target="_blank" rel="noreferrer" className="font-medium text-forest-700 underline">
              Tra cứu
            </a>
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {o.status === 'CONFIRMED' && !o.merchantAcceptedAt && (
          <button type="button" disabled={busy} onClick={() => mut.mutate(() => acceptFulfilOrder(o.id))} className={BTN_XS_PRIMARY}>
            Xác nhận đơn
          </button>
        )}
        {o.status === 'CONFIRMED' && o.merchantAcceptedAt && (
          <button type="button" disabled={busy} onClick={() => mut.mutate(() => packFulfilOrder(o.id))} className={BTN_XS_SECONDARY}>
            <PackageCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            Đã đóng gói
          </button>
        )}
        {canCancel && (
          <button type="button" disabled={busy} onClick={() => open('ship')} aria-expanded={panel === 'ship'} className={BTN_XS_PRIMARY}>
            Nhập mã vận đơn
          </button>
        )}
        {o.status === 'SHIPPING' && (
          <>
            <button type="button" disabled={busy} onClick={() => mut.mutate(() => deliverFulfilOrder(o.id))} className={BTN_XS_PRIMARY}>
              Khách đã nhận hàng
            </button>
            <button type="button" disabled={busy} onClick={() => open('fail')} aria-expanded={panel === 'fail'} className={BTN_XS_DANGER}>
              Giao không thành công
            </button>
          </>
        )}
        {canCancel && (
          <button type="button" disabled={busy} onClick={() => open('cancel')} aria-expanded={panel === 'cancel'} className={BTN_XS_DANGER}>
            Huỷ đơn
          </button>
        )}
      </div>

      {panel === 'ship' && (
        <form
          className="mt-3 grid gap-2 rounded-control border border-stone-200 bg-stone-50 p-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            mut.mutate(() =>
              shipFulfilOrder(o.id, {
                carrier: carrier.trim(),
                trackingCode: trackingCode.trim(),
                trackingUrl: trackingUrl.trim() || undefined,
              }),
            );
          }}
        >
          <label className="text-xs font-medium text-stone-700">
            Đơn vị vận chuyển
            <input value={carrier} onChange={(e) => setCarrier(e.target.value)} required maxLength={60} placeholder="GHN, GHTK, Viettel Post…" className={`mt-1 w-full ${FIELD_XS}`} />
          </label>
          <label className="text-xs font-medium text-stone-700">
            Mã vận đơn
            <input value={trackingCode} onChange={(e) => setTrackingCode(e.target.value)} required maxLength={60} className={`mt-1 w-full ${FIELD_XS}`} />
          </label>
          <label className="text-xs font-medium text-stone-700">
            Link tra cứu (không bắt buộc)
            <input value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} type="text" inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="ghn.vn/…" className={`mt-1 w-full ${FIELD_XS}`} />
          </label>
          <div className="sm:col-span-3">
            <button type="submit" disabled={busy} className={BTN_XS_PRIMARY}>
              {busy ? 'Đang lưu…' : 'Xác nhận đã gửi hàng'}
            </button>
          </div>
        </form>
      )}

      {(panel === 'cancel' || panel === 'fail') && (
        <form
          className="mt-3 space-y-2 rounded-control border border-stone-200 bg-stone-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const r = reason.trim();
            if (!r) return;
            mut.mutate(() => (panel === 'fail' ? failFulfilOrder(o.id, r) : cancelFulfilOrder(o.id, r)));
          }}
        >
          <label className="block text-xs font-medium text-stone-700">
            {panel === 'fail' ? 'Vì sao giao không thành công? (khách sẽ nhận được lý do này)' : 'Lý do huỷ (khách sẽ nhận được lý do này)'}
            <input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={300} className={`mt-1 w-full ${FIELD_XS}`} />
          </label>
          <p className="text-xs text-stone-500">Đơn huỷ được hoàn kho; tiền khách đã trả trước được Tubu Tree hoàn theo chính sách.</p>
          <button type="submit" disabled={busy || !reason.trim()} className={`${TOUCH_H} rounded-control bg-danger-fg px-3 py-1 text-xs font-medium text-stone-0 hover:brightness-90 disabled:opacity-50`}>
            {busy ? 'Đang huỷ…' : panel === 'fail' ? 'Xác nhận giao không thành công' : 'Xác nhận huỷ đơn'}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger-fg">
          {error}
        </p>
      )}
    </article>
  );
}
