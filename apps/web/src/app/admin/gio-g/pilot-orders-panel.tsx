'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { actionErrorText, loadErrorText } from '@/lib/admin-error-text';
import { formatDateTime } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { orderStatusLabel, paymentMethodLabel, paymentStatusLabel } from '@/lib/order-view';
import { useConfirm } from '@/components/admin/confirm-dialog';
import { ADMIN_TABULAR } from '@/components/admin/tabular-nums';
import { BTN_DANGER_OUTLINE, BTN_PRIMARY, BTN_SECONDARY, Field, INPUT_CLASS, ListSkeleton, LoadError, Notice, ToneBadge } from '@/components/admin/ui';
import { cleanupPilotOrders, listPilotOrders, splitPhones, type PilotAction, type PilotCleanupResult, type PilotOrderRow } from './golive-api';

const PILOT_KEY = ['admin', 'golive', 'pilot-orders'] as const;
/** Trần mã mỗi lượt dọn, trùng PILOT_CLEANUP_MAX ở apps/api/src/modules/admin/golive/golive-pilot.ts (gửi quá thì API trả 400). */
const PILOT_CLEANUP_BATCH = 50;

const ACTION_LABEL: Record<PilotAction, string> = { CANCEL: 'Sẽ huỷ', ARCHIVE: 'Ghi sổ', MANUAL: 'Làm tay', DONE: 'Đã dọn' };
const ACTION_TONE = { CANCEL: 'danger', ARCHIVE: 'info', MANUAL: 'warning', DONE: 'neutral' } as const satisfies Record<PilotAction, 'danger' | 'info' | 'warning' | 'neutral'>;
const MATCH_LABEL = { NOTE_MARKER: 'Ghi chú [PILOT]', TEST_PHONE: 'SĐT người thử' } as const;

/**
 * Bàn dọn đơn thử sau buổi thử Giờ G. Chỉ đơn có `[PILOT]` trong ghi chú hoặc đúng SĐT người thử mới hiện. "Xem trước" không ghi gì;
 * "Dọn thật" gửi đúng danh sách mã vừa xem trước kèm câu xác nhận, máy chủ kiểm lại từng mã.
 */
export function PilotOrdersPanel() {
  const qc = useQueryClient();
  const { ask, dialog } = useConfirm();
  const [phonesInput, setPhonesInput] = useState('');
  const [phones, setPhones] = useState<string[]>([]);
  const [preview, setPreview] = useState<PilotCleanupResult | null>(null);
  const [done, setDone] = useState<PilotCleanupResult | null>(null);

  const q = useQuery({ queryKey: [...PILOT_KEY, phones], queryFn: () => listPilotOrders(phones) });
  const dry = useMutation({
    mutationFn: (codes: string[]) => cleanupPilotOrders({ dryRun: true, codes, phones }),
    onSuccess: (r) => {
      setPreview(r);
      setDone(null);
    },
  });
  const run = useMutation({
    mutationFn: (v: { codes: string[]; confirmText: string }) => cleanupPilotOrders({ dryRun: false, codes: v.codes, phones, confirmText: v.confirmText }),
    onSuccess: (r) => {
      setDone(r);
      setPreview(null);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PILOT_KEY }),
  });

  const search = (e: FormEvent) => {
    e.preventDefault();
    setPhones(splitPhones(phonesInput));
    setPreview(null);
    setDone(null);
    dry.reset();
    run.reset();
  };

  const rows = q.data?.orders ?? [];
  const allActionable = rows.filter((r) => r.action === 'CANCEL' || r.action === 'ARCHIVE').map((r) => r.code);
  const actionable = allActionable.slice(0, PILOT_CLEANUP_BATCH);
  const leftover = allActionable.length - actionable.length;
  const confirmText = q.data?.confirmText ?? '';
  const busy = dry.isPending || run.isPending;

  const confirmRun = async () => {
    if (!preview || busy) return;
    const codes = [...preview.cancelled, ...preview.archived];
    const typed = await ask({
      title: 'Dọn đơn thử',
      message: `Huỷ ${preview.affected.ordersCancelled} đơn (trả tồn, đảo điểm, huỷ bên Pancake/Gomdon) và ghi sổ ${preview.affected.ordersArchived} đơn đã xong. Không hoàn tác được.\nMã: ${codes.join(', ')}`,
      tone: 'danger',
      confirmLabel: 'Dọn đơn thử',
      input: {
        label: `Gõ ${confirmText} để xác nhận`,
        placeholder: confirmText,
        maxLength: 40,
        required: true,
        validate: (t) => (t.trim() === confirmText ? null : `Gõ đúng ${confirmText} (chữ hoa, không dấu).`),
      },
    });
    if (typed === null) return;
    run.mutate({ codes, confirmText: typed });
  };

  return (
    <section aria-labelledby="gio-g-pilot" className={ADMIN_TABULAR}>
      {dialog}
      <h2 id="gio-g-pilot" className="font-display text-base font-semibold">
        Dọn đơn thử
      </h2>
      <p className="mt-1 text-xs text-stone-600">
        Chỉ hiện đơn có [PILOT] trong ghi chú, hoặc người mua đúng SĐT người thử bạn gõ, đặt trong {q.data?.windowDays ?? 45} ngày gần đây (đơn CTV đặt hộ khách
        không khớp theo SĐT). Chỉ đơn có [PILOT] mới được dọn tự động; đơn chỉ khớp SĐT, đơn đã có tiền hoặc đã rời kho phải làm tay theo kịch bản.
      </p>
      <form onSubmit={search} className="mt-2 flex flex-wrap items-end gap-2">
        <Field label="SĐT người thử (tối đa 5, cách nhau bằng dấu phẩy)" className="min-w-0 flex-1">
          <input
            className={INPUT_CLASS}
            inputMode="tel"
            value={phonesInput}
            onChange={(e) => setPhonesInput(e.target.value)}
            placeholder="0901234567, 0912345678"
            maxLength={120}
          />
        </Field>
        <button type="submit" className={BTN_SECONDARY} disabled={q.isFetching}>
          Tìm đơn thử
        </button>
      </form>

      <div className="mt-3">
        {q.isPending ? (
          <ListSkeleton label="Đang tìm đơn thử" rows={3} className="h-14" />
        ) : q.isError ? (
          <LoadError message={loadErrorText(q.error)} onRetry={() => q.refetch()} retrying={q.isFetching} />
        ) : (
          <>
            <p className="text-xs text-stone-700" data-testid="pilot-counts">
              {rows.length} đơn thử: {q.data.counts.CANCEL} sẽ huỷ · {q.data.counts.ARCHIVE} ghi sổ · {q.data.counts.MANUAL} làm tay · {q.data.counts.DONE} đã dọn
              {q.data.truncated ? ' (danh sách bị cắt, dọn xong lượt này rồi tìm lại)' : ''}
            </p>
            {rows.length === 0 ? (
              <p className="mt-2 text-sm text-stone-600">Không có đơn thử nào.</p>
            ) : (
              <ul className="mt-2 divide-y divide-stone-200 rounded-card border border-stone-200 bg-stone-0">
                {rows.map((r) => (
                  <PilotRow key={r.code} row={r} />
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={BTN_PRIMARY} disabled={busy || actionable.length === 0} onClick={() => dry.mutate(actionable)}>
                {dry.isPending ? 'Đang xem trước…' : `Xem trước dọn ${actionable.length} đơn`}
              </button>
              {leftover > 0 ? <p className="w-full text-xs text-stone-600">Mỗi lượt tối đa {PILOT_CLEANUP_BATCH} đơn: còn {leftover} đơn cho lượt sau.</p> : null}
              {rows.some((r) => r.action === 'MANUAL') ? (
                <Link href="/admin?tab=orders" className={`${BTN_SECONDARY} inline-flex items-center`}>
                  Mở Đơn hàng để làm tay
                </Link>
              ) : null}
            </div>
          </>
        )}
      </div>

      {dry.isError ? (
        <div className="mt-2">
          <Notice tone="danger" role="alert">
            {actionErrorText(dry.error)}
          </Notice>
        </div>
      ) : null}

      {preview ? (
        <div className="mt-3 rounded-card border border-danger-fg bg-stone-0 p-3" data-testid="pilot-preview">
          <p className="text-sm font-semibold text-stone-900">Xem trước (chưa ghi gì)</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-stone-700">
            <li>
              Huỷ {preview.affected.ordersCancelled} đơn, thêm {preview.affected.statusHistoryRows} dòng lịch sử đơn
            </li>
            <li>Ghi sổ {preview.affected.ordersArchived} đơn đã xong (không đổi đơn)</li>
            <li>Bỏ qua {preview.skipped.length} đơn phải làm tay</li>
            <li>Ghi {preview.affected.auditLogRows} dòng sổ thao tác quản trị</li>
          </ul>
          {preview.cancelled.length + preview.archived.length > 0 ? (
            <p className="mt-1 break-words font-mono text-xs text-stone-600">{[...preview.cancelled, ...preview.archived].join(', ')}</p>
          ) : null}
          <button
            type="button"
            className={`${BTN_DANGER_OUTLINE} mt-2`}
            disabled={busy || preview.cancelled.length + preview.archived.length === 0}
            onClick={() => void confirmRun()}
          >
            {run.isPending ? 'Đang dọn…' : 'Dọn thật…'}
          </button>
        </div>
      ) : null}

      {run.isError ? (
        <div className="mt-2">
          <Notice tone="danger" role="alert">
            Chưa dọn: {actionErrorText(run.error)}
          </Notice>
        </div>
      ) : null}

      {done ? (
        <div className="mt-3" data-testid="pilot-done">
          <Notice tone={done.failed.length > 0 || done.auditLogId === null ? 'warning' : 'success'} role="status">
            Đã huỷ {done.cancelled.length} đơn, ghi sổ {done.archived.length} đơn, bỏ qua {done.skipped.length}, lỗi {done.failed.length}.{' '}
            {done.auditLogId
              ? `Đã ghi sổ thao tác quản trị (mã ${done.auditLogId}).`
              : `${done.auditError ?? 'Chưa ghi được sổ thao tác quản trị.'} Chụp lại kết quả này làm bằng chứng.`}
            {[...done.failed.map((f) => ({ code: f.code, text: f.message })), ...done.skipped.map((s) => ({ code: s.code, text: s.reason }))].map((x) => (
              <span key={x.code} className="block">
                {x.code}: {x.text}
              </span>
            ))}
          </Notice>
        </div>
      ) : null}
    </section>
  );
}

function PilotRow({ row }: { row: PilotOrderRow }) {
  return (
    <li data-testid="pilot-row" data-code={row.code} className="px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono font-semibold text-stone-900">{row.code}</span>
        <ToneBadge tone={ACTION_TONE[row.action]}>{ACTION_LABEL[row.action]}</ToneBadge>
        <span className="text-stone-700">{orderStatusLabel(row.status)}</span>
        <span className="ml-auto font-medium text-stone-900">{formatVnd(row.total)}</span>
      </div>
      <p className="mt-0.5 break-words text-stone-600">
        {formatDateTime(row.createdAt)} · {paymentMethodLabel(row.paymentMethod)}, {paymentStatusLabel(row.paymentStatus)}
        {row.phone ? ` · ${row.phone}` : ''} · {row.matchedBy.map((m) => MATCH_LABEL[m]).join(', ')}
      </p>
      <p className="mt-0.5 break-words text-stone-700">{row.reason}</p>
    </li>
  );
}
