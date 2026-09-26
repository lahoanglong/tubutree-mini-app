'use client';

import { useRef, useState } from 'react';
import { Recycle } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CopyButton } from '@/components/copy-button';
import {
  cancelGomdonWaybill,
  GOMDON_HANDLED_NOTE_MAX,
  markGomdonHandled,
  retryGomdon,
  type AdminOrder,
} from '@/lib/admin-client';
import {
  gomdonAdminActions,
  gomdonCancelLabel,
  gomdonStatusLabel,
  needsRecyclingAttention,
} from '@/lib/recycling';
import { Notice, ToneBadge } from './ui';

/** Badge ở dòng danh sách đơn: có thu gom / cần xử lý thu gom. */
export function RecyclingBadge({ order }: { order: AdminOrder }) {
  if (!order.hasRecyclingPickup) return null;
  const attention = needsRecyclingAttention(order);
  return (
    <ToneBadge tone={attention ? 'danger' : 'success'} title={gomdonStatusLabel(order.gomdonStatus).label}>
      <Recycle className="h-3 w-3" aria-hidden />
      {attention ? 'Thu gom: cần xử lý' : 'Thu gom'}
    </ToneBadge>
  );
}

function fmtTime(iso: string | null | undefined): string | null {
  return iso ? new Date(iso).toLocaleString('vi-VN') : null;
}

/**
 * Khối "Thu gom vật liệu tái chế" trong chi tiết đơn admin: trạng thái vận đơn Gomdon bằng tiếng Việt,
 * mã vận đơn BestExpress, kết quả huỷ, và 3 thao tác tạo lại / huỷ vận đơn / "Đã xử lý tay". Luật cho
 * phép nằm ở BE (GomdonOrderService) — lỗi trả về được hiện NGUYÊN VĂN.
 */
export function RecyclingPanel({ order }: { order: AdminOrder }) {
  const qc = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const [handledNote, setHandledNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Chặn bấm lặp trước khi React kịp render lại nút disabled (double-submit).
  const handledInFlight = useRef(false);

  const onDone = (text: string) => {
    setMsg({ ok: true, text });
    setConfirmed(false);
    setHandledNote('');
    void qc.invalidateQueries({ queryKey: ['admin-orders'] });
    void qc.invalidateQueries({ queryKey: ['admin-recycling-count'] });
  };
  const onFail = (e: unknown) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Thao tác thất bại.' });

  const actions = gomdonAdminActions(order);
  const retry = useMutation({
    mutationFn: () => retryGomdon(order.id, actions.retryNeedsConfirm && confirmed),
    onSuccess: (r) => onDone(r.message),
    onError: onFail,
  });
  const cancel = useMutation({
    mutationFn: () => cancelGomdonWaybill(order.id),
    onSuccess: (r) => onDone(r.message),
    onError: onFail,
  });
  const markHandled = useMutation({
    mutationFn: (note: string) => markGomdonHandled(order.id, note),
    onSuccess: (r) => onDone(r.message),
    onError: onFail,
    onSettled: () => {
      handledInFlight.current = false;
    },
  });
  const busy = retry.isPending || cancel.isPending || markHandled.isPending;

  const onMarkHandled = () => {
    if (handledInFlight.current || busy) return;
    const ok = window.confirm(
      `Đánh dấu thu gom của đơn ${order.code} là "Đã xử lý tay"? Đơn sẽ rời hàng đợi "Cần xử lý thu gom" và hệ thống ` +
        'KHÔNG tự tạo vận đơn Gomdon cho đơn này nữa. Chỉ bấm khi đã xử lý xong ngoài hệ thống (tạo vận đơn tay / hẹn thu gom riêng / báo khách).',
    );
    if (!ok) return;
    handledInFlight.current = true;
    setMsg(null);
    markHandled.mutate(handledNote);
  };

  if (!order.hasRecyclingPickup) return null;

  const status = gomdonStatusLabel(order.gomdonStatus);
  const cancelLabel = gomdonCancelLabel(order.gomdonCancelStatus);

  return (
    <section aria-label="Thu gom vật liệu tái chế" className="rounded border border-green-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Recycle className="h-4 w-4 text-green-700" aria-hidden />
        <span className="text-xs font-semibold uppercase text-neutral-600">Thu gom vật liệu tái chế (Gomdon)</span>
        <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
        {cancelLabel && <ToneBadge tone={cancelLabel.tone}>{cancelLabel.label}</ToneBadge>}
      </div>

      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <dt className="text-neutral-500">Mã vận đơn BestExpress:</dt>
          <dd className="flex items-center gap-1.5 font-mono font-semibold text-neutral-800">
            {order.gomdonPartnerCode ?? '—'}
            {order.gomdonPartnerCode && <CopyButton text={order.gomdonPartnerCode} label="Chép" />}
          </dd>
        </div>
        {fmtTime(order.gomdonStatusAt) && (
          <div className="flex gap-2">
            <dt className="text-neutral-500">Gomdon cập nhật:</dt>
            <dd className="text-neutral-700">{fmtTime(order.gomdonStatusAt)}</dd>
          </div>
        )}
        {fmtTime(order.deliveredAt) && (
          <div className="flex gap-2">
            <dt className="text-neutral-500">Đã giao lúc:</dt>
            <dd className="text-neutral-700">{fmtTime(order.deliveredAt)}</dd>
          </div>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <dt className="shrink-0 text-neutral-500">Khách gửi kèm:</dt>
          <dd className="text-neutral-800">{order.recyclingNote?.trim() || <span className="text-neutral-400">(không ghi chú)</span>}</dd>
        </div>
      </dl>

      {(status.hint || cancelLabel?.hint) && (
        <p className="mt-2 text-xs text-neutral-600">{cancelLabel?.hint ?? status.hint}</p>
      )}

      {(actions.canRetry || actions.canCancel || actions.canMarkHandled) && (
        <div className="mt-3 space-y-2 border-t border-neutral-100 pt-2">
          {actions.canRetry && (
            <div className="space-y-2">
              {actions.retryWarning && <Notice tone="warning">{actions.retryWarning}</Notice>}
              <label className="flex cursor-pointer items-start gap-2 text-xs text-neutral-800">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  disabled={busy}
                />
                <span>
                  {actions.retryNeedsConfirm
                    ? `Tôi đã tra Gomdon theo mã đơn ${order.code} và xác nhận KHÔNG có vận đơn nào.`
                    : 'Tôi đã kiểm tra Pancake/Gomdon: kho CHƯA tạo vận đơn tay cho đơn này.'}
                </span>
              </label>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {actions.canRetry && (
              <button
                type="button"
                onClick={() => {
                  setMsg(null);
                  retry.mutate();
                }}
                disabled={!confirmed || busy}
                className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:bg-neutral-300"
              >
                {retry.isPending ? 'Đang xếp hàng…' : 'Tạo lại vận đơn Gomdon'}
              </button>
            )}
            {actions.canCancel && (
              <button
                type="button"
                onClick={() => {
                  const text =
                    order.status === 'CANCELLED'
                      ? `Thử huỷ lại vận đơn Gomdon ${order.gomdonPartnerCode ?? ''} của đơn đã huỷ ${order.code}?`
                      : `Huỷ vận đơn Gomdon ${order.gomdonPartnerCode ?? ''} của đơn ${order.code}? Đơn vẫn hiệu lực — sau đó cần tạo vận đơn mới hoặc giao bằng hãng khác.`;
                  if (!window.confirm(text)) return;
                  setMsg(null);
                  cancel.mutate();
                }}
                disabled={busy}
                className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {cancel.isPending ? 'Đang huỷ…' : 'Huỷ vận đơn Gomdon'}
              </button>
            )}
          </div>
          {actions.canMarkHandled && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                aria-label="Ghi chú đã xử lý tay"
                placeholder="Ghi chú (tuỳ chọn), vd: đã tạo vận đơn GHN tay"
                maxLength={GOMDON_HANDLED_NOTE_MAX}
                value={handledNote}
                onChange={(e) => setHandledNote(e.target.value)}
                disabled={busy}
                className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={onMarkHandled}
                disabled={busy}
                className="rounded border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                {markHandled.isPending ? 'Đang lưu…' : 'Đã xử lý tay'}
              </button>
            </div>
          )}
        </div>
      )}

      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-xs ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
