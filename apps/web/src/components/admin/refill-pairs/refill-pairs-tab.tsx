'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BTN_LINK, BTN_PRIMARY, BTN_SECONDARY, Field, INPUT_CLASS, ListSkeleton, LoadError, Notice, ToneBadge, chipClass } from '@/components/admin/ui';
import { actionErrorText, loadErrorText } from '@/lib/admin-error-text';
import { getRefillPairs, saveRefillPairs, type AdminRefillPairRow, type AdminRefillPairs, type SaveRefillPairsInput } from './api';
import {
  FILTERS,
  REFILL_PAIRS_KEY as QUERY_KEY,
  addOverride,
  confirmPairs,
  countRows,
  filterRows,
  looseBlocks,
  nearSuggestions,
  ratioText,
  rowAction,
  statusOf,
  type RefillPairFilter,
  type SuggestedPair,
} from './refill-pairs';

function PairRow({ row, maxRatio, busy, onAct }: { row: AdminRefillPairRow; maxRatio: number; busy: boolean; onAct: (row: AdminRefillPairRow) => void }) {
  const status = statusOf(row, maxRatio);
  const action = rowAction(row);
  const ratio = ratioText(row.ratio);
  return (
    <li data-testid="refill-pair-row" data-status={row.status} className="flex flex-col gap-2 rounded-card border border-stone-200 bg-stone-0 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="break-words text-sm font-medium text-stone-900">{row.bottle.name}</p>
        <p className="break-words text-sm text-stone-700">
          <span aria-hidden="true">→ </span>
          <span className="sr-only">đổi sang </span>
          {row.refill ? row.refill.name : 'Chưa chọn gói Refill'}
          {ratio && <span className="ml-1 text-xs text-stone-600">({ratio} chai)</span>}
        </p>
        <ToneBadge tone={status.tone} wrap>
          {status.text}
        </ToneBadge>
      </div>
      {action && (
        <button type="button" className={`${BTN_SECONDARY} shrink-0`} disabled={busy} aria-label={`${action.label}: ${row.bottle.name}`} onClick={() => onAct(row)}>
          {action.label}
        </button>
      )}
    </li>
  );
}

/**
 * Xem trước của "Duyệt nhanh tất cả gợi ý": đúng danh sách chai → gói Refill sẽ được gửi (chụp lúc bấm, không đổi theo bảng), một nút
 * duyệt và một nút huỷ. Mở ra thì đưa focus vào tiêu đề để trình đọc màn hình đọc danh sách.
 */
function SuggestionsPreview({ pairs, busy, onConfirm, onCancel }: { pairs: readonly SuggestedPair[]; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const ids = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section data-testid="refill-confirm-preview" aria-labelledby={`${ids}-title`} className="space-y-2 rounded-card border border-forest-600 bg-stone-0 p-3">
      <h3 id={`${ids}-title`} ref={heading} tabIndex={-1} className="text-sm font-semibold text-stone-900">
        Duyệt {pairs.length} cặp tên gần giống
      </h3>
      <p className="text-xs text-stone-600">Mỗi chai được ghép tay với gói Refill bên phải. Bảng vừa đổi ở nơi khác thì không cặp nào được duyệt, bảng tải lại để xem lại.</p>
      <ol className="space-y-1 text-sm text-stone-800">
        {pairs.map((p) => (
          <li key={p.bottle.slug} className="break-words">
            {p.bottle.name} <span aria-hidden="true">→ </span>
            <span className="sr-only">đổi sang </span>
            {p.refill.name}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={onConfirm}>
          Duyệt {pairs.length} cặp
        </button>
        <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={onCancel}>
          Huỷ
        </button>
      </div>
    </section>
  );
}

/**
 * Thẻ "Cặp Refill": chai nào đang được mời đổi sang gói Refill nào (giỏ và dải "Mua lại món quen" của khách đã nhận chai). Mỗi nút lưu
 * ngay (không có bản nháp): tắt hay bật lại một cặp, duyệt cặp đang gợi ý, duyệt cả các cặp tên gần giống một lần (có xem trước), ghép tay
 * chai bất kỳ với gói Refill bất kỳ.
 */
export function RefillPairsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: QUERY_KEY, queryFn: getRefillPairs });
  const [filter, setFilter] = useState<RefillPairFilter>('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [bottle, setBottle] = useState('');
  const [refill, setRefill] = useState('');
  const [preview, setPreview] = useState<SuggestedPair[] | null>(null);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const openPreviewBtn = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const ids = useId();

  // Khung xem trước đóng khi focus đang ở nút bên trong nó: trả focus về nút mở, hết gợi ý thì về tiêu đề thẻ, không rơi về <body>.
  useEffect(() => {
    if (!restoreFocus || preview) return;
    setRestoreFocus(false);
    (openPreviewBtn.current ?? title.current)?.focus();
  }, [restoreFocus, preview]);
  const closePreview = () => {
    setPreview(null);
    setRestoreFocus(true);
  };
  // 409 khi bảng vừa đổi ở nơi khác: đọc lại bảng để admin xem gợi ý mới trước khi duyệt lại.
  const reload = () => void qc.invalidateQueries({ queryKey: QUERY_KEY });

  const save = async (input: SaveRefillPairsInput, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await saveRefillPairs(input);
      qc.setQueryData(QUERY_KEY, next);
      setMessage({ tone: 'success', text: next.enabled ? `${done} Khách thấy thay đổi trong vài phút.` : `${done} Gợi ý Refill đang tắt nên khách chưa thấy.` });
      return true;
    } catch (e) {
      setMessage({ tone: 'danger', text: actionErrorText(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (q.isPending) return <ListSkeleton label="Đang tải cặp Refill" rows={5} />;
  if (q.isError) return <LoadError message={loadErrorText(q.error)} onRetry={() => q.refetch()} retrying={q.isFetching} />;
  const data: AdminRefillPairs = q.data;
  const rows = filterRows(data.rows, filter);
  const loose = looseBlocks(data);

  const act = async (row: AdminRefillPairRow) => {
    const a = rowAction(row);
    if (a && !(await save(a.input(data), `${a.done}: ${row.bottle.name}.`))) reload();
  };

  const suggestions = nearSuggestions(data.rows);

  const confirmAll = async (pairs: readonly SuggestedPair[]) => {
    const ok = await save(confirmPairs(pairs), `Đã duyệt ${pairs.length} cặp gợi ý.`);
    closePreview();
    if (!ok) reload();
  };

  const pairByHand = async () => {
    if (!bottle || !refill) return;
    if (await save(addOverride(bottle, refill), 'Đã ghép tay.')) {
      setBottle('');
      setRefill('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 ref={title} tabIndex={-1} className="text-lg font-semibold text-stone-900">
          Cặp Refill
        </h2>
        <p className="text-sm text-stone-600">
          Khách đã nhận chai trong một đơn đã giao được mời đổi sang gói Refill ở giỏ và dải &ldquo;Mua lại món quen&rdquo;. Tự ghép khi cùng thương hiệu, cùng công thức, gói Refill lớn hơn chai và không quá{' '}
          {data.maxRatio} lần chai. Các cặp khác chỉ có khi ghép tay.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge tone={data.enabled ? 'success' : 'neutral'}>{data.enabled ? 'Gợi ý Refill đang bật' : 'Gợi ý Refill đang tắt'}</ToneBadge>
        <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void save({ enabled: !data.enabled }, data.enabled ? 'Đã tắt gợi ý Refill.' : 'Đã bật gợi ý Refill.')}>
          {data.enabled ? 'Tắt gợi ý Refill' : 'Bật gợi ý Refill'}
        </button>
      </div>

      {message && (
        <Notice tone={message.tone} role={message.tone === 'danger' ? 'alert' : 'status'}>
          {message.text}
        </Notice>
      )}

      <div role="group" aria-label="Lọc cặp" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} className={chipClass(filter === f.key)} onClick={() => setFilter(f.key)}>
            {f.label} ({countRows(data.rows, f.key)})
          </button>
        ))}
      </div>

      {preview ? (
        <SuggestionsPreview pairs={preview} busy={busy} onConfirm={() => void confirmAll(preview)} onCancel={closePreview} />
      ) : (
        suggestions.length > 0 && (
          <button ref={openPreviewBtn} type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => setPreview(suggestions)}>
            Duyệt nhanh tất cả gợi ý ({suggestions.length})
          </button>
        )
      )}

      {rows.length === 0 ? (
        <p data-testid="refill-pairs-empty" className="rounded-control bg-stone-50 px-3 py-6 text-center text-sm text-stone-600">
          Không có cặp nào ở mục này.
        </p>
      ) : (
        <ul aria-label="Cặp chai và gói Refill" className="space-y-2">
          {rows.map((r) => (
            <PairRow key={r.bottle.id} row={r} maxRatio={data.maxRatio} busy={busy} onAct={(r) => void act(r)} />
          ))}
        </ul>
      )}

      <section aria-labelledby={`${ids}-hand`} className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3">
        <h3 id={`${ids}-hand`} className="text-sm font-semibold text-stone-900">
          Ghép tay chai ↔ gói Refill
        </h3>
        <p className="text-xs text-stone-600">Ghép tay thắng luật tự ghép. Mỗi chai một cặp: ghép lại chai đã có cặp thì cặp cũ được thay.</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Chai khách đã có">
            <select className={INPUT_CLASS} value={bottle} onChange={(e) => setBottle(e.target.value)}>
              <option value="">Chọn chai</option>
              {data.choices.bottles.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Gói Refill thay cho chai">
            <select className={INPUT_CLASS} value={refill} onChange={(e) => setRefill(e.target.value)}>
              <option value="">Chọn gói Refill</option>
              {data.choices.refills.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <button type="button" className={BTN_PRIMARY} disabled={busy || !bottle || !refill} onClick={() => void pairByHand()}>
            Ghép tay
          </button>
        </div>
      </section>

      {loose.length > 0 && (
        <section aria-labelledby={`${ids}-loose`} className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3">
          <h3 id={`${ids}-loose`} className="text-sm font-semibold text-stone-900">
            Món đang chặn
          </h3>
          <ul className="space-y-1">
            {loose.map((b) => (
              <li key={b.slug} className="flex items-center justify-between gap-2 text-sm text-stone-700">
                <span className="min-w-0 break-words">{b.name ?? b.slug}</span>
                <button
                  type="button"
                  className={`${BTN_LINK} text-sm`}
                  disabled={busy}
                  aria-label={`Bỏ chặn: ${b.name ?? b.slug}`}
                  onClick={() => void save({ block: data.block.map((x) => x.slug).filter((s) => s !== b.slug) }, `Đã bỏ chặn: ${b.name ?? b.slug}.`)}
                >
                  Bỏ chặn
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
