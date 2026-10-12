'use client';

import { useRef, useState } from 'react';
import { ChevronDown, ChevronUp, FileText, History, MapPin } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CopyButton } from '@/components/copy-button';
import { getOrderStatusHistory, INVOICE_URL_MAX, issueOrderInvoice, type AdminOrder } from '@/lib/admin-client';
import { actorLabel, canIssueInvoice, formatShippingAddress, invoiceStatusLabel, invoiceUrlError } from '@/lib/admin-order-detail';
import { safeHttpsLink } from '@/lib/admin-pickers';
import { ORDER_STATUS_LABELS } from '@/lib/export-csv';
import { useConfirm } from './confirm-dialog';
import { BTN_LINK, INPUT_CLASS, Notice, ToneBadge } from './ui';
import { formatDateTime } from '@/lib/format-date';

const statusText = (s: string) => ORDER_STATUS_LABELS[s] ?? s;

/** Địa chỉ giao (ảnh chụp lúc đặt) để CSKH tra mà không phải vào DB. */
export function OrderShippingAddress({ order }: { order: AdminOrder }) {
  const addr = formatShippingAddress(order.shippingAddress);
  return (
    <section aria-label="Địa chỉ giao hàng" className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-stone-500" aria-hidden />
        <span className="text-xs font-semibold uppercase text-stone-600">Địa chỉ giao hàng</span>
      </div>
      {addr ? (
        <div className="mt-2 space-y-0.5 text-xs text-stone-700">
          {(addr.recipient || addr.phone) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-stone-900">{addr.recipient || 'Người nhận'}</span>
              {addr.phone && (
                <>
                  <span>{addr.phone}</span>
                  <CopyButton text={addr.phone} label="Chép SĐT" />
                </>
              )}
            </div>
          )}
          {addr.line && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 break-words">{addr.line}</span>
              <CopyButton text={addr.line} label="Chép địa chỉ" />
            </div>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-stone-500">Đơn này chưa có địa chỉ giao hàng được ghi lại.</p>
      )}
    </section>
  );
}

/** Sổ ghi vết: ai đổi trạng thái đơn, từ đâu sang đâu, lúc nào. Chỉ tải khi mở. */
export function OrderStatusHistory({ order }: { order: AdminOrder }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['admin-order-history', order.id],
    queryFn: () => getOrderStatusHistory(order.id || order.code),
    enabled: open,
  });
  return (
    <section aria-label="Lịch sử trạng thái đơn" className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[44px] w-full items-center gap-2 rounded-control text-left"
      >
        <History className="h-4 w-4 text-stone-500" aria-hidden />
        <span className="text-xs font-semibold uppercase text-stone-600">Lịch sử trạng thái</span>
        {open ? <ChevronUp className="ml-auto h-4 w-4 text-stone-500" aria-hidden /> : <ChevronDown className="ml-auto h-4 w-4 text-stone-500" aria-hidden />}
      </button>
      {open && (
        <div className="mt-1">
          {q.isLoading && <p className="text-xs text-stone-500">Đang tải lịch sử…</p>}
          {q.isError && (
            <p role="alert" className="text-xs text-danger-fg">
              {q.error instanceof Error ? q.error.message : 'Không tải được lịch sử.'}{' '}
              <button type="button" className={`${BTN_LINK} text-xs`} onClick={() => void q.refetch()}>
                Thử lại
              </button>
            </p>
          )}
          {q.data && q.data.history.length === 0 && <p className="text-xs text-stone-500">Chưa có lịch sử đổi trạng thái.</p>}
          {q.data && q.data.history.length > 0 && (
            <ol className="space-y-2 border-l border-stone-200 pl-3">
              {q.data.history.map((h) => (
                <li key={h.id} className="text-xs text-stone-700">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="font-medium text-stone-900">
                      {statusText(h.fromStatus)} → {statusText(h.toStatus)}
                    </span>
                    <span className="text-stone-500">{formatDateTime(h.createdAt)}</span>
                  </div>
                  <div className="text-stone-500">{actorLabel(h)}</div>
                  {h.note && <div className="break-words text-stone-600">{h.note}</div>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Đơn khách yêu cầu hoá đơn VAT: thông tin xuất hoá đơn + ghi nhận "Đã xuất hoá đơn" (kèm link nếu có). Hệ thống chưa
 * tự gọi nhà cung cấp hoá đơn điện tử — kế toán phát hành ở hệ thống hoá đơn rồi ghi nhận tại đây; BE báo khách
 * (INVOICE_ISSUED) giống webhook Pancake. Luật + lỗi 400 của BE hiện NGUYÊN VĂN.
 */
export function OrderInvoicePanel({ order }: { order: AdminOrder }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inFlight = useRef(false);
  const { confirm, dialog } = useConfirm();

  const mut = useMutation({
    mutationFn: () => issueOrderInvoice(order.id || order.code, url),
    onSuccess: (r) => {
      setMsg({ ok: true, text: r.message });
      setUrl('');
      void qc.invalidateQueries({ queryKey: ['admin-orders'] });
      void qc.invalidateQueries({ queryKey: ['admin-invoice-pending-count'] });
    },
    onError: (e: unknown) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Ghi nhận hoá đơn thất bại.' }),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const req = order.invoiceRequest;
  if (!req) return null;
  const status = invoiceStatusLabel(order.invoiceStatus) ?? { label: 'Chưa xử lý', tone: 'neutral' as const };
  const closed = order.status === 'CANCELLED' || order.status === 'RETURNED';
  const issuable = canIssueInvoice(order);
  const safeInvoiceUrl = safeHttpsLink(order.invoiceUrl);

  const onIssue = async () => {
    if (inFlight.current || mut.isPending) return;
    const err = invoiceUrlError(url);
    if (err) return setMsg({ ok: false, text: err });
    setMsg(null);
    const ok = await confirm({
      title: 'Xác nhận đã xuất hoá đơn',
      message:
        `Ghi nhận đã xuất hoá đơn VAT cho đơn ${order.code} (${req.companyName ?? 'khách'}, MST ${req.taxCode ?? '—'})?\n\n` +
        'Đơn chuyển sang "Đã xuất hoá đơn" và khách được báo trong mục Thông báo. Chỉ bấm khi hoá đơn đã được phát hành ở hệ thống hoá đơn điện tử.',
      confirmLabel: 'Đã xuất hoá đơn',
    });
    if (!ok || inFlight.current || mut.isPending) return;
    inFlight.current = true;
    mut.mutate();
  };

  return (
    <section aria-label="Hoá đơn VAT" className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="h-4 w-4 text-stone-500" aria-hidden />
        <span className="text-xs font-semibold uppercase text-stone-600">Hoá đơn VAT</span>
        <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
      </div>

      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-stone-500">Mã số thuế:</dt>
          <dd className="flex items-center gap-1.5 font-mono font-semibold text-stone-800">
            {req.taxCode ?? '—'}
            {req.taxCode && <CopyButton text={req.taxCode} label="Chép" />}
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-stone-500">Email nhận hoá đơn:</dt>
          <dd className="break-all text-stone-800">{req.email ?? '—'}</dd>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <dt className="text-stone-500">Công ty:</dt>
          <dd className="font-medium text-stone-800">{req.companyName ?? '—'}</dd>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <dt className="text-stone-500">Địa chỉ:</dt>
          <dd className="min-w-0 break-words text-stone-800">{req.address ?? '—'}</dd>
        </div>
        {order.invoiceUrl && (
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <dt className="text-stone-500">Link hoá đơn:</dt>
            <dd className="min-w-0 break-all">
              {safeInvoiceUrl ? (
                <a href={safeInvoiceUrl} target="_blank" rel="noopener noreferrer" className="text-forest-700 underline hover:text-forest-800">
                  {order.invoiceUrl}
                </a>
              ) : (
                <span className="text-stone-800">{order.invoiceUrl}</span>
              )}
            </dd>
          </div>
        )}
      </dl>

      {closed && order.invoiceStatus !== 'ISSUED' && (
        <div className="mt-2">
          <Notice tone="warning">Đơn đã huỷ/trả — không xuất hoá đơn VAT.</Notice>
        </div>
      )}

      {issuable && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="url"
            aria-label="Link hoá đơn điện tử (tuỳ chọn)"
            placeholder="Link hoá đơn điện tử (tuỳ chọn, https://…)"
            maxLength={INVOICE_URL_MAX}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={mut.isPending}
            className={`${INPUT_CLASS} min-h-[44px] min-w-0 flex-1`}
          />
          <button
            type="button"
            onClick={onIssue}
            disabled={mut.isPending}
            className="min-h-[44px] rounded-control bg-forest-600 px-4 text-sm font-medium text-stone-0 hover:bg-forest-700 disabled:bg-stone-200 disabled:text-stone-500"
          >
            {mut.isPending ? 'Đang ghi nhận…' : 'Đã xuất hoá đơn'}
          </button>
        </div>
      )}
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-xs ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
          {msg.text}
        </p>
      )}
      {dialog}
    </section>
  );
}
