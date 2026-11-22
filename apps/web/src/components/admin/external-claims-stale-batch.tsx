'use client';

import { useCallback, useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { actionErrorText } from '@/lib/admin-error-text';
import {
  STALE_BATCH_CHUNK,
  STALE_BATCH_MAX,
  STALE_BATCH_TIMEOUT_MS,
  staleBatchApprove,
  type StaleBatchResponse,
  type StaleBatchRow,
} from '@/lib/admin-external-stale-batch-client';
import { formatCount } from '@/lib/checkout-points';
import { safeAreaPadX } from '@/lib/safe-area';
import { ADMIN_TABULAR } from './tabular-nums';
import { BTN_SECONDARY, Notice } from './ui';
import { useDialogFocusTrap } from './use-dialog-focus-trap';

const HIT = 'min-h-[44px] min-w-[44px]';
export const STALE_BATCH_BUTTON = 'Duyệt nhanh đơn chat SĐT đã từng nhận app';
const stop = (e: MouseEvent) => e.stopPropagation();

/**
 * Nút CSKH: xem trước các claim đơn chat đang chờ duyệt CHỈ vì SĐT xác minh đã cũ, của thành viên đã nhận ít nhất một đơn app, rồi bấm duyệt.
 * Không bao giờ tự duyệt: xem trước không đổi gì, lượt thật chỉ gửi đúng các claim đã xem trước, máy chủ xét lại mọi luật trong khoá từng claim.
 */
export function ExternalClaimsStaleBatch() {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<StaleBatchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPreview = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      setPreview(await staleBatchApprove({ dryRun: true }));
    } catch (e) {
      setError(actionErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2" data-stale-batch>
      <button type="button" onClick={() => void openPreview()} disabled={busy} aria-busy={busy || undefined} className={BTN_SECONDARY}>
        {busy ? 'Đang tìm claim…' : STALE_BATCH_BUTTON}
      </button>
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      {preview && (
        <StaleBatchDialog
          preview={preview}
          onClose={(changed) => {
            setPreview(null);
            if (changed) {
              void qc.invalidateQueries({ queryKey: ['admin-external-claims'] });
              void qc.invalidateQueries({ queryKey: ['admin-external-claim'] });
              void qc.invalidateQueries({ queryKey: ['admin-ops-inbox'] });
            }
          }}
        />
      )}
    </div>
  );
}

function rowText(r: StaleBatchRow, done: boolean): string {
  if (!r.ok) return r.reason ?? '';
  return done ? 'Đã duyệt, điểm chờ cộng theo lịch đối soát' : 'Sẽ duyệt';
}

export function StaleBatchDialog({ preview, onClose }: { preview: StaleBatchResponse; onClose: (changed: boolean) => void }) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);
  const [sent, setSent] = useState(0);
  const [done, setDone] = useState<StaleBatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const okIds = useMemo(() => preview.results.filter((r) => r.ok).map((r) => r.id), [preview]);
  const shown = done ?? preview;

  const close = useCallback(() => {
    if (!running) onClose(stale || (done !== null && done.okCount > 0));
  }, [running, done, stale, onClose]);
  useDialogFocusTrap(boxRef, close);

  const run = async () => {
    if (running || okIds.length === 0) return;
    setError(null);
    setRunning(true);
    const results: StaleBatchRow[] = [];
    const auditErrors: string[] = [];
    try {
      for (let i = 0; i < okIds.length; i += STALE_BATCH_CHUNK) {
        setSent(i);
        const res = await staleBatchApprove({ dryRun: false, claimIds: okIds.slice(i, i + STALE_BATCH_CHUNK) }, { timeoutMs: STALE_BATCH_TIMEOUT_MS });
        results.push(...res.results);
        if (res.auditError) auditErrors.push(res.auditError);
      }
    } catch (e) {
      setStale(true);
      setError(`${actionErrorText(e)} Claim chưa có kết quả ở đây có thể đã duyệt hoặc chưa: đóng hộp để tải lại danh sách rồi kiểm lại.`);
    } finally {
      if (results.some((r) => r.outcome !== 'APPROVED')) setStale(true);
      if (results.length > 0) {
        const all = [...results, ...preview.results.filter((r) => !r.ok)];
        const okCount = all.filter((r) => r.ok).length;
        const skippedCount = all.filter((r) => r.outcome === 'SKIPPED').length;
        setDone({
          dryRun: false,
          total: all.length,
          okCount,
          skippedCount,
          failedCount: all.length - okCount - skippedCount,
          truncated: preview.truncated,
          results: all,
          auditLogId: null,
          auditError: auditErrors.length ? auditErrors.join(' ') : null,
        });
      }
      setRunning(false);
    }
  };

  return createPortal(
    <div data-stale-batch-backdrop onClick={close} className="fixed inset-0 z-[100] flex items-end justify-center bg-stone-900/40 p-4 sm:items-center" style={safeAreaPadX('1rem')}>
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={stop}
        data-stale-batch-dialog
        className={`flex max-h-[90vh] w-full max-w-lg flex-col rounded-sheet bg-stone-0 p-5 shadow-raised ${ADMIN_TABULAR}`}
      >
        <h2 id={titleId} className="font-display text-base font-semibold text-stone-900">
          {done ? 'Kết quả duyệt nhanh' : STALE_BATCH_BUTTON}
        </h2>
        <p className="mt-1 text-sm text-stone-700" data-stale-batch-summary aria-live="polite">
          {done
            ? `Đã duyệt ${done.okCount} claim${done.skippedCount ? `, ${done.skippedCount} claim người khác vừa xử lý` : ''}${done.failedCount ? `, ${done.failedCount} claim cần duyệt tay` : ''}.`
            : running
              ? `Đang duyệt ${Math.min(sent + STALE_BATCH_CHUNK, okIds.length)}/${okIds.length} claim…`
              : preview.total === 0
                ? 'Không có claim nào đang chờ duyệt chỉ vì SĐT xác minh đã cũ.'
                : `${preview.okCount} claim duyệt nhanh được${preview.failedCount ? `, ${preview.failedCount} claim cần duyệt tay (xem lý do)` : ''}.`}
        </p>
        {!done && (
          <p className="mt-1 text-xs text-stone-600">
            Chỉ claim đơn chat vướng duy nhất SĐT cũ, SĐT trên đơn vẫn thuộc đúng thành viên và thành viên đã nhận ít nhất 1 đơn app tự đặt (không tính đơn CTV đặt hộ, đơn đại lý). Không duyệt được claim
            của chính bạn.
          </p>
        )}
        {preview.truncated && !done && (
          <p className="mt-1 text-xs text-warning-fg">Còn claim khác ngoài lượt này (mỗi lượt tối đa {STALE_BATCH_MAX}). Duyệt xong mở lại để xem tiếp.</p>
        )}
        {done?.auditError && (
          <div className="mt-2">
            <Notice tone="warning" role="alert">
              {done.auditError}
            </Notice>
          </div>
        )}
        {shown.results.length > 0 && (
          <ul
            className="mt-3 min-h-0 flex-1 divide-y divide-stone-100 overflow-y-auto rounded-control border border-stone-200"
            tabIndex={0}
            aria-label="Từng claim"
            data-stale-batch-results
          >
            {shown.results.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-2 px-3 py-2 text-sm" data-ok={r.ok ? 'true' : 'false'} data-outcome={r.outcome}>
                <span className="font-mono font-semibold text-stone-900">{r.maskedCode}</span>
                <span className="text-xs text-stone-500">
                  {[r.userName, r.userPhoneMasked].filter(Boolean).join(' · ')}
                  {` · ${formatCount(r.points)} điểm · ${r.deliveredAppOrders} đơn app đã giao`}
                </span>
                <span className={`w-full text-xs ${r.ok ? 'text-success-fg' : r.outcome === 'SKIPPED' ? 'text-stone-600' : 'text-danger-fg'}`}>{rowText(r, done !== null)}</span>
              </li>
            ))}
          </ul>
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
            data-stale-batch-close
            onClick={close}
            disabled={running}
            className={`${HIT} rounded-control border border-stone-450 bg-stone-0 px-4 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50`}
          >
            {done ? 'Xong' : 'Đóng'}
          </button>
          {!done && okIds.length > 0 && (
            <button
              type="button"
              data-stale-batch-confirm
              onClick={() => void run()}
              disabled={running}
              aria-busy={running || undefined}
              className={`${HIT} rounded-control bg-forest-600 px-4 text-sm font-medium text-stone-0 hover:bg-forest-700 disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {running ? 'Đang duyệt…' : `Duyệt ${okIds.length} claim`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
