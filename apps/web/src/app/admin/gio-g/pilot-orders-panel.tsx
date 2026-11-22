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
  const [preview, setPreview] = useState<{ res: PilotCleanupResult; optIn: readonly string[] } | null>(null);
  const [done, setDone] = useState<PilotCleanupResult | null>(null);
  // Đơn chỉ khớp SĐT người thử mà quản trị viên tự tick để dọn; không tick thì vẫn là Làm tay.
  const [optIn, setOptIn] = useState<ReadonlySet<string>>(() => new Set());

  const q = useQuery({ queryKey: [...PILOT_KEY, phones], queryFn: () => listPilotOrders(phones) });
  const dry = useMutation({
    mutationFn: (v: { codes: string[]; optInCodes: string[] }) =>
      cleanupPilotOrders({ dryRun: true, codes: v.codes, phones, ...(v.optInCodes.length > 0 ? { optInCodes: v.optInCodes } : {}) }),
    onSuccess: (r, v) => {
      setPreview({ res: r, optIn: v.optInCodes });
      setDone(null);
    },
  });
  const run = useMutation({
    mutationFn: (v: { codes: string[]; optInCodes: string[]; confirmText: string }) =>
      cleanupPilotOrders({ dryRun: false, codes: v.codes, phones, ...(v.optInCodes.length > 0 ? { optInCodes: v.optInCodes } : {}), confirmText: v.confirmText }),
    onSuccess: (r) => {
      setDone(r);
      setPreview(null);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PILOT_KEY }),
  });

  const search = (e: FormEvent) => {
    e.preventDefault();
    setPhones(splitPhones(phonesInput));
    setOptIn(new Set());
    setPreview(null);
    setDone(null);
    dry.reset();
    run.reset();
  };

  const rows = q.data?.orders ?? [];
  const optInPicked = rows.filter((r) => r.optInEligible && optIn.has(r.code)).map((r) => r.code);
  const allActionable = [...rows.filter((r) => r.action === 'CANCEL' || r.action === 'ARCHIVE').map((r) => r.code), ...optInPicked];
  const actionable = allActionable.slice(0, PILOT_CLEANUP_BATCH);
  const actionableOptIn = optInPicked.filter((c) => actionable.includes(c));
  const leftover = allActionable.length - actionable.length;
  const toggleOptIn = (code: string) => {
    setOptIn((cur) => {
      const next = new Set(cur);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
    setPreview(null);
    dry.reset();
  };
  const confirmText = q.data?.confirmText ?? '';
  const busy = dry.isPending || run.isPending;

  const confirmRun = async () => {
    if (!preview || busy) return;
    const codes = [...preview.res.cancelled, ...preview.res.archived];
    const optInCodes = preview.optIn.filter((c) => codes.includes(c));
    const typed = await ask({
      title: 'Dọn đơn thử',
      message: `Huỷ ${preview.res.affected.ordersCancelled} đơn (trả tồn, đảo điểm, huỷ bên Pancake/Gomdon) và ghi sổ ${preview.res.affected.ordersArchived} đơn đã xong. Không hoàn tác được.${
        optInCodes.length > 0 ? `\nTrong đó ${optInCodes.length} đơn chỉ khớp SĐT người thử do bạn tick: ${optInCodes.join(', ')}` : ''
      }\nMã: ${codes.join(', ')}`,
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
    run.mutate({ codes, optInCodes, confirmText: typed });
  };

  return (
    <section aria-labelledby="gio-g-pilot" className={ADMIN_TABULAR}>
      {dialog}
      <h2 id="gio-g-pilot" className="font-display text-base font-semibold">
        Dọn đơn thử
      </h2>
      <p className="mt-1 text-xs text-stone-600">
        Chỉ hiện đơn có [PILOT] trong ghi chú, hoặc người mua đúng SĐT người thử bạn gõ, đặt trong {q.data?.windowDays ?? 45} ngày gần đây (đơn CTV đặt hộ khách
        không khớp theo SĐT). Chỉ đơn có [PILOT] mới được dọn tự động. Đơn chỉ khớp SĐT bán lẻ, chưa trả tiền, chưa rời kho thì tick ô &quot;Chọn dọn&quot; từng đơn
        nếu chắc là đơn thử; đơn đã có tiền, đã rời kho, đơn đại lý hoặc CTV đặt hộ phải làm tay theo kịch bản.
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
                  <PilotRow key={r.code} row={r} optedIn={optIn.has(r.code)} onToggle={busy ? undefined : () => toggleOptIn(r.code)} />
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={BTN_PRIMARY}
                disabled={busy || actionable.length === 0}
                onClick={() => dry.mutate({ codes: actionable, optInCodes: actionableOptIn })}
              >
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
              Huỷ {preview.res.affected.ordersCancelled} đơn, thêm {preview.res.affected.statusHistoryRows} dòng lịch sử đơn
            </li>
            {preview.optIn.length > 0 ? (
              <li data-testid="pilot-preview-optin">
                Trong đó {preview.optIn.filter((c) => preview.res.cancelled.includes(c)).length}/{preview.optIn.length} đơn chỉ khớp SĐT do bạn tick
              </li>
            ) : null}
            <li>Ghi sổ {preview.res.affected.ordersArchived} đơn đã xong (không đổi đơn)</li>
            <li>Bỏ qua {preview.res.skipped.length} đơn phải làm tay</li>
            <li>Ghi {preview.res.affected.auditLogRows} dòng sổ thao tác quản trị</li>
          </ul>
          {preview.res.cancelled.length + preview.res.archived.length > 0 ? (
            <p className="mt-1 break-words font-mono text-xs text-stone-600">{[...preview.res.cancelled, ...preview.res.archived].join(', ')}</p>
          ) : null}
          <button
            type="button"
            className={`${BTN_DANGER_OUTLINE} mt-2`}
            disabled={busy || preview.res.cancelled.length + preview.res.archived.length === 0}
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

function PilotRow({ row, optedIn, onToggle }: { row: PilotOrderRow; optedIn: boolean; onToggle?: () => void }) {
  return (
    <li data-testid="pilot-row" data-code={row.code} className="px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono font-semibold text-stone-900">{row.code}</span>
        <ToneBadge tone={optedIn ? 'danger' : ACTION_TONE[row.action]}>{optedIn ? ACTION_LABEL.CANCEL : ACTION_LABEL[row.action]}</ToneBadge>
        <span className="text-stone-700">{orderStatusLabel(row.status)}</span>
        <span className="ml-auto font-medium text-stone-900">{formatVnd(row.total)}</span>
      </div>
      <p className="mt-0.5 break-words text-stone-600">
        {formatDateTime(row.createdAt)} · {paymentMethodLabel(row.paymentMethod)}, {paymentStatusLabel(row.paymentStatus)}
        {row.phone ? ` · ${row.phone}` : ''} · {row.matchedBy.map((m) => MATCH_LABEL[m]).join(', ')}
      </p>
      <p className="mt-0.5 break-words text-stone-700">{row.reason}</p>
      {row.optInEligible ? (
        <label className="mt-1 inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-stone-800" data-testid="pilot-optin">
          <input type="checkbox" className="h-5 w-5 accent-forest-600" checked={optedIn} disabled={!onToggle} onChange={() => onToggle?.()} />
          <span>Chọn dọn đơn này (chắc chắn là đơn thử)</span>
        </label>
      ) : null}
    </li>
  );
}
