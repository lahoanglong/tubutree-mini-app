'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hideBrokenImage } from '@tubutree/app-core/image-fallback';
import {
  WP_TIER_TONE,
  approveWpImages,
  listWpImageCandidates,
  restoreWpImages,
  skipWpImages,
  type WpImageList,
  type WpImageRow,
  type WpRowState,
} from '@/lib/wp-image-candidates';
import type { Tone } from '@/lib/recycling';
import { formatDateTime } from '@/lib/format-date';
import { actionErrorText, loadErrorText } from '@/lib/admin-error-text';
import { useConfirm } from '@/components/admin/confirm-dialog';
import { useToastedMessage } from '@/components/admin/admin-toast';
import { BTN_PRIMARY, BTN_SECONDARY, FIELD_CLASS, ListSkeleton, LoadError, Notice, TOUCH_H, ToneBadge } from '@/components/admin/ui';
import { TRIAGE_FILTERS, applyOptimistic, filterCounts, hasSuggestion, matchesFilter, matchesQuery, stillWithoutImage, type TriageAction, type TriageFilter } from './triage-filter';

const KEY = ['admin-wp-image-triage'] as const;

const STATE_BADGE: Record<WpRowState, { tone: Tone; label: string }> = {
  PENDING: { tone: 'warning', label: 'Chờ duyệt' },
  SKIPPED: { tone: 'neutral', label: 'Đã bỏ qua' },
  APPLIED: { tone: 'success', label: 'Đã duyệt' },
  HAS_IMAGES: { tone: 'info', label: 'Đã có ảnh' },
};

const pillClass = (active: boolean) =>
  `inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-medium ${active ? 'bg-forest-600 text-stone-0' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'}`;

const BUSY_BTN = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

interface Vars {
  action: TriageAction;
  row: WpImageRow;
  urls: string[];
}

const when = (iso: string | null): string | null => {
  const s = formatDateTime(iso);
  return s === '—' ? null : s;
};

/**
 * Bàn duyệt ảnh WordPress toàn trang: mỗi sản phẩm một thẻ đặt ảnh Tubu Tree cạnh ảnh ứng viên ở tubutree.com, một chạm Duyệt / Bỏ qua / Đưa về chờ duyệt.
 * Duyệt = máy chủ tải ảnh về và lưu vào sản phẩm (không dẫn link sang WordPress). Nhóm khác "Chắc chắn cùng sản phẩm" phải qua hộp xác nhận vì có thể là ảnh của quy cách khác.
 * Danh sách gồm sản phẩm trong bảng ứng viên làm tay, sản phẩm rỗng ảnh có gợi ý theo tên ("Gợi ý theo tên, chưa kiểm": phải đối chiếu bao bì) và sản phẩm rỗng ảnh
 * chưa có gợi ý nào ("Chưa có gợi ý": không có thao tác duyệt, cần ảnh mới). Ô tìm và nhóm lọc cùng áp: số đếm của từng nhóm tính trên kết quả tìm.
 */
export function WpImageTriage() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [filter, setFilter] = useState<TriageFilter>('pending');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inlineMsg = useToastedMessage(msg);
  // Ref chặn cú chạm thứ hai trong cùng khung hình; state `isPending` chỉ đúng sau lần vẽ kế.
  const inFlight = useRef(false);

  const list = useQuery({ queryKey: KEY, queryFn: () => listWpImageCandidates(true), staleTime: 60_000, refetchOnWindowFocus: false });
  const items = list.data?.items ?? [];
  const searched = items.filter((r) => matchesQuery(r, query));
  const counts = filterCounts(searched);
  const shown = searched.filter((r) => matchesFilter(r, filter));
  const searching = query.trim() !== '';
  const totals = filterCounts(items);

  const act = useMutation({
    mutationFn: ({ action, row, urls }: Vars) => (action.kind === 'approve' ? approveWpImages(row.productId, urls) : action.kind === 'skip' ? skipWpImages(row.productId) : restoreWpImages(row.productId)),
    onMutate: async ({ action }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const previous = qc.getQueryData<WpImageList>(KEY);
      if (previous) qc.setQueryData<WpImageList>(KEY, applyOptimistic(previous, action));
      return { previous };
    },
    onSuccess: (r, { action, row, urls }) => {
      const text =
        action.kind === 'approve'
          ? `Đã lưu ${r.appliedCount ?? urls.length} ảnh vào "${row.name}".`
          : action.kind === 'skip'
            ? `Đã bỏ qua "${row.name}".`
            : `Đã đưa "${row.name}" về danh sách chờ duyệt.`;
      setMsg({ ok: true, text });
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(KEY, ctx.previous);
      setMsg({ ok: false, text: e instanceof Error ? actionErrorText(e) : 'Không thực hiện được. Thử lại sau.' });
    },
    onSettled: () => {
      inFlight.current = false;
      // Máy chủ là nguồn đúng (có thể đã đổi trạng thái, ảnh WordPress có thể đã đổi): nạp lại để thẻ phản ánh đúng.
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
  const busy = act.isPending;
  const actingId = busy ? act.variables?.row.productId : undefined;

  const run = (vars: Vars) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setMsg(null);
    act.mutate(vars);
  };

  const selectionFor = (row: WpImageRow): string[] => picked[row.productId] ?? row.defaultImageUrls ?? [];
  const toggle = (row: WpImageRow, url: string) =>
    setPicked((prev) => {
      const cur = prev[row.productId] ?? row.defaultImageUrls ?? [];
      return { ...prev, [row.productId]: cur.includes(url) ? cur.filter((u) => u !== url) : [...cur, url] };
    });

  const approve = async (row: WpImageRow) => {
    const urls = selectionFor(row);
    if (busy || inFlight.current || urls.length === 0) return;
    if (row.tier !== 'EXACT') {
      const ok = await confirm({
        title: 'Dùng ảnh từ WordPress',
        message: `${row.tierLabel}: ảnh có thể không giống bao bì "${row.name}" đang bán. Bạn đã xem kỹ ${urls.length} ảnh đã chọn và thấy đúng sản phẩm?`,
        confirmLabel: 'Dùng ảnh này',
      });
      if (!ok) return;
    }
    run({ action: { kind: 'approve', productId: row.productId, imageCount: urls.length }, row, urls });
  };

  return (
    <div className="space-y-4">
      {dialog}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          data-testid="wp-triage-search"
          aria-label="Tìm sản phẩm theo tên hoặc mã"
          placeholder="Tìm theo tên hoặc mã sản phẩm"
          autoComplete="off"
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${FIELD_CLASS} ${TOUCH_H} w-full sm:w-80`}
        />
        <button
          type="button"
          onClick={() => {
            if (!list.isFetching && !busy) void list.refetch();
          }}
          aria-busy={list.isFetching || undefined}
          aria-disabled={list.isFetching || busy || undefined}
          className={`${BTN_SECONDARY} ${BUSY_BTN} sm:ml-auto`}
        >
          {list.isFetching ? 'Đang tải…' : 'Tải lại'}
        </button>
      </div>

      <div role="group" aria-label="Lọc theo trạng thái" className="flex min-w-0 flex-wrap gap-2">
        {TRIAGE_FILTERS.map((f) => (
          <button key={f.key} type="button" data-testid={`wp-triage-pill-${f.key}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} className={pillClass(filter === f.key)}>
            {f.label}
            <span className="tabular-nums">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {list.isSuccess && searching && (
        <p role="status" className="text-xs text-stone-600">
          Tìm “{query.trim()}”: <span className="tabular-nums">{searched.length}</span>/<span className="tabular-nums">{items.length}</span> sản phẩm khớp.
        </p>
      )}

      {inlineMsg && (
        <Notice tone={inlineMsg.ok ? 'success' : 'danger'} role={inlineMsg.ok ? 'status' : 'alert'}>
          {inlineMsg.text}
        </Notice>
      )}

      {list.isLoading && <ListSkeleton label="Đang hỏi WordPress" rows={3} className="h-48" />}
      {list.isError && <LoadError message={loadErrorText(list.error)} onRetry={() => list.refetch()} retrying={list.isFetching} />}
      {list.isSuccess && shown.length === 0 && (
        <p className="rounded-card border border-stone-200 bg-stone-0 p-4 text-center text-sm text-stone-600">
          {items.length === 0
            ? 'Chưa có sản phẩm nào cần duyệt ảnh WordPress.'
            : searching && searched.length === 0
              ? `Không có sản phẩm nào khớp “${query.trim()}”.`
              : 'Không có sản phẩm nào trong nhóm này.'}
        </p>
      )}

      <ul className="space-y-3">
        {shown.map((row) => (
          <TriageCard
            key={row.productId}
            row={row}
            selected={selectionFor(row)}
            busy={busy}
            acting={actingId === row.productId}
            onToggle={(u) => toggle(row, u)}
            onApprove={() => void approve(row)}
            onSkip={() => run({ action: { kind: 'skip', productId: row.productId }, row, urls: [] })}
            onRestore={() => run({ action: { kind: 'restore', productId: row.productId }, row, urls: [] })}
          />
        ))}
      </ul>

      {list.isSuccess && (
        <p className="text-xs text-stone-500">
          Tổng <span className="tabular-nums">{items.length}</span> sản phẩm; <span className="tabular-nums">{totals.noImage}</span> chưa có ảnh (<span className="tabular-nums">{totals.suggested}</span> có ảnh gợi ý,{' '}
          <span className="tabular-nums">{totals.noSuggestion}</span> chưa có gợi ý
          {totals.noImage > totals.suggested + totals.noSuggestion && (
            <>
              , <span className="tabular-nums">{totals.noImage - totals.suggested - totals.noSuggestion}</span> chưa hỏi được WordPress
            </>
          )}
          ).
        </p>
      )}
    </div>
  );
}

function TriageCard({
  row,
  selected,
  busy,
  acting,
  onToggle,
  onApprove,
  onSkip,
  onRestore,
}: {
  row: WpImageRow;
  selected: string[];
  busy: boolean;
  acting: boolean;
  onToggle: (url: string) => void;
  onApprove: () => void;
  onSkip: () => void;
  onRestore: () => void;
}) {
  const sources = row.wp ?? [];
  const total = sources.reduce((n, s) => n + s.imageUrls.length, 0);
  const usable = total > 0;
  const withoutImage = stillWithoutImage(row);
  const pending = row.state === 'PENDING';
  const badge = STATE_BADGE[row.state];
  const decided = when(row.decidedAt);
  const lockProps = { 'aria-disabled': busy || undefined, 'aria-busy': acting || undefined };

  return (
    <li data-testid="wp-triage-card" data-state={row.state} className="space-y-3 rounded-card border border-stone-200 bg-stone-0 p-3 sm:p-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-words text-sm font-semibold text-stone-900">{row.name}</h2>
          <ToneBadge tone={badge.tone}>{badge.label}</ToneBadge>
          <ToneBadge tone={WP_TIER_TONE[row.tier]}>{row.tierLabel}</ToneBadge>
          {!row.isActive && <ToneBadge tone="neutral">Đang tắt</ToneBadge>}
        </div>
        <p className="break-all text-xs text-stone-600">
          Mã sản phẩm: <span className="font-mono">{row.productSlug}</span>
        </p>
        <p className="text-xs text-stone-600">{row.note}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <section aria-label="Ảnh trên Tubu Tree" className="space-y-2 rounded-control border border-stone-200 p-2.5">
          <h3 className="text-xs font-medium text-stone-700">Tubu Tree đang bán</h3>
          <div
            role="img"
            aria-label={withoutImage ? 'Chưa có ảnh' : row.state === 'APPLIED' ? 'Đã có ảnh vừa duyệt' : 'Đã có ảnh'}
            className={`flex aspect-square w-full max-w-40 items-center justify-center rounded-control border border-dashed text-center text-xs ${withoutImage ? 'border-stone-450 bg-stone-100 text-stone-600' : 'border-success-fg bg-success-bg text-success-fg'}`}
          >
            {withoutImage ? 'Chưa có ảnh' : row.state === 'APPLIED' ? 'Đã có ảnh vừa duyệt' : 'Đã có ảnh'}
          </div>
          {row.variations.length > 0 && <p className="break-words text-xs text-stone-600">Phân loại: {row.variations.join(', ')}</p>}
        </section>

        <section aria-label="Ảnh ứng viên ở WordPress" className="min-w-0 space-y-2 rounded-control border border-stone-200 p-2.5">
          <h3 className="text-xs font-medium text-stone-700">Ảnh ở WordPress (tubutree.com)</h3>
          {!withoutImage && (
            <p className="text-xs text-stone-600">
              {row.state === 'APPLIED'
                ? `Đã lưu ${row.appliedCount ?? 'một số'} ảnh vào sản phẩm${decided ? ` lúc ${decided}` : ''}.`
                : 'Sản phẩm đã có ảnh nên không cần ảnh từ WordPress.'}
            </p>
          )}
          {withoutImage && sources.length === 0 && (
            <p className="text-xs text-stone-600">{row.tier === 'NONE' && !row.suggestUnavailable ? 'Không có ảnh WordPress để chọn cho sản phẩm này.' : 'Chưa hỏi được WordPress. Bấm “Tải lại” ở đầu trang.'}</p>
          )}
          {withoutImage &&
            sources.map((s) => (
              <div key={s.slug} className="space-y-1.5">
                <p className="break-words text-xs text-stone-700">{s.name ?? s.slug}</p>
                {s.error && (
                  <Notice tone="warning" role="status">
                    {s.error}
                  </Notice>
                )}
                {s.imageUrls.length > 0 && (
                  <ul className="grid grid-cols-3 gap-2">
                    {s.imageUrls.map((url, i) => (
                      <li key={`${s.slug}-${url}`} className="min-w-0">
                        <label className="flex flex-col items-center gap-1 text-xs text-stone-600">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`Ảnh ${i + 1} của "${s.name ?? s.slug}" ở WordPress`}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={hideBrokenImage}
                            className="aspect-square w-full rounded-control border border-stone-200 object-cover"
                          />
                          {pending && (
                            <span className="inline-flex min-h-[44px] min-w-[44px] items-center gap-1">
                              <input type="checkbox" checked={selected.includes(url)} disabled={busy} onChange={() => onToggle(url)} aria-label={`Dùng ảnh ${i + 1} của ${s.name ?? s.slug}`} />
                              Dùng
                            </span>
                          )}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          {pending && usable && (
            <p className="text-xs text-stone-600">
              Đã chọn <span className="tabular-nums">{selected.length}</span>/<span className="tabular-nums">{total}</span> ảnh.
            </p>
          )}
        </section>
      </div>

      {(pending || row.state === 'SKIPPED') && hasSuggestion(row) && (
        <div className="flex flex-wrap items-center gap-2">
          {pending ? (
            <>
              <button
                type="button"
                disabled={!usable || selected.length === 0}
                onClick={() => {
                  if (!busy) onApprove();
                }}
                aria-label={`Duyệt dùng ảnh này cho ${row.name}`}
                {...lockProps}
                className={`${BTN_PRIMARY} ${BUSY_BTN}`}
              >
                {acting ? 'Đang lưu…' : 'Duyệt dùng ảnh này'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!busy) onSkip();
                }}
                aria-label={`Bỏ qua ${row.name}`}
                {...lockProps}
                className={`${BTN_SECONDARY} ${BUSY_BTN}`}
              >
                Bỏ qua
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!busy) onRestore();
              }}
              aria-label={`Đưa ${row.name} về chờ duyệt`}
              {...lockProps}
              className={`${BTN_SECONDARY} ${BUSY_BTN}`}
            >
              {acting ? 'Đang xử lý…' : 'Đưa về chờ duyệt'}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
