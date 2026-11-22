'use client';

import { useCallback, useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { AdminWasteRequestRowDTO } from '@tubutree/shared-types';
import { actionErrorText } from '@/lib/admin-error-text';
import {
  WASTE_BULK_CHUNK,
  WASTE_BULK_MAX,
  WASTE_BULK_TIMEOUT_MS,
  wasteBulkAction,
  type WasteBulkAction,
  type WasteBulkResponse,
  type WasteBulkResult,
} from '@/lib/admin-waste-bulk-client';
import { safeAreaPadX } from '@/lib/safe-area';
import { WASTE_METHOD_LABELS, WASTE_REQUEST_STATUS_LABELS } from '@/lib/waste-labels';
import { ADMIN_TABULAR } from './tabular-nums';
import { INPUT_CLASS, Notice } from './ui';
import { useDialogFocusTrap } from './use-dialog-focus-trap';

export interface WastePick {
  id: string;
  code: string;
}

const ACTION_LABEL: Record<WasteBulkAction, string> = { MARK_RECEIVED: 'Nhận kiện', CLOSE_LOST: 'Đóng vì thất lạc' };
const HIT = 'min-h-[44px] min-w-[44px]';
const BAR_BTN = `${HIT} rounded-control border border-stone-450 bg-stone-0 px-3 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50`;
const REASON_MAX = 500;

/** Chỉ yêu cầu còn chờ nhận (Đang mở/Đang gửi), không phải mang tới điểm nhận, mới có ô chọn: hai thao tác hàng loạt đều chỉ áp cho chúng. */
export const wasteBulkSelectable = (r: Pick<AdminWasteRequestRowDTO, 'status' | 'method'>) =>
  (r.status === 'OPEN' || r.status === 'IN_TRANSIT') && r.method !== 'DROP_OFF';

/**
 * Yêu cầu đang chọn, giữ thứ tự bấm, tối đa `WASTE_BULK_MAX`. `resetKey` là bộ lọc đang xem: đổi bộ lọc thì bỏ chọn hết để thanh dưới không đổi
 * yêu cầu người dùng không còn nhìn thấy.
 */
export function useWasteBulkSelection(resetKey: string) {
  const [picked, setPicked] = useState<ReadonlyMap<string, WastePick>>(() => new Map());
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) {
    setKey(resetKey);
    setPicked(new Map());
  }
  const toggle = useCallback((r: WastePick) => {
    setPicked((cur) => {
      const next = new Map(cur);
      if (next.has(r.id)) next.delete(r.id);
      else if (next.size < WASTE_BULK_MAX) next.set(r.id, r);
      return next;
    });
  }, []);
  const addMany = useCallback((list: readonly WastePick[]) => {
    setPicked((cur) => {
      const next = new Map(cur);
      for (const r of list) if (next.size < WASTE_BULK_MAX) next.set(r.id, r);
      return next;
    });
  }, []);
  const clear = useCallback(() => setPicked(new Map()), []);
  return { picked, size: picked.size, full: picked.size >= WASTE_BULK_MAX, has: (id: string) => picked.has(id), toggle, addMany, clear };
}
export type WasteBulkSelection = ReturnType<typeof useWasteBulkSelection>;

const stop = (e: MouseEvent) => e.stopPropagation();

/** Ô chọn một yêu cầu, vùng bấm 44×44. */
export function WasteSelectBox({ row, selection }: { row: WastePick; selection: WasteBulkSelection }) {
  const checked = selection.has(row.id);
  return (
    <label onClick={stop} className={`${HIT} inline-flex shrink-0 cursor-pointer items-center justify-center`} data-waste-bulk-select={row.code}>
      <input
        type="checkbox"
        checked={checked}
        disabled={!checked && selection.full}
        onChange={() => selection.toggle(row)}
        aria-label={`Chọn yêu cầu ${row.code}`}
        className="h-5 w-5 accent-forest-600"
      />
    </label>
  );
}

const skippedText = (r: Pick<WasteBulkResponse, 'skippedCount'>) => (r.skippedCount ? `, ${r.skippedCount} yêu cầu đã xong từ trước (bỏ qua)` : '');

/**
 * Thanh dưới cùng khi đã chọn ít nhất một yêu cầu: nhận kiện hàng loạt (kho) hoặc đóng thất lạc hàng loạt (chỉ admin, ở hàng Gửi kho quá hạn).
 * Luôn xem trước rồi mới chạy; yêu cầu bị giữ lại hiện lý do và không chặn yêu cầu hợp lệ. Đếm vỏ và cộng điểm vẫn làm từng kiện.
 */
export function WasteBulkBar({ selection, actions, pageRows }: { selection: WasteBulkSelection; actions: readonly WasteBulkAction[]; pageRows: readonly WastePick[] }) {
  const qc = useQueryClient();
  const [action, setAction] = useState<WasteBulkAction>(actions[0] ?? 'MARK_RECEIVED');
  const [preview, setPreview] = useState<{ action: WasteBulkAction; res: WasteBulkResponse } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unpicked = pageRows.filter((r) => !selection.has(r.id)).length;
  const active = actions.includes(action) ? action : actions[0];

  if (selection.size === 0 || !active) return null;

  const openPreview = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await wasteBulkAction({ action: active, requestIds: [...selection.picked.keys()], dryRun: true });
      setPreview({ action: active, res });
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
        aria-label="Thao tác với yêu cầu đã chọn"
        data-waste-bulk-bar
        className={`sticky bottom-0 z-30 -mx-1 flex flex-wrap items-center gap-2 rounded-card border border-stone-200 bg-stone-0 px-3 py-2 shadow-raised ${ADMIN_TABULAR}`}
      >
        <span className="text-sm font-semibold text-stone-900" aria-live="polite">
          Đã chọn {selection.size}/{WASTE_BULK_MAX} yêu cầu
        </span>
        {unpicked > 0 && !selection.full && (
          <button type="button" onClick={() => selection.addMany(pageRows)} className={BAR_BTN}>
            Chọn cả trang
          </button>
        )}
        <button type="button" onClick={selection.clear} className={BAR_BTN}>
          Bỏ chọn
        </button>
        <div className="ml-auto flex items-center gap-2">
          {actions.length > 1 ? (
            <label className="text-xs text-stone-600">
              <span className="sr-only">Thao tác</span>
              <select value={active} onChange={(e) => setAction(e.target.value as WasteBulkAction)} className={`${INPUT_CLASS} ${HIT} text-sm`}>
                {actions.map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABEL[a]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            onClick={() => void openPreview()}
            disabled={busy}
            aria-busy={busy || undefined}
            className={`${HIT} rounded-control bg-forest-600 px-4 text-sm font-medium text-stone-0 hover:bg-forest-700 disabled:bg-stone-200 disabled:text-stone-500`}
          >
            {busy ? 'Đang kiểm…' : actions.length > 1 ? 'Xem trước' : `Xem trước: ${ACTION_LABEL[active]}`}
          </button>
        </div>
        {selection.full && <p className="w-full text-xs text-warning-fg">Mỗi lượt tối đa {WASTE_BULK_MAX} yêu cầu. Làm xong lượt này rồi chọn tiếp.</p>}
        {error && (
          <div className="w-full">
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          </div>
        )}
      </div>
      {preview && (
        <WasteBulkDialog
          action={preview.action}
          preview={preview.res}
          onClose={(changed) => {
            setPreview(null);
            if (changed) {
              selection.clear();
              void qc.invalidateQueries({ queryKey: ['admin-waste-requests'] });
              void qc.invalidateQueries({ queryKey: ['admin-waste-unmatched'] });
              void qc.invalidateQueries({ queryKey: ['admin-ops-inbox'] });
            }
          }}
        />
      )}
    </>
  );
}

function rowText(r: WasteBulkResult, action: WasteBulkAction, done: boolean): string {
  if (!r.ok) return r.reason ?? '';
  if (action === 'CLOSE_LOST') return done ? 'Đã đóng vì thất lạc' : 'Sẽ đóng vì thất lạc';
  return done ? 'Đã nhận vào kho' : r.needsPhoneConfirm ? 'Sẽ nhận, cần đối chiếu SĐT và mã vận đơn' : 'Sẽ nhận (túi kèm đơn đã giao)';
}

export function WasteBulkDialog({ action, preview, onClose }: { action: WasteBulkAction; preview: WasteBulkResponse; onClose: (changed: boolean) => void }) {
  const titleId = useId();
  const reasonId = useId();
  const confirmId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState('');
  const [phoneChecked, setPhoneChecked] = useState(false);
  const [running, setRunning] = useState(false);
  const [sent, setSent] = useState(0);
  const [done, setDone] = useState<WasteBulkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Lượt chạy lỗi giữa chừng: máy chủ có thể đã đổi một phần, nên đóng hộp vẫn tải lại danh sách.
  const [stale, setStale] = useState(false);
  const okIds = useMemo(() => preview.results.filter((r) => r.ok).map((r) => r.id), [preview]);
  const needsPhone = action === 'MARK_RECEIVED' && preview.results.some((r) => r.ok && r.needsPhoneConfirm);
  const lost = action === 'CLOSE_LOST';
  const reasonOk = !lost || reason.trim() !== '';
  const ready = okIds.length > 0 && reasonOk && (!needsPhone || phoneChecked);
  const shown = done ?? preview;

  const close = useCallback(() => {
    if (!running) onClose(stale || (done !== null && done.okCount > 0));
  }, [running, done, stale, onClose]);
  useDialogFocusTrap(boxRef, close);

  const run = async () => {
    if (running || !ready) return;
    setError(null);
    setRunning(true);
    const results: WasteBulkResult[] = [];
    const auditErrors: string[] = [];
    try {
      for (let i = 0; i < okIds.length; i += WASTE_BULK_CHUNK) {
        setSent(i);
        const res = await wasteBulkAction(
          {
            action,
            requestIds: okIds.slice(i, i + WASTE_BULK_CHUNK),
            dryRun: false,
            ...(needsPhone ? { phoneMatchConfirmed: true } : {}),
            ...(lost ? { reason: reason.trim() } : {}),
          },
          { timeoutMs: WASTE_BULK_TIMEOUT_MS },
        );
        results.push(...res.results);
        if (res.auditError) auditErrors.push(res.auditError);
      }
    } catch (e) {
      setStale(true);
      setError(`${actionErrorText(e)} Yêu cầu chưa có kết quả ở đây có thể đã đổi hoặc chưa: đóng hộp để tải lại danh sách rồi kiểm lại.`);
    } finally {
      if (results.some((r) => r.outcome !== 'UPDATED')) setStale(true);
      if (results.length > 0) {
        const all = [...results, ...preview.results.filter((r) => !r.ok)];
        const okCount = all.filter((r) => r.ok).length;
        const skippedCount = all.filter((r) => r.outcome === 'SKIPPED').length;
        setDone({
          dryRun: false,
          action,
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

  const verb = lost ? 'Đóng' : 'Nhận';
  return createPortal(
    <div data-waste-bulk-backdrop onClick={close} className="fixed inset-0 z-[100] flex items-end justify-center bg-stone-900/40 p-4 sm:items-center" style={safeAreaPadX('1rem')}>
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={stop}
        data-waste-bulk-dialog
        className={`flex max-h-[90vh] w-full max-w-lg flex-col rounded-sheet bg-stone-0 p-5 shadow-raised ${ADMIN_TABULAR}`}
      >
        <h2 id={titleId} className="font-display text-base font-semibold text-stone-900">
          {done ? `Kết quả: ${ACTION_LABEL[action]}` : `${ACTION_LABEL[action]} hàng loạt`}
        </h2>
        <p className="mt-1 text-sm text-stone-700" data-waste-bulk-summary aria-live="polite">
          {done
            ? `Đã ${verb.toLowerCase()} ${done.okCount} yêu cầu${skippedText(done)}${done.failedCount ? `, ${done.failedCount} yêu cầu không đổi được` : ''}.`
            : running
              ? `Đang ${verb.toLowerCase()} ${Math.min(sent + WASTE_BULK_CHUNK, okIds.length)}/${okIds.length} yêu cầu…`
              : `${preview.okCount} yêu cầu làm được${skippedText(preview)}${preview.failedCount ? `, ${preview.failedCount} yêu cầu bị giữ lại (làm từng yêu cầu)` : ''}.`}
        </p>
        {!lost && <p className="mt-1 text-xs text-stone-600">Nhận xong, đếm vỏ và cộng điểm vẫn làm từng kiện ở hàng Kho cần đếm.</p>}
        {done?.auditError && (
          <div className="mt-2">
            <Notice tone="warning" role="alert">
              {done.auditError}
            </Notice>
          </div>
        )}
        <ul
          className="mt-3 min-h-0 flex-1 divide-y divide-stone-100 overflow-y-auto rounded-control border border-stone-200"
          tabIndex={0}
          aria-label="Từng yêu cầu"
          data-waste-bulk-results
        >
          {shown.results.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-2 px-3 py-2 text-sm" data-ok={r.ok ? 'true' : 'false'} data-outcome={r.outcome}>
              <span className="font-mono font-semibold text-stone-900">{r.code ?? r.id}</span>
              <span className="text-xs text-stone-500">
                {r.method ? WASTE_METHOD_LABELS[r.method] : ''}
                {r.from ? ` · ${WASTE_REQUEST_STATUS_LABELS[r.from]}` : ''}
              </span>
              <span className={`w-full text-xs ${r.ok ? 'text-success-fg' : r.outcome === 'SKIPPED' ? 'text-stone-600' : 'text-danger-fg'}`}>{rowText(r, action, done !== null)}</span>
            </li>
          ))}
        </ul>
        {!done && needsPhone && okIds.length > 0 && (
          <label htmlFor={confirmId} className="mt-3 flex min-h-[44px] cursor-pointer items-start gap-2 text-sm text-stone-800" data-waste-bulk-phone>
            <input id={confirmId} type="checkbox" className="mt-1 h-5 w-5 accent-forest-600" checked={phoneChecked} onChange={(e) => setPhoneChecked(e.target.checked)} />
            <span>Tôi đã đối chiếu SĐT người gửi (khớp số đã che) và mã vận đơn trên từng kiện gửi về kho.</span>
          </label>
        )}
        {!done && lost && okIds.length > 0 && (
          <div className="mt-3">
            <label htmlFor={reasonId} className="mb-1 block text-xs font-medium text-stone-700">
              Lý do đóng vì thất lạc (ghi vào từng yêu cầu) *
            </label>
            <textarea id={reasonId} rows={2} maxLength={REASON_MAX} required value={reason} onChange={(e) => setReason(e.target.value)} className={`${INPUT_CLASS} w-full`} />
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
            data-dialog-initial
            data-waste-bulk-close
            onClick={close}
            disabled={running}
            className={`${HIT} rounded-control border border-stone-450 bg-stone-0 px-4 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50`}
          >
            {done ? 'Xong' : 'Đóng'}
          </button>
          {!done && (
            <button
              type="button"
              data-waste-bulk-confirm
              onClick={() => void run()}
              disabled={running || !ready}
              aria-busy={running || undefined}
              className={`${HIT} rounded-control px-4 text-sm font-medium text-stone-0 disabled:cursor-not-allowed disabled:opacity-50 ${
                lost ? 'bg-danger-fg hover:brightness-90' : 'bg-forest-600 hover:bg-forest-700'
              }`}
            >
              {running ? `Đang ${verb.toLowerCase()}…` : `${verb} ${okIds.length} yêu cầu`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
