'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { actionErrorText } from '@/lib/admin-error-text';
import {
  BULK_RUN_CHUNK,
  BULK_RUN_TIMEOUT_MS,
  BULK_STATUS_MAX,
  bulkOrderStatus,
  type BulkStatusResponse,
  type BulkStatusResult,
  type BulkStatusTarget,
} from '@/lib/admin-bulk-ops-client';
import { ORDER_STATUS_LABELS } from '@/lib/export-csv';
import { safeAreaPadX } from '@/lib/safe-area';
import { ADMIN_TABULAR } from './tabular-nums';
import { INPUT_CLASS, Notice } from './ui';

export interface BulkPick {
  id: string;
  code: string;
}

const TARGET_LABEL: Record<BulkStatusTarget, string> = { PACKED: 'Đã đóng gói', CANCELLED: 'Đã huỷ' };
const HIT = 'min-h-[44px] min-w-[44px]';
const BAR_BTN = `${HIT} rounded-control border border-stone-450 bg-stone-0 px-3 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50`;

/**
 * Đơn đang chọn để đổi hàng loạt, giữ thứ tự bấm, tối đa `BULK_STATUS_MAX`. `resetKey` là bộ lọc và trang đang xem: đổi bộ lọc hay
 * sang trang khác thì bỏ chọn hết, để thanh dưới không đổi đơn người dùng không còn nhìn thấy.
 */
export function useOrderBulkSelection(resetKey: string) {
  const [picked, setPicked] = useState<ReadonlyMap<string, BulkPick>>(() => new Map());
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) {
    setKey(resetKey);
    setPicked(new Map());
  }
  const toggle = useCallback((o: BulkPick) => {
    setPicked((cur) => {
      const next = new Map(cur);
      if (next.has(o.id)) next.delete(o.id);
      else if (next.size < BULK_STATUS_MAX) next.set(o.id, o);
      return next;
    });
  }, []);
  const addMany = useCallback((list: readonly BulkPick[]) => {
    setPicked((cur) => {
      const next = new Map(cur);
      for (const o of list) if (next.size < BULK_STATUS_MAX) next.set(o.id, o);
      return next;
    });
  }, []);
  const clear = useCallback(() => setPicked(new Map()), []);
  return { picked, size: picked.size, full: picked.size >= BULK_STATUS_MAX, has: (id: string) => picked.has(id), toggle, addMany, clear };
}
export type OrderBulkSelection = ReturnType<typeof useOrderBulkSelection>;

const stop = (e: MouseEvent) => e.stopPropagation();

/** Đơn đã ở trạng thái đích (từ trước, hoặc người khác vừa đổi trước) là bỏ qua, không gộp vào số đơn lỗi. */
const skippedText = (r: Pick<BulkStatusResponse, 'skippedCount'>, target: BulkStatusTarget) =>
  r.skippedCount ? `, ${r.skippedCount} đơn đã ở «${TARGET_LABEL[target]}» (bỏ qua)` : '';

/** Ô chọn một đơn, vùng bấm 44×44. Không lan sự kiện bấm lên dòng/thẻ (bấm dòng là mở chi tiết đơn). */
export function OrderSelectBox({ order, selection }: { order: BulkPick; selection: OrderBulkSelection }) {
  const checked = selection.has(order.id);
  return (
    <label onClick={stop} className={`${HIT} inline-flex shrink-0 cursor-pointer items-center justify-center`} data-bulk-select={order.code}>
      <input
        type="checkbox"
        checked={checked}
        disabled={!checked && selection.full}
        onChange={() => selection.toggle(order)}
        onClick={stop}
        aria-label={`Chọn đơn ${order.code}`}
        className="h-5 w-5 accent-forest-600"
      />
    </label>
  );
}

/**
 * Thanh dưới cùng khi đã chọn ít nhất một đơn: đổi trạng thái hàng loạt theo đúng luật của từng đơn. Luôn xem trước (dryRun) rồi mới đổi;
 * đơn bị giữ lại hiện lý do và không chặn đơn hợp lệ. `targets` là các trạng thái người đang đăng nhập được phép đặt (KHO: đóng gói, CSKH: huỷ).
 */
export function OrderBulkBar({ selection, targets, pageOrders }: { selection: OrderBulkSelection; targets: readonly BulkStatusTarget[]; pageOrders: readonly BulkPick[] }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<BulkStatusTarget>(targets[0] ?? 'PACKED');
  const [preview, setPreview] = useState<{ target: BulkStatusTarget; res: BulkStatusResponse } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unpickedOnPage = pageOrders.filter((o) => !selection.has(o.id)).length;
  const active = targets.includes(target) ? target : targets[0];

  if (selection.size === 0 || !active) return null;

  const openPreview = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await bulkOrderStatus({ orderIds: [...selection.picked.keys()], targetStatus: active, dryRun: true });
      setPreview({ target: active, res });
    } catch (e) {
      setError(actionErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        role="region"
        aria-label="Thao tác với đơn đã chọn"
        data-bulk-bar
        className={`sticky bottom-0 z-30 -mx-1 flex flex-wrap items-center gap-2 rounded-card border border-stone-200 bg-stone-0 px-3 py-2 shadow-raised ${ADMIN_TABULAR}`}
      >
        <span className="text-sm font-semibold text-stone-900" aria-live="polite">
          Đã chọn {selection.size}/{BULK_STATUS_MAX} đơn
        </span>
        {unpickedOnPage > 0 && !selection.full && (
          <button type="button" onClick={() => selection.addMany(pageOrders)} className={BAR_BTN}>
            Chọn cả trang
          </button>
        )}
        <button type="button" onClick={selection.clear} className={BAR_BTN}>
          Bỏ chọn
        </button>
        <div className="ml-auto flex items-center gap-2">
          {targets.length > 1 ? (
            <label className="text-xs text-stone-600">
              <span className="sr-only">Đổi sang trạng thái</span>
              <select value={active} onChange={(e) => setTarget(e.target.value as BulkStatusTarget)} className={`${INPUT_CLASS} ${HIT} text-sm`}>
                {targets.map((t) => (
                  <option key={t} value={t}>
                    Sang «{TARGET_LABEL[t]}»
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            onClick={() => void openPreview()}
            disabled={busy}
            className={`${HIT} rounded-control bg-forest-600 px-4 text-sm font-medium text-stone-0 hover:bg-forest-700 disabled:bg-stone-200 disabled:text-stone-500`}
          >
            {busy ? 'Đang kiểm…' : targets.length > 1 ? 'Xem trước' : `Xem trước: sang «${TARGET_LABEL[active]}»`}
          </button>
        </div>
        {selection.full && <p className="w-full text-xs text-warning-fg">Mỗi lượt tối đa {BULK_STATUS_MAX} đơn. Đổi xong lượt này rồi chọn tiếp.</p>}
        {error && (
          <div className="w-full">
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          </div>
        )}
      </div>
      {preview && (
        <BulkPreviewDialog
          target={preview.target}
          preview={preview.res}
          onClose={(changed) => {
            setPreview(null);
            if (changed) {
              selection.clear();
              void qc.invalidateQueries({ queryKey: ['admin-orders'] });
            }
          }}
        />
      )}
    </>
  );
}

function BulkPreviewDialog({ target, preview, onClose }: { target: BulkStatusTarget; preview: BulkStatusResponse; onClose: (changed: boolean) => void }) {
  const titleId = useId();
  const noteId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState('');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<BulkStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(0);
  // Lượt đổi lỗi giữa chừng (mạng, hết hạn chờ): máy chủ có thể đã đổi một phần, nên đóng hộp vẫn tải lại danh sách.
  const [stale, setStale] = useState(false);
  const cancel = target === 'CANCELLED';
  const okIds = useMemo(() => preview.results.filter((r) => r.ok).map((r) => r.id), [preview]);
  const shown = done ?? preview;
  const close = useCallback(() => {
    if (!running) onClose(stale || (done !== null && done.okCount > 0));
  }, [running, done, stale, onClose]);
  // Bàn phím đọc `close` mới nhất qua ref: effect chỉ chạy một lần khi mở hộp, không trả focus ra ngoài mỗi lần `running` đổi.
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    boxRef.current?.querySelector<HTMLElement>('[data-bulk-close]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'Tab' && boxRef.current) {
        const items = [...boxRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), textarea, [tabindex="0"]')];
        if (items.length === 0) return;
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === items.length - 1 ? 0 : at + 1;
        e.preventDefault();
        items[next]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);

  const run = async () => {
    setError(null);
    setRunning(true);
    const trimmed = note.trim();
    const results: BulkStatusResult[] = [];
    const auditErrors: string[] = [];
    try {
      for (let i = 0; i < okIds.length; i += BULK_RUN_CHUNK) {
        setSent(i);
        const res = await bulkOrderStatus(
          { orderIds: okIds.slice(i, i + BULK_RUN_CHUNK), targetStatus: target, dryRun: false, ...(trimmed ? { note: trimmed } : {}) },
          { timeoutMs: BULK_RUN_TIMEOUT_MS },
        );
        results.push(...res.results);
        if (res.auditError) auditErrors.push(res.auditError);
      }
    } catch (e) {
      setStale(true);
      setError(`${actionErrorText(e)} Đơn chưa có kết quả ở đây có thể đã đổi hoặc chưa: đóng hộp để tải lại danh sách rồi kiểm lại.`);
    } finally {
      // Đơn lượt thật báo bỏ qua là đơn người khác vừa đổi trước: danh sách đang xem đã cũ, đóng hộp thì tải lại như khi có đơn đã đổi.
      if (results.some((r) => r.outcome === 'SKIPPED')) setStale(true);
      if (results.length > 0) {
        // Đơn bị giữ lại từ lúc xem trước vẫn nằm trong kết quả cuối để người bấm thấy đủ cả lượt.
        const all = [...results, ...preview.results.filter((r) => !r.ok)];
        const okCount = all.filter((r) => r.ok).length;
        const skippedCount = all.filter((r) => r.outcome === 'SKIPPED').length;
        setDone({
          dryRun: false,
          targetStatus: target,
          total: all.length,
          okCount,
          skippedCount,
          failedCount: all.length - okCount - skippedCount,
          results: all,
          auditLogId: null,
          auditError: auditErrors.length ? auditErrors.join(' ') : null,
        });
      }
      setRunning(false);
    }
  };

  return createPortal(
    <div data-bulk-backdrop onClick={close} className="fixed inset-0 z-[100] flex items-end justify-center bg-stone-900/40 p-4 sm:items-center" style={safeAreaPadX('1rem')}>
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={stop}
        data-bulk-dialog
        className={`flex max-h-[90vh] w-full max-w-lg flex-col rounded-sheet bg-stone-0 p-5 shadow-raised ${ADMIN_TABULAR}`}
      >
        <h2 id={titleId} className="font-display text-base font-semibold text-stone-900">
          {done ? 'Kết quả đổi trạng thái' : `Đổi sang «${TARGET_LABEL[target]}»`}
        </h2>
        <p className="mt-1 text-sm text-stone-700" data-bulk-summary>
          {done
            ? `Đã đổi ${done.okCount} đơn${skippedText(done, target)}${done.failedCount ? `, ${done.failedCount} đơn không đổi được` : ''}.`
            : `${preview.okCount} đơn đổi được${skippedText(preview, target)}${preview.failedCount ? `, ${preview.failedCount} đơn bị giữ lại (không đổi)` : ''}.`}
        </p>
        {done?.auditError && (
          <div className="mt-2">
            <Notice tone="warning" role="alert">
              {done.auditError}
            </Notice>
          </div>
        )}
        <ul className="mt-3 min-h-0 flex-1 divide-y divide-stone-100 overflow-y-auto rounded-control border border-stone-200" tabIndex={0} aria-label="Từng đơn" data-bulk-results>
          {shown.results.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-2 px-3 py-2 text-sm" data-ok={r.ok ? 'true' : 'false'} data-outcome={r.outcome}>
              <span className="font-semibold text-stone-900">{r.code ?? r.id}</span>
              <span className="text-xs text-stone-500">{r.from ? (ORDER_STATUS_LABELS[r.from] ?? r.from) : ''}</span>
              <span className={`w-full text-xs ${r.ok ? 'text-success-fg' : r.outcome === 'SKIPPED' ? 'text-stone-600' : 'text-danger-fg'}`}>
                {r.ok ? (done ? `Đã sang «${TARGET_LABEL[target]}»` : `Sẽ sang «${TARGET_LABEL[target]}»`) : r.reason}
              </span>
            </li>
          ))}
        </ul>
        {!done && cancel && okIds.length > 0 && (
          <div className="mt-3">
            <label htmlFor={noteId} className="mb-1 block text-xs font-medium text-stone-700">
              Lý do huỷ (khách thấy trong đơn, không bắt buộc)
            </label>
            <textarea id={noteId} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={`${INPUT_CLASS} w-full`} />
          </div>
        )}
        {error && (
          <div className="mt-2">
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          </div>
        )}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            data-bulk-close
            onClick={close}
            disabled={running}
            className={`${HIT} rounded-control border border-stone-450 bg-stone-0 px-4 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50`}
          >
            {done ? 'Xong' : 'Đóng'}
          </button>
          {!done && (
            <button
              type="button"
              data-bulk-confirm
              onClick={() => void run()}
              disabled={running || okIds.length === 0}
              className={`${HIT} rounded-control px-4 text-sm font-medium text-stone-0 disabled:cursor-not-allowed disabled:opacity-50 ${
                cancel ? 'bg-danger-fg hover:brightness-90' : 'bg-forest-600 hover:bg-forest-700'
              }`}
            >
              {running ? `Đang đổi ${Math.min(sent + BULK_RUN_CHUNK, okIds.length)}/${okIds.length}…` : `${cancel ? 'Huỷ' : 'Đóng gói'} ${okIds.length} đơn`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
