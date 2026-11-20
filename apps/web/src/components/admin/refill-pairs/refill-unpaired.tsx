'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { actionErrorText, loadErrorText } from '@/lib/admin-error-text';
import { useToastedMessage } from '../admin-toast';
import { BTN_XS_PRIMARY, FIELD_XS, ListSkeleton, LoadError, Notice, chipClass } from '../ui';
import { getRefillPairs, saveRefillPairs, type AdminRefillPairRow, type AdminRefillProduct } from './api';
import { REFILL_PAIRS_KEY, addOverride, filterRows, statusOf } from './refill-pairs';

// Cùng khoá với thẻ "Cặp Refill": ghép ở đây thì thẻ kia thấy ngay, và ngược lại.
const useRefillPairs = () => useQuery({ queryKey: REFILL_PAIRS_KEY, queryFn: getRefillPairs, retry: false, staleTime: 30_000 });

/**
 * Chip "Chưa ghép Refill (n)" ở thẻ Sản phẩm: chai có gói Refill cùng thương hiệu mà khách chưa được mời đổi (lệch lượng quá luật tự ghép,
 * nhiều gói cùng công thức, tên gần giống). Không tải được bảng cặp (lỗi, vai trò không có quyền) thì không có chip.
 */
export function RefillUnpairedChip({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const q = useRefillPairs();
  if (!q.data) return null;
  return (
    <button type="button" aria-pressed={on} onClick={onToggle} className={chipClass(on)}>
      Chưa ghép Refill ({filterRows(q.data.rows, 'waiting').length})
    </button>
  );
}

function UnpairedRow({
  row,
  refills,
  maxRatio,
  busy,
  onPair,
}: {
  row: AdminRefillPairRow;
  refills: readonly AdminRefillProduct[];
  maxRatio: number;
  busy: boolean;
  onPair: (row: AdminRefillPairRow, refillSlug: string) => void;
}) {
  // Chọn sẵn gói đang gợi ý: dòng lệch lượng hay tên gần giống chỉ cần một chạm "Ghép".
  const [refill, setRefill] = useState(row.refill?.slug ?? '');
  return (
    <li data-testid="refill-unpaired-row" data-status={row.status} className="flex flex-col gap-2 rounded-card border border-stone-200 bg-stone-0 p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium text-stone-900">{row.bottle.name}</p>
        <p className="text-xs text-warning-fg">{statusOf(row, maxRatio).text}</p>
      </div>
      <div className="flex items-center gap-2">
        <select aria-label={`Gói Refill cho ${row.bottle.name}`} value={refill} onChange={(e) => setRefill(e.target.value)} className={`${FIELD_XS} flex-1 sm:w-64 sm:flex-none`}>
          <option value="">Chọn gói Refill…</option>
          {refills.map((p) => (
            <option key={p.id} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" className={`${BTN_XS_PRIMARY} shrink-0`} disabled={busy || !refill} aria-label={`Ghép Refill: ${row.bottle.name}`} onClick={() => onPair(row, refill)}>
          Ghép
        </button>
      </div>
    </li>
  );
}

/**
 * Danh sách thay cho danh sách sản phẩm khi chip "Chưa ghép Refill" bật: mỗi chai một dòng, ô chọn gói Refill (chọn sẵn gói gợi ý) và nút
 * "Ghép" lưu ngay thành cặp ghép tay. Tắt cặp hay bỏ ghép tay vẫn ở thẻ "Cặp Refill".
 */
export function RefillUnpairedPanel() {
  const qc = useQueryClient();
  const q = useRefillPairs();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inlineMsg = useToastedMessage(msg);

  if (q.isPending) return <ListSkeleton label="Đang tải chai chưa ghép Refill" rows={3} className="h-14" />;
  if (q.isError) return <LoadError message={loadErrorText(q.error)} onRetry={() => q.refetch()} retrying={q.isFetching} />;
  const data = q.data;
  const rows = filterRows(data.rows, 'waiting');

  const pair = async (row: AdminRefillPairRow, refillSlug: string) => {
    const refillName = data.choices.refills.find((p) => p.slug === refillSlug)?.name ?? refillSlug;
    setBusy(true);
    setMsg(null);
    try {
      const next = await saveRefillPairs(addOverride(row.bottle.slug, refillSlug));
      qc.setQueryData(REFILL_PAIRS_KEY, next);
      const seen = next.enabled ? 'Khách thấy thay đổi trong vài phút.' : 'Gợi ý Refill đang tắt nên khách chưa thấy.';
      setMsg({ ok: true, text: `Đã ghép ${row.bottle.name} với ${refillName}. ${seen}` });
    } catch (e) {
      setMsg({ ok: false, text: actionErrorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Chai chưa ghép gói Refill" className="space-y-2">
      <p className="text-xs text-stone-600">Chai có gói Refill cùng thương hiệu nhưng chưa tự ghép. Chọn gói rồi bấm Ghép; tắt hay bỏ ghép ở thẻ Cặp Refill.</p>
      {inlineMsg && (
        <Notice tone={inlineMsg.ok ? 'success' : 'danger'} role={inlineMsg.ok ? 'status' : 'alert'}>
          {inlineMsg.text}
        </Notice>
      )}
      {rows.length === 0 ? (
        <p data-testid="refill-unpaired-empty" className="rounded-card border border-stone-200 bg-stone-0 p-6 text-center text-sm text-stone-500">
          Không còn chai nào chờ ghép Refill.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <UnpairedRow key={r.bottle.id} row={r} refills={data.choices.refills} maxRatio={data.maxRatio} busy={busy} onPair={(row, slug) => void pair(row, slug)} />
          ))}
        </ul>
      )}
    </section>
  );
}
