'use client';

import { useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PANCAKE_RESOLVE_NOTE_MAX, resolvePancakeAttention, type AdminOrder } from '@/lib/admin-client';
import { formatDateTime } from '@/lib/format-date';
import { BTN_XS_SECONDARY, FIELD_XS, ToneBadge, Field } from './ui';
import { useConfirm } from './confirm-dialog';

export const PANCAKE_ATTENTION_COUNT_KEY = ['admin-pancake-attention-count'] as const;

export function PancakeAttentionBadge({ order }: { order: AdminOrder }) {
  if (!order.pancakeAttentionAt) return null;
  return (
    <ToneBadge tone="danger" title={order.pancakeAttention ?? undefined}>
      <AlertTriangle className="h-3 w-3" aria-hidden />
      Pancake: cần xử lý
    </ToneBadge>
  );
}

/**
 * Pancake báo trạng thái mà hệ thống không tự áp được (đơn bị xoá trên Pancake, đang hoàn, hoàn một phần,
 * đã nhận tiền khi đơn đã huỷ…). Admin xử lý ngoài hệ thống rồi bấm "Đã xử lý" để đơn rời hàng đợi.
 */
export function PancakeAttentionPanel({ order }: { order: AdminOrder }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inFlight = useRef(false);
  const { confirm, dialog } = useConfirm();

  const resolve = useMutation({
    mutationFn: (n: string) => resolvePancakeAttention(order.id, n),
    onSuccess: (r) => {
      setMsg({ ok: true, text: r.message });
      setNote('');
      void qc.invalidateQueries({ queryKey: ['admin-orders'] });
      void qc.invalidateQueries({ queryKey: PANCAKE_ATTENTION_COUNT_KEY });
    },
    onError: (e: unknown) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Thao tác thất bại.' }),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const message = msg && (
    <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-xs ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
      {msg.text}
    </p>
  );
  if (!order.pancakeAttentionAt) return message || null;

  const onResolve = async () => {
    if (inFlight.current || resolve.isPending) return;
    const ok = await confirm({
      title: 'Đánh dấu đã xử lý',
      message: `Đơn ${order.code} sẽ rời hàng đợi "Cần xử lý Pancake". Chỉ bấm khi đã xử lý xong việc Pancake báo (đối soát với kho, hoàn tiền thủ công, báo khách…).`,
      confirmLabel: 'Đã xử lý',
    });
    if (!ok || inFlight.current) return;
    inFlight.current = true;
    setMsg(null);
    resolve.mutate(note);
  };

  return (
    <section aria-label="Cần xử lý Pancake" className="rounded-card border border-danger-fg bg-danger-bg p-3 text-xs text-danger-fg">
      <div className="flex flex-wrap items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        <span>Cần xử lý Pancake</span>
        <span className="font-normal text-stone-600">{formatDateTime(order.pancakeAttentionAt)}</span>
      </div>
      <p className="mt-1 text-stone-800">{order.pancakeAttention}</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Field label="Ghi chú xử lý Pancake (tuỳ chọn)" className="grow basis-40">
          <input
            type="text"
            placeholder="vd: đã hoàn tiền tay cho khách"
            maxLength={PANCAKE_RESOLVE_NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={resolve.isPending}
            className={`${FIELD_XS} w-full`}
          />
        </Field>
        <button type="button" onClick={onResolve} disabled={resolve.isPending} className={BTN_XS_SECONDARY}>
          {resolve.isPending ? 'Đang lưu…' : 'Đã xử lý'}
        </button>
      </div>
      {message}
      {dialog}
    </section>
  );
}
