'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConfirm } from '@/components/admin/confirm-dialog';
import { BTN_DANGER_OUTLINE, Notice, ToneBadge } from '@/components/admin/ui';
import { actionErrorText } from '@/lib/admin-error-text';
import { cancelPendingMssOrderEvents, getMssOrderEvents, type MssOrderEventRow, type MssOrderEventsCard as Card } from '@/lib/admin-client';
import { formatDateTime } from '@/lib/format-date';
import type { Tone } from '@/lib/recycling';

const QUERY_KEY = ['admin-mss-order-events'];
const SHOWN_ROWS = 10;

const EVENT_LABEL: Record<string, string> = {
  'order.created': 'Đặt đơn',
  'order.payment_confirmed': 'Đã thanh toán',
  'order.shipping': 'Đang giao',
  'order.delivered': 'Đã giao',
  'order.cancelled': 'Đã huỷ',
};

const STATUS_BADGE: Record<string, { tone: Tone; label: string }> = {
  PENDING: { tone: 'neutral', label: 'Chờ gửi' },
  SENDING: { tone: 'info', label: 'Đang gửi' },
  DELIVERED: { tone: 'info', label: 'MSS đã nhận' },
  RESULT_SENT: { tone: 'success', label: 'Đã tới Zalo' },
  RESULT_SKIPPED: { tone: 'neutral', label: 'MSS bỏ qua' },
  RESULT_FAILED: { tone: 'danger', label: 'Gửi hỏng' },
  RESULT_UNKNOWN: { tone: 'warning', label: 'Không rõ' },
  DEAD: { tone: 'danger', label: 'Lỗi, đã dừng' },
  EXPIRED: { tone: 'warning', label: 'Quá hạn' },
  CANCELLED: { tone: 'neutral', label: 'Đã dừng' },
};

/** Lý do MSS (hoặc Tubu) ghi kèm kết quả, đọc cho Ops. Khoá chưa có ở đây vẫn in thô: MSS có thể thêm lý do mới mà không báo trước. */
export const MSS_REASON_LABEL: Record<string, string> = {
  stranger: 'tin người lạ (chưa kết bạn)',
  stranger_cap: 'hết lượt nhắn người lạ hôm nay',
  privacy_blocked: 'khách chặn tin người lạ',
  not_friend: 'chưa kết bạn',
  opted_out: 'khách từ chối nhận tin',
  superseded: 'bị tin mới hơn thay',
  consent_withdrawn: 'khách rút đồng ý',
  ttl: 'quá hạn sống',
  mss_unavailable: 'MSS không nhận',
  mss_lost: 'MSS mất sự kiện',
  event_id_reused: 'trùng mã sự kiện',
};

function stateBadge(card: Card): { tone: Tone; label: string } {
  if (!card.enabled) return { tone: 'neutral', label: 'Tắt' };
  if (!card.open) return { tone: 'warning', label: 'Chưa có hiệu lực' };
  return card.circuit.state === 'closed' ? { tone: 'success', label: 'Đang chạy' } : { tone: 'danger', label: 'Cầu dao ngắt' };
}

/**
 * Thẻ "Tin đơn hàng qua MSS" ở tab Sức khoẻ hệ thống: số tin đang chờ, đã tới Zalo, hỏng, đã lui về ZNS trong 24 giờ và 10 tin gần
 * nhất (SĐT đã che). Nút dừng tin đang chờ chỉ hiện khi có tin chờ: dùng trước khi tắt cờ mss.order_events_enabled.
 */
export function MssOrderEventsCard() {
  const q = useQuery({ queryKey: QUERY_KEY, queryFn: getMssOrderEvents });
  if (q.isPending) return null;
  const badge = q.data ? stateBadge(q.data) : null;
  return (
    <section aria-labelledby="mss-order-events-title" className="mt-4 rounded-card border border-stone-200 bg-stone-0 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="mss-order-events-title" className="m-0 font-display text-lg font-semibold text-stone-900">
          Tin đơn hàng qua MSS
        </h2>
        {badge && <ToneBadge tone={badge.tone}>{badge.label}</ToneBadge>}
      </div>
      {q.data ? (
        <CardBody card={q.data} />
      ) : (
        <p role="status" className="mt-2 max-w-2xl text-sm text-stone-600">
          Không đọc được tin đơn hàng qua MSS. Các phần khác của màn này không bị ảnh hưởng.
        </p>
      )}
    </section>
  );
}

function CardBody({ card }: { card: Card }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const cancel = useMutation({
    mutationFn: cancelPendingMssOrderEvents,
    onSuccess: (r) => {
      setMsg({ tone: 'success', text: `Đã dừng ${r.cancelled} tin chờ gửi. Tin nào có ZNS thay thế đã chuyển sang ZNS.` });
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e) => setMsg({ tone: 'danger', text: actionErrorText(e) }),
  });
  const askCancel = async () => {
    const ok = await confirm({
      title: 'Dừng tin chờ gửi qua MSS?',
      message: `${card.waiting} tin chưa gửi sẽ không đi qua MSS nữa; tin nào có ZNS thay thế thì gửi ZNS. Tin MSS đã nhận không rút lại được.`,
      confirmLabel: 'Dừng tin chờ',
      tone: 'danger',
    });
    if (ok) cancel.mutate();
  };
  const rows = card.recent.slice(0, SHOWN_ROWS);

  return (
    <div className="mt-2 space-y-3 text-sm">
      <p className="max-w-2xl text-stone-600">
        {!card.enabled
          ? 'Cờ mss.order_events_enabled đang tắt: tin đơn gửi ZNS như cũ, không gì đi qua MSS.'
          : !card.open
            ? 'Cờ đã bật nhưng MSS chưa công bố năng lực order_events hoặc thiếu biến môi trường: chưa ghi tin nào.'
            : `Đơn của khách đã đồng ý được gửi qua MSS (tỉ lệ ${card.rolloutPct}%). MSS không gửi được thì Tubu lui về ZNS, không bao giờ gửi cả hai.`}
      </p>

      <dl aria-label="Số tin đơn qua MSS" className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(
          [
            ['Chờ gửi', card.waiting],
            ['MSS đang xử lý', card.awaitingResult],
            ['Tới Zalo (24 giờ)', card.sent24h],
            ['Hỏng (24 giờ)', card.failed24h],
            ['Lui về ZNS (24 giờ)', card.fallbackZns24h],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="rounded-control border border-stone-200 px-3 py-2">
            <dt className="text-xs text-stone-600">{label}</dt>
            <dd className="m-0 font-semibold tabular-nums text-stone-900">{n}</dd>
          </div>
        ))}
      </dl>

      {rows.length > 0 && (
        <ul aria-label="Tin đơn gần nhất" className="m-0 list-none divide-y divide-stone-200 rounded-control border border-stone-200 p-0">
          {rows.map((r) => (
            <EventRow key={r.eventId} row={r} />
          ))}
        </ul>
      )}

      {card.waiting > 0 && (
        <button type="button" className={BTN_DANGER_OUTLINE} disabled={cancel.isPending} onClick={() => void askCancel()}>
          {cancel.isPending ? 'Đang dừng…' : 'Dừng tin chờ gửi'}
        </button>
      )}
      {msg && (
        <Notice tone={msg.tone} role={msg.tone === 'danger' ? 'alert' : 'status'}>
          {msg.text}
        </Notice>
      )}
      {dialog}
    </div>
  );
}

function EventRow({ row }: { row: MssOrderEventRow }) {
  const badge = STATUS_BADGE[row.status] ?? { tone: 'neutral' as Tone, label: row.status };
  return (
    <li className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0">
        <div className="break-all font-medium text-stone-800">
          {row.orderCode} <span className="font-normal text-stone-600">· {EVENT_LABEL[row.eventType] ?? row.eventType}</span>
          {row.recipientRole === 'recipient' && (
            <>
              {' '}
              <ToneBadge tone="neutral">Người nhận</ToneBadge>
            </>
          )}
        </div>
        <div className="text-xs text-stone-500">
          <span className="tabular-nums">{formatDateTime(row.updatedAt)}</span>
          {row.phone && <span className="tabular-nums"> · {row.phone}</span>}
          {row.attempts > 1 && <span className="tabular-nums"> · {row.attempts} lần gửi</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <ToneBadge tone={badge.tone}>{badge.label}</ToneBadge>
        {row.fallbackChannel === 'ZNS' && <ToneBadge tone="info">Đã gửi ZNS</ToneBadge>}
        {row.reason && (
          <span className="break-all text-xs text-stone-600" title={row.reason}>
            {MSS_REASON_LABEL[row.reason] ?? row.reason}
          </span>
        )}
      </div>
    </li>
  );
}
