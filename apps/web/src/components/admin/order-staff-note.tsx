'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { saveOrderStaffNote, type AdminOrder } from '@/lib/admin-client';
import { actionErrorText } from '@/lib/admin-error-text';
import { formatDateTime } from '@/lib/format-date';
import { settleWithin } from '@/lib/settle-within';
import { reloadWhenStale } from '@/lib/stale-write-rejection';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { BTN_LINK, BTN_XS_PRIMARY, BTN_XS_SECONDARY, INPUT_CLASS } from './ui';

/** Trùng ORDER_STAFF_NOTE_MAX của API (DTO kiểm cùng số). */
export const STAFF_NOTE_MAX = 500;
/** Trùng STAFF_NOTE_OPEN_STATUSES của API: đơn đã giao, huỷ, trả thì không sửa ghi chú cho kho nữa. */
const OPEN_STATUSES = new Set(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING']);
const BUSY_CLASS = 'aria-disabled:opacity-60';

/**
 * Ghi chú nội bộ CSKH/Admin cho kho trên chi tiết đơn. Mọi người xem đơn đều đọc được (kho đọc lúc soạn); chỉ ADMIN và CSKH sửa, khi đơn còn mở.
 * Không phải "Ghi chú từ khách" và không tới khách. Lưu kèm mốc bản đang thấy: đồng nghiệp lưu chen giữa thì máy chủ trả 409 và khối tải lại.
 */
export function OrderStaffNotePanel({ order, canEdit }: { order: AdminOrder; canEdit: boolean }) {
  const qc = useQueryClient();
  const current = order.staffNote ?? null;
  const editable = canEdit && OPEN_STATUSES.has(order.status);
  const [draft, setDraft] = useState<string | null>(null);
  // Mốc của bản đang thấy LÚC BẤM SỬA: danh sách đơn có thể tải lại giữa chừng (thao tác admin khác làm cũ khoá admin-*) và mang về bản
  // của đồng nghiệp; gửi mốc mới đó thì máy chủ không thấy xung đột và chữ của họ bị ghi đè.
  const [base, setBase] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Khoá giữ tới khi danh sách đơn mới về: nhả sớm thì khối còn mốc cũ và lần lưu kế tiếp bị 409 oan.
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-orders'] });
  const save = useLockedMutation({
    mutationFn: (note: string) => saveOrderStaffNote(order.id || order.code, note, base),
    meta: { skipAdminInvalidate: true },
    onSuccess: (r) => {
      setDraft(null);
      setMsg({ ok: true, text: !r.changed ? 'Ghi chú không đổi.' : r.staffNote ? 'Đã lưu ghi chú cho kho.' : 'Đã xoá ghi chú nội bộ.' });
      return settleWithin(refresh());
    },
    onError: (e) => {
      setMsg({ ok: false, text: actionErrorText(e) });
      return reloadWhenStale(e, refresh, true);
    },
  });

  if (!current && !editable) return null;
  const editing = draft !== null;
  return (
    <section data-staff-note aria-label="Ghi chú nội bộ cho kho" className="rounded-control border border-stone-200 bg-warning-bg px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-stone-800">Ghi chú nội bộ cho kho</span>
        {editable && !editing && (
          <button
            type="button"
            className={BTN_LINK}
            onClick={() => {
              setMsg(null);
              setBase(current?.updatedAt ?? null);
              setDraft(current?.note ?? '');
            }}
          >
            {current ? 'Sửa' : 'Thêm ghi chú'}
          </button>
        )}
      </div>
      {!editing && current && (
        <>
          <p className="mt-1 whitespace-pre-wrap break-words text-stone-800">{current.note}</p>
          <p className="mt-0.5 text-stone-600">
            {current.updatedByName ?? 'Nhân viên'} · {formatDateTime(current.updatedAt)}
          </p>
        </>
      )}
      {!editing && !current && <p className="mt-1 text-stone-600">Chưa có. Khách không thấy ghi chú này.</p>}
      {editing && (
        <form
          className="mt-1 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (save.isPending) return;
            setMsg(null);
            save.mutate(draft.trim());
          }}
        >
          <label className="block">
            <span className="sr-only">Ghi chú nội bộ cho kho</span>
            <textarea
              name="staffNote"
              rows={3}
              maxLength={STAFF_NOTE_MAX}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="VD: gói thêm xốp, gọi khách trước khi giao. Khách không thấy."
              className={INPUT_CLASS}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={`${BTN_XS_PRIMARY} ${BUSY_CLASS}`} aria-busy={save.isPending || undefined} aria-disabled={save.isPending || undefined}>
              {save.isPending ? 'Đang lưu…' : 'Lưu'}
            </button>
            <button type="button" className={BTN_XS_SECONDARY} onClick={() => setDraft(null)} disabled={save.isPending}>
              Huỷ
            </button>
            <span className="ml-auto tabular-nums text-stone-600">
              {draft.length}/{STAFF_NOTE_MAX}
            </span>
          </div>
        </form>
      )}
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`mt-1 ${msg.ok ? 'text-stone-700' : 'text-danger-fg'}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
