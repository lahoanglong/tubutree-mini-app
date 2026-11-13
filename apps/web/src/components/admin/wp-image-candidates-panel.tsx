'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hideBrokenImage } from '@tubutree/app-core/image-fallback';
import {
  WP_TIER_TONE,
  approveWpImages,
  listWpImageCandidates,
  restoreWpImages,
  skipWpImages,
  type WpImageRow,
} from '@/lib/wp-image-candidates';
import { actionErrorText } from '@/lib/admin-error-text';
import { useConfirm } from './confirm-dialog';
import { useToastedMessage } from './admin-toast';
import { BTN_XS_PRIMARY, BTN_XS_SECONDARY, ListSkeleton, Notice, ToneBadge } from './ui';

const KEY = ['admin-wp-image-candidates'] as const;

type Act = { kind: 'approve'; row: WpImageRow; urls: string[] } | { kind: 'skip'; row: WpImageRow } | { kind: 'restore'; row: WpImageRow };

const errText = (e: unknown, fallback: string) => (e instanceof Error ? actionErrorText(e) : fallback);

/**
 * "Ứng viên ảnh từ WordPress": sản phẩm đang bán mà chưa có ảnh, kèm ảnh tìm được ở tubutree.com (WordPress cũ). Duyệt = máy chủ tải ảnh về, nén và
 * lưu vào chính sản phẩm (không dẫn link sang WordPress), nên tắt WordPress không làm chết ảnh. Chỉ nhóm "chắc chắn" mới nên duyệt thẳng; các nhóm còn lại
 * có thể là ảnh của quy cách khác, người duyệt phải nhìn bao bì rồi mới đồng ý. Đóng sẵn và chỉ hỏi WordPress khi mở: tab Sản phẩm không tốn lượt gọi nào.
 */
export function WpImageCandidatesPanel({ onChanged }: { onChanged?: () => void }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inlineMsg = useToastedMessage(msg);

  const list = useQuery({ queryKey: KEY, queryFn: () => listWpImageCandidates(true), enabled: open, staleTime: 60_000 });
  const items = list.data?.items ?? [];
  const pending = items.filter((r) => r.state === 'PENDING');
  const skipped = items.filter((r) => r.state === 'SKIPPED');
  const applied = items.filter((r) => r.state === 'APPLIED');
  const hasImages = list.data?.counts.HAS_IMAGES ?? 0;

  const act = useMutation({
    mutationFn: (a: Act) => (a.kind === 'approve' ? approveWpImages(a.row.productId, a.urls) : a.kind === 'skip' ? skipWpImages(a.row.productId) : restoreWpImages(a.row.productId)),
    onSuccess: (r, a) => {
      const verb =
        a.kind === 'approve' ? `Đã lưu ${r.appliedCount ?? a.urls.length} ảnh vào "${a.row.name}".` : a.kind === 'skip' ? `Đã bỏ qua "${a.row.name}".` : `Đã đưa "${a.row.name}" về danh sách chờ duyệt.`;
      setMsg({ ok: true, text: verb });
      void qc.invalidateQueries({ queryKey: KEY });
      if (a.kind === 'approve') onChanged?.();
    },
    onError: (e, a) => {
      setMsg({ ok: false, text: errText(e, 'Không thực hiện được. Thử lại sau.') });
      // Máy chủ có thể đã đổi trạng thái (đã có ảnh, ảnh WordPress đã đổi): nạp lại để dòng phản ánh đúng.
      void qc.invalidateQueries({ queryKey: KEY });
      if (a.kind === 'approve') onChanged?.();
    },
  });

  const selectionFor = (row: WpImageRow): string[] => picked[row.productId] ?? row.defaultImageUrls ?? [];
  const toggle = (row: WpImageRow, url: string) =>
    setPicked((prev) => {
      const cur = prev[row.productId] ?? row.defaultImageUrls ?? [];
      return { ...prev, [row.productId]: cur.includes(url) ? cur.filter((u) => u !== url) : [...cur, url] };
    });

  const approve = async (row: WpImageRow) => {
    const urls = selectionFor(row);
    if (act.isPending || urls.length === 0) return;
    setMsg(null);
    if (row.tier !== 'EXACT') {
      const ok = await confirm({
        title: 'Dùng ảnh từ WordPress',
        message: `${row.tierLabel}: ảnh có thể không giống bao bì "${row.name}" đang bán. Bạn đã xem kỹ ${urls.length} ảnh đã chọn và thấy đúng sản phẩm?`,
        confirmLabel: 'Dùng ảnh này',
      });
      if (!ok) return;
    }
    act.mutate({ kind: 'approve', row, urls });
  };

  return (
    <section aria-label="Ứng viên ảnh từ WordPress" className="space-y-3 rounded-card border border-stone-200 bg-stone-0 p-3">
      {dialog}
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex min-h-[44px] items-center text-left text-sm font-medium text-forest-700 underline sm:min-h-0">
        {open ? 'Ẩn' : 'Xem'} ứng viên ảnh từ WordPress cũ
      </button>
      {open && (
        <div className="space-y-3">
          <p className="text-xs text-stone-600">
            Sản phẩm đang bán chưa có ảnh mà trang WordPress cũ (tubutree.com) có ảnh gần giống. Duyệt thì ảnh được tải về và lưu vào sản phẩm, không dẫn link sang
            WordPress, nên tắt WordPress ảnh vẫn còn. Chỉ nhóm “Chắc chắn cùng sản phẩm” là cùng sản phẩm; các nhóm còn lại phải đối chiếu bao bì trước khi duyệt.
          </p>
          {list.isLoading && <ListSkeleton label="Đang hỏi WordPress" rows={3} className="h-24" />}
          {list.isError && (
            <p role="alert" className="text-sm text-danger-fg">
              {errText(list.error, 'Không tải được danh sách ứng viên.')}{' '}
              <button type="button" onClick={() => void list.refetch()} className="min-h-[44px] font-medium underline sm:min-h-0">
                Thử lại
              </button>
            </p>
          )}
          {inlineMsg && <Notice tone={inlineMsg.ok ? 'success' : 'danger'} role={inlineMsg.ok ? 'status' : 'alert'}>{inlineMsg.text}</Notice>}
          {list.isSuccess && pending.length === 0 && (
            <p className="rounded-card border border-stone-200 p-4 text-center text-sm text-stone-500">Không còn sản phẩm nào chờ duyệt ảnh từ WordPress.</p>
          )}

          <ul className="space-y-2">
            {pending.map((row) => (
              <CandidateRow key={row.productId} row={row} selected={selectionFor(row)} busy={act.isPending} onToggle={(u) => toggle(row, u)} onApprove={() => void approve(row)} onSkip={() => act.mutate({ kind: 'skip', row })} />
            ))}
          </ul>

          {applied.length > 0 && (
            <p className="text-xs text-stone-600">
              Đã nạp ảnh: {applied.map((r) => `${r.name} (${r.appliedCount ?? '?'} ảnh)`).join(', ')}.
            </p>
          )}
          {hasImages > 0 && <p className="text-xs text-stone-500">{hasImages} sản phẩm trong danh sách đã có ảnh nên không hiện ở đây.</p>}

          {skipped.length > 0 && (
            <div className="space-y-2">
              <button type="button" aria-expanded={showSkipped} onClick={() => setShowSkipped((v) => !v)} className="inline-flex min-h-[44px] items-center text-sm font-medium text-forest-700 underline sm:min-h-0">
                {showSkipped ? 'Ẩn' : 'Xem'} {skipped.length} sản phẩm đã bỏ qua
              </button>
              {showSkipped && (
                <ul className="space-y-1">
                  {skipped.map((r) => (
                    <li key={r.productId} className="flex flex-wrap items-center gap-2 text-sm text-stone-700">
                      <span className="break-words">{r.name}</span>
                      <button type="button" disabled={act.isPending} onClick={() => act.mutate({ kind: 'restore', row: r })} aria-label={`Xem lại ${r.name}`} className={`${BTN_XS_SECONDARY} ml-auto`}>
                        Xem lại
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CandidateRow({
  row,
  selected,
  busy,
  onToggle,
  onApprove,
  onSkip,
}: {
  row: WpImageRow;
  selected: string[];
  busy: boolean;
  onToggle: (url: string) => void;
  onApprove: () => void;
  onSkip: () => void;
}) {
  const sources = row.wp ?? [];
  const usable = sources.some((s) => s.imageUrls.length > 0);
  return (
    <li className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-words text-sm font-medium text-stone-900">{row.name}</span>
        <ToneBadge tone={WP_TIER_TONE[row.tier]}>{row.tierLabel}</ToneBadge>
        {!row.isActive && <ToneBadge tone="neutral">Đang tắt</ToneBadge>}
      </div>
      {row.variations.length > 0 && <p className="text-xs text-stone-600">Phân loại: {row.variations.join(', ')}</p>}
      <p className="text-xs text-stone-600">{row.note}</p>
      {sources.map((s) => (
        <div key={s.slug} className="space-y-1">
          <p className="break-words text-xs text-stone-700">WordPress: {s.name ?? s.slug}</p>
          {s.error && <Notice tone="warning" role="status">{s.error}</Notice>}
          {s.imageUrls.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {s.imageUrls.map((url, i) => (
                <li key={url}>
                  <label className="flex w-24 flex-col items-center gap-1 text-xs text-stone-600">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img key={url} src={url} alt={`Ảnh ${i + 1} của "${s.name ?? s.slug}" ở WordPress`} loading="lazy" referrerPolicy="no-referrer" onError={hideBrokenImage} className="h-24 w-24 rounded-control border border-stone-200 object-cover" />
                    <span className="inline-flex min-h-[44px] items-center gap-1 sm:min-h-0">
                      <input type="checkbox" checked={selected.includes(url)} disabled={busy} onChange={() => onToggle(url)} aria-label={`Dùng ảnh ${i + 1} của ${s.name ?? s.slug}`} />
                      Dùng
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !usable || selected.length === 0} onClick={onApprove} aria-label={`Duyệt dùng ${selected.length} ảnh cho ${row.name}`} className={BTN_XS_PRIMARY}>
          Duyệt dùng {selected.length} ảnh
        </button>
        <button type="button" disabled={busy} onClick={onSkip} aria-label={`Bỏ qua ${row.name}`} className={BTN_XS_SECONDARY}>
          Bỏ qua
        </button>
      </div>
    </li>
  );
}
