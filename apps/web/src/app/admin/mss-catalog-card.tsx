'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BTN_SECONDARY, Notice, ToneBadge } from '@/components/admin/ui';
import { actionErrorText } from '@/lib/admin-error-text';
import {
  getMssCatalog,
  pullMssCatalog,
  type MssCatalogOpsCard as Card,
  type MssCatalogSkipReason,
  type MssCatalogTrimReason,
  type MssStockSkipReason,
} from '@/lib/admin-client';
import { formatDateTime } from '@/lib/format-date';
import type { Tone } from '@/lib/recycling';

const QUERY_KEY = ['admin-mss-catalog'];

export const SKIP_LABEL: Record<MssCatalogSkipReason, string> = {
  invalid_doc: 'Tài liệu sai lược đồ',
  no_pancake_id: 'Thiếu mã Pancake',
  unknown_product: 'Sản phẩm chưa có trên Tubu',
  stale_version: 'Bản cũ hơn bản đã có',
  not_found: 'MSS không còn sản phẩm',
  apply_failed: 'Ghi vào Tubu bị lỗi',
};

export const TRIM_LABEL: Record<MssCatalogTrimReason, string> = {
  media_rejected: 'Ảnh/video ngoài host cho phép',
  html_emptied: 'Mô tả HTML rỗng sau khi lọc',
  string_truncated: 'Chữ quá dài, đã cắt',
  array_truncated: 'Danh sách quá dài, đã cắt',
  story_rejected: 'Câu chuyện sản phẩm sai dạng hoặc ảnh ngoài host, đã bỏ',
  eco_fact_rejected: 'Nhãn xanh sai dạng hoặc thiếu nguồn https, đã bỏ',
  unknown_category_slug: 'Danh mục lạ, đã bỏ',
};

export const STOCK_SKIP_LABEL: Record<MssStockSkipReason, string> = {
  unknown_variation: 'Biến thể chưa có trên Tubu',
  stale: 'Đọc trước số Tubu đã có',
  too_old: 'Đọc quá 60 phút trước',
  clock_skew: 'Giờ MSS lệch quá 5 phút',
};

const TRIGGER_LABEL: Record<NonNullable<Card['lastTrigger']>, string> = {
  cron: 'theo lịch 30 phút',
  full: 'kéo toàn bộ ban đêm',
  doorbell: 'MSS báo có đổi',
  admin: 'quản trị bấm kéo',
};

const STATUS_BADGE: Record<NonNullable<Card['lastStatus']>, { tone: Tone; label: string }> = {
  ok: { tone: 'success', label: 'Xong' },
  partial: { tone: 'warning', label: 'Xong một phần' },
  failed: { tone: 'danger', label: 'Lỗi' },
  skipped: { tone: 'neutral', label: 'Bỏ qua' },
};

function stateBadge(card: Card): { tone: Tone; label: string } {
  if (!card.enabled) return { tone: 'neutral', label: 'Tắt' };
  if (!card.effective) return { tone: 'warning', label: 'Chưa có hiệu lực' };
  if (card.lastStatus === 'failed') return { tone: 'danger', label: 'Lần kéo lỗi' };
  return { tone: 'success', label: 'Đang chạy' };
}

/** Lý do có số đếm > 0, theo thứ tự nhãn; lý do API mới chưa có nhãn thì hiện mã gốc. */
function reasonRows<K extends string>(counts: Partial<Record<K, number>> | undefined, labels: Record<K, string>): [string, number][] {
  return Object.entries(counts ?? {})
    .filter((e): e is [K, number] => typeof e[1] === 'number' && e[1] > 0)
    .map(([k, n]) => [labels[k] ?? k, n]);
}

/**
 * Thẻ "Nội dung từ MSS" ở tab Sức khoẻ hệ thống (chỉ ADMIN): lần kéo gần nhất, số sản phẩm đang có nội dung bổ sung, số bị bỏ qua/cắt theo lý do,
 * mã chuông đang chờ, lỗi gần nhất và nút "Kéo lại ngay" (xếp một lượt kéo toàn bộ). Cờ tắt thì PDP vẫn dùng nội dung của Tubu.
 */
export function MssCatalogCard() {
  const q = useQuery({ queryKey: QUERY_KEY, queryFn: getMssCatalog });
  if (q.isPending) return null;
  const badge = q.data ? stateBadge(q.data) : null;
  return (
    <section aria-labelledby="mss-catalog-title" className="mt-4 rounded-card border border-stone-200 bg-stone-0 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="mss-catalog-title" className="m-0 font-display text-lg font-semibold text-stone-900">
          Nội dung từ MSS
        </h2>
        {badge && <ToneBadge tone={badge.tone}>{badge.label}</ToneBadge>}
      </div>
      {q.data ? (
        <CardBody card={q.data} />
      ) : (
        <p role="status" className="mt-2 max-w-2xl text-sm text-stone-600">
          Không đọc được trạng thái nội dung từ MSS. Các phần khác của màn này không bị ảnh hưởng.
        </p>
      )}
    </section>
  );
}

function CardBody({ card }: { card: Card }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const pull = useMutation({
    mutationFn: pullMssCatalog,
    onSuccess: () => {
      setMsg({ tone: 'success', text: 'Đã xếp một lượt kéo toàn bộ. Số liệu đổi sau khi lượt kéo chạy xong.' });
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e) => setMsg({ tone: 'danger', text: actionErrorText(e) }),
  });
  const stats = card.lastStats;
  const skipped = reasonRows(stats?.skipped, SKIP_LABEL);
  const trimmed = reasonRows(stats?.trimmed, TRIM_LABEL);
  const status = card.lastStatus ? STATUS_BADGE[card.lastStatus] : null;

  return (
    <div className="mt-2 space-y-3 text-sm">
      <p className="max-w-2xl text-stone-600">
        {!card.enabled
          ? 'Cờ mss.catalog_enrichment_enabled đang tắt: trang sản phẩm dùng nội dung của Tubu, không kéo gì từ MSS.'
          : !card.effective
            ? 'Cờ đã bật nhưng thiếu biến môi trường MSS hoặc MSS chưa công bố năng lực catalog.enrichment: chưa kéo và chưa ghép nội dung nào.'
            : 'Tên, mô tả, ảnh, video, thành phần do MSS soạn được ghép vào trang sản phẩm (trường MSS để trống thì giữ của Tubu). Giá và tồn vẫn theo Pancake.'}
      </p>

      <dl aria-label="Số sản phẩm có nội dung MSS" className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ['Đang có nội dung bổ sung', card.published],
            ['MSS đã gỡ xuất bản', card.unpublished],
            ['MSS đã xoá', card.removed],
            ['Mã chờ kéo', card.pending ?? '—'],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="rounded-control border border-stone-200 px-3 py-2">
            <dt className="text-xs text-stone-600">{label}</dt>
            <dd className="m-0 font-semibold tabular-nums text-stone-900">{n}</dd>
          </div>
        ))}
      </dl>

      <div data-testid="mss-catalog-last-run" className="space-y-1 text-stone-700">
        {card.lastRunAt ? (
          <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              Lần kéo gần nhất: <span className="tabular-nums">{formatDateTime(card.lastRunAt)}</span>
              {card.lastTrigger && <span> ({TRIGGER_LABEL[card.lastTrigger] ?? card.lastTrigger})</span>}
            </span>
            {status && <ToneBadge tone={status.tone}>{status.label}</ToneBadge>}
          </p>
        ) : (
          <p className="m-0">Chưa kéo lần nào.</p>
        )}
        {stats && (
          <p className="m-0 tabular-nums text-stone-600">
            Nhận {stats.received}, ghép {stats.applied}, không đổi {stats.unchanged} ({stats.kind === 'full' ? 'toàn bộ' : stats.kind === 'ids' ? 'theo chuông' : 'theo mốc'}, {stats.pages} trang)
          </p>
        )}
        {card.lastFullAt && (
          <p className="m-0 text-stone-600">
            Kéo toàn bộ gần nhất: <span className="tabular-nums">{formatDateTime(card.lastFullAt)}</span>
          </p>
        )}
      </div>

      {(skipped.length > 0 || trimmed.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {skipped.length > 0 && <ReasonList title="Bị bỏ qua ở lần kéo gần nhất" rows={skipped} />}
          {trimmed.length > 0 && <ReasonList title="Bị cắt hoặc lọc bớt" rows={trimmed} />}
        </div>
      )}

      {card.lastError && (
        <Notice tone="danger">
          <span className="break-all">Lỗi gần nhất: {card.lastError}</span>
        </Notice>
      )}

      <PushSummary card={card} />

      <button type="button" className={BTN_SECONDARY} disabled={pull.isPending} onClick={() => pull.mutate()}>
        {pull.isPending ? 'Đang xếp lượt kéo…' : 'Kéo lại ngay'}
      </button>
      {msg && (
        <Notice tone={msg.tone} role={msg.tone === 'danger' ? 'alert' : 'status'}>
          {msg.text}
        </Notice>
      )}
    </div>
  );
}

function stockBadge(flag: Card['stockSync']): { tone: Tone; label: string } {
  if (!flag?.enabled) return { tone: 'neutral', label: 'Tắt' };
  if (!flag.effective) return { tone: 'warning', label: 'Chưa có hiệu lực' };
  return { tone: 'success', label: 'Đang nhận' };
}

/**
 * Lần MSS ĐẨY gần nhất (`POST /api/integrations/mss/catalog-sync`): nội dung theo cờ của thẻ này, tồn theo cờ mss.stock_sync_enabled.
 * Chỉ dòng có số; lần đẩy có phần bị bỏ vì cờ tắt thì nói rõ để admin không tưởng tồn đã cập nhật.
 */
function PushSummary({ card }: { card: Card }) {
  const push = card.push ?? null;
  const flag = stockBadge(card.stockSync);
  const st = push?.stats ?? null;
  const status = push?.status ? STATUS_BADGE[push.status] : null;
  const stockSkipped = reasonRows(st?.stock.skipped, STOCK_SKIP_LABEL);
  return (
    <div data-testid="mss-catalog-push" className="space-y-1 border-t border-stone-200 pt-3 text-stone-700">
      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>Tồn kho MSS đẩy sang (mss.stock_sync_enabled):</span>
        <ToneBadge tone={flag.tone}>{flag.label}</ToneBadge>
      </p>
      {push?.at ? (
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            Lần MSS đẩy gần nhất: <span className="tabular-nums">{formatDateTime(push.at)}</span>
          </span>
          {status && <ToneBadge tone={status.tone}>{status.label}</ToneBadge>}
        </p>
      ) : (
        <p className="m-0">MSS chưa đẩy lần nào.</p>
      )}
      {st && st.products.status !== 'none' && (
        <p className="m-0 tabular-nums text-stone-600">
          {st.products.status === 'disabled'
            ? `Nội dung: bỏ qua ${st.products.received} tài liệu vì cờ chưa có hiệu lực`
            : `Nội dung: nhận ${st.products.received}, ghép ${st.products.applied}, không đổi ${st.products.unchanged}`}
          {st.products.eco_proposed > 0 && `, ${st.products.eco_proposed} nhãn xanh nháp chờ duyệt ở Sự thật xanh`}
        </p>
      )}
      {st && st.stock.status !== 'none' && (
        <p className="m-0 tabular-nums text-stone-600">
          {st.stock.status === 'disabled'
            ? `Tồn: bỏ qua ${st.stock.received} dòng vì cờ chưa có hiệu lực`
            : `Tồn: nhận ${st.stock.received}, áp ${st.stock.applied}, vừa hết hàng ${st.stock.out_of_stock}, vừa về hàng ${st.stock.back_in_stock}${
                st.stock.restock_waiting > 0 ? ` (${st.stock.restock_waiting} khách chờ báo hàng về)` : ''
              }${st.stock.invalid > 0 ? `, ${st.stock.invalid} dòng sai dạng` : ''}`}
        </p>
      )}
      {st && st.deferred.bundles > 0 && <p className="m-0 tabular-nums text-stone-600">Combo MSS gửi kèm chưa áp: {st.deferred.bundles}</p>}
      {stockSkipped.length > 0 && <ReasonList title="Dòng tồn bị bỏ ở lần đẩy gần nhất" rows={stockSkipped} />}
      {push?.error && (
        <Notice tone="danger">
          <span className="break-all">Lỗi lần đẩy gần nhất: {push.error}</span>
        </Notice>
      )}
    </div>
  );
}

function ReasonList({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <div className="min-w-0">
      <h3 className="m-0 text-xs font-semibold text-stone-700">{title}</h3>
      <ul aria-label={title} className="m-0 mt-1 list-none divide-y divide-stone-200 rounded-control border border-stone-200 p-0">
        {rows.map(([label, n]) => (
          <li key={label} className="flex items-center justify-between gap-3 px-3 py-1.5">
            <span className="min-w-0 break-words text-stone-700">{label}</span>
            <span className="shrink-0 font-semibold tabular-nums text-stone-900">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
