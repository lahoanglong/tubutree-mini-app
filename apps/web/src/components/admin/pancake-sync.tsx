'use client';

import { useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { retryPancakePush, type AdminOrder } from '@/lib/admin-client';
import type { Tone } from '@/lib/recycling';
import { formatDateTime } from '@/lib/format-date';
import { BTN_XS_SECONDARY, ToneBadge } from './ui';
import { useConfirm } from './confirm-dialog';
import { PANCAKE_ATTENTION_COUNT_KEY } from './pancake-attention';

/** Trạng thái đơn Tubu còn trong kho — chỉ những đơn này được "Đẩy lại Pancake" (API chặn lần nữa). */
const IN_WAREHOUSE = new Set(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED']);

export interface PancakeSyncState {
  tone: Tone;
  label: string;
  /** Hiện ở danh sách đơn (đơn cần để mắt tới); trạng thái bình thường chỉ hiện trong chi tiết. */
  flag: boolean;
}

/** Tình trạng đồng bộ đơn với kho Pancake, theo các cột PancakeOrderService ghi. */
export function pancakeSyncState(order: AdminOrder): PancakeSyncState | null {
  switch (order.pancakeCancelStatus) {
    case 'PENDING':
      return { tone: 'warning', label: 'Pancake: đang chờ huỷ', flag: true };
    case 'FAILED':
      return { tone: 'danger', label: 'Pancake: chưa huỷ được', flag: true };
    case 'TOO_LATE':
      return { tone: 'danger', label: 'Pancake: đã giao vận chuyển', flag: true };
    case 'CANCELLED':
      return { tone: 'neutral', label: 'Pancake: đã huỷ', flag: false };
    case 'NOT_FOUND':
      return null;
  }
  if (order.pancakeOrderId) return { tone: 'success', label: 'Đã lên Pancake', flag: false };
  switch (order.pancakePushStatus) {
    case 'FAILED':
      return { tone: 'danger', label: 'Pancake: đẩy lỗi', flag: true };
    case 'STALE':
      return { tone: 'warning', label: 'Pancake: quá hạn tự đẩy', flag: true };
    case 'NOT_CONFIGURED':
      return { tone: 'warning', label: 'Pancake: chưa cấu hình', flag: true };
    case 'PENDING':
    case 'PUSHING':
      return { tone: 'info', label: 'Pancake: đang đẩy', flag: Boolean(order.pancakeSyncError) };
    case 'WAITING_PAYMENT':
      return { tone: 'neutral', label: 'Pancake: chờ thanh toán', flag: false };
    default:
      return null;
  }
}

export function canRetryPancakePush(order: AdminOrder): boolean {
  if (order.pancakeOrderId || !IN_WAREHOUSE.has(order.status)) return false;
  return order.pancakePushStatus !== 'WAITING_PAYMENT';
}

export function PancakeSyncBadge({ order }: { order: AdminOrder }) {
  const s = pancakeSyncState(order);
  if (!s?.flag) return null;
  return (
    <ToneBadge tone={s.tone} title={order.pancakeSyncError ?? undefined}>
      {s.label}
    </ToneBadge>
  );
}

/** Dòng "Kho Pancake" trong chi tiết đơn: trạng thái, lỗi gần nhất, nút "Đẩy lại Pancake". */
export function PancakeSyncPanel({ order }: { order: AdminOrder }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inFlight = useRef(false);
  const { confirm, dialog } = useConfirm();

  const retry = useMutation({
    mutationFn: () => retryPancakePush(order.id),
    onSuccess: (r) => {
      setMsg({ ok: true, text: r.message });
      void qc.invalidateQueries({ queryKey: ['admin-orders'] });
      void qc.invalidateQueries({ queryKey: PANCAKE_ATTENTION_COUNT_KEY });
    },
    onError: (e: unknown) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không đẩy lại được.' }),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const s = pancakeSyncState(order);
  const showRetry = canRetryPancakePush(order);
  if (!s && !showRetry && !msg) return null;

  const onRetry = async () => {
    if (inFlight.current || retry.isPending) return;
    const ok = await confirm({
      title: 'Đẩy lại Pancake',
      message: `Gửi lại đơn ${order.code} sang kho Pancake. Hệ thống tra theo mã đơn trước khi tạo nên không sinh đơn trùng; chỉ bấm khi kho chưa giao tay đơn này.`,
      confirmLabel: 'Đẩy lại',
    });
    if (!ok || inFlight.current) return;
    inFlight.current = true;
    setMsg(null);
    retry.mutate();
  };

  return (
    <section aria-label="Kho Pancake" className="rounded-card border border-stone-200 bg-stone-0 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold uppercase text-stone-500">Kho Pancake:</span>
        {s && <ToneBadge tone={s.tone}>{s.label}</ToneBadge>}
        {order.pancakeOrderId && <span className="text-stone-600">Mã đơn Pancake #{order.pancakeOrderId}</span>}
        {!order.pancakeOrderId && !!order.pancakePushAttempts && (
          <span className="text-stone-600">
            {order.pancakePushAttempts} lần thử
            {order.pancakeLastAttemptAt ? `, gần nhất ${formatDateTime(order.pancakeLastAttemptAt)}` : ''}
          </span>
        )}
        {showRetry && (
          <button type="button" onClick={onRetry} disabled={retry.isPending} className={`${BTN_XS_SECONDARY} inline-flex items-center gap-1 sm:ml-auto`}>
            <RefreshCw className={`h-3 w-3 ${retry.isPending ? 'animate-spin' : ''}`} aria-hidden />
            {retry.isPending ? 'Đang xếp lệnh…' : 'Đẩy lại Pancake'}
          </button>
        )}
      </div>
      {order.pancakeSyncError && (
        <p className="mt-1 break-words text-danger-fg">
          <span className="font-medium">Lỗi gần nhất:</span> {order.pancakeSyncError}
        </p>
      )}
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
          {msg.text}
        </p>
      )}
      {dialog}
    </section>
  );
}
