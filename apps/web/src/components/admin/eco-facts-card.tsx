'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { actionErrorText, loadErrorText } from '@/lib/admin-error-text';
import { formatVnNumber } from '@tubutree/app-core/number-format';
import { formatDateTime } from '@/lib/format-date';
import type { Tone } from '@/lib/recycling';
import type { AdminProductHit } from '@/lib/admin-client';
import { useConfirm } from '@/components/admin/confirm-dialog';
import { ProductPicker } from '@/components/admin/product-picker';
import type { PickedItem } from '@/components/admin/search-picker';
import { useToastedMessage, type AdminMsg } from '@/components/admin/admin-toast';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_XS_DANGER, BTN_XS_PRIMARY, BTN_XS_SECONDARY, Field, INPUT_CLASS, ListSkeleton, LoadError, Notice, ToneBadge, chipClass } from '@/components/admin/ui';
import {
  ECO_APPROVE_BATCH_MAX,
  ECO_FIELD_MAX,
  ECO_KINDS,
  ECO_KIND_LABEL,
  ECO_STATUS_LABEL,
  EMPTY_FORM,
  approveEcoFact,
  approveEcoFactsBatch,
  createEcoFact,
  createRefillDrafts,
  formOf,
  importEcoFacts,
  listEcoFacts,
  retireEcoFact,
  updateEcoFact,
  type AdminEcoFact,
  type EcoFactForm,
  type EcoFactStatus,
  type EcoImportResult,
  type EcoRefillDraftResult,
} from './eco-facts-api';

type Filter = EcoFactStatus | 'ALL';
const FILTERS: Filter[] = ['DRAFT', 'APPROVED', 'RETIRED', 'ALL'];
const FILTER_LABEL: Record<Filter, string> = { ...ECO_STATUS_LABEL, ALL: 'Tất cả' };
const STATUS_TONE: Record<EcoFactStatus, Tone> = { DRAFT: 'warning', APPROVED: 'success', RETIRED: 'neutral' };
const KEY = ['admin', 'eco-facts'] as const;

/**
 * Thẻ "Sự thật xanh": danh sách theo trạng thái, form thêm/sửa (chọn sản phẩm và phân loại bằng ô tìm, không gõ slug/SKU), nhập CSV, tạo nháp
 * từ danh sách Refill, nút duyệt từng dòng và duyệt hàng loạt. Mọi dòng thêm, sửa, nhập hay tạo nháp đều là nháp; chỉ dòng "Đã duyệt"
 * mới ra nhãn thẻ, khối "Điểm cộng xanh" và Hộ chiếu Xanh của khách (khi cờ bật). Máy chủ chặn duyệt khi thiếu nguồn https, ghi chú nguồn, số gam
 * hay chữ dính bộ chặn tuyên bố; thẻ hiện đúng các lý do đó cạnh dòng.
 */
export function EcoFactsCard() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('DRAFT');
  const [editing, setEditing] = useState<AdminEcoFact | 'new' | null>(null);
  const [msg, setMsg] = useState<AdminMsg | null>(null);
  const shown = useToastedMessage(msg);
  const { confirm, dialog } = useConfirm();
  const q = useQuery({ queryKey: [...KEY, filter], queryFn: () => listEcoFacts(filter) });
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  // id → `updatedAt` lúc tích chọn: dòng bị người khác sửa sau đó tự rơi khỏi lô thay vì được duyệt với nội dung admin chưa xem.
  const [selected, setSelected] = useState<ReadonlyMap<string, string>>(new Map());

  const act = useMutation({
    mutationFn: async ({ kind, row }: { kind: 'approve' | 'retire'; row: AdminEcoFact }) => (kind === 'approve' ? approveEcoFact(row) : retireEcoFact(row.id)),
    onSuccess: (_r, v) => {
      setMsg({ ok: true, text: v.kind === 'approve' ? 'Đã duyệt. Khách thấy sự thật này khi cờ nhãn xanh bật.' : 'Đã ngừng dùng sự thật này.' });
      void refresh();
    },
    onError: (e) => {
      setMsg({ ok: false, text: actionErrorText(e) });
      void refresh();
    },
  });

  const items = q.data?.items ?? [];
  // Chỉ dòng Nháp không còn blocker mới chọn được; máy chủ vẫn kiểm lại từng dòng lúc duyệt.
  const approvable = items.filter((r) => r.status === 'DRAFT' && r.blockers.length === 0);
  const chosen = approvable.filter((r) => selected.get(r.id) === r.updatedAt);
  const capped = approvable.length > ECO_APPROVE_BATCH_MAX;
  const allChosen = approvable.length > 0 && chosen.length === Math.min(approvable.length, ECO_APPROVE_BATCH_MAX);

  const batch = useMutation({
    mutationFn: (rows: AdminEcoFact[]) => approveEcoFactsBatch(rows),
    onSuccess: (r) => {
      setSelected(new Map());
      setMsg({
        ok: r.skipped.length === 0,
        text:
          r.skipped.length === 0
            ? `Đã duyệt ${r.approved.length} dòng. Khách thấy khi cờ nhãn xanh bật.`
            : `Đã duyệt ${r.approved.length} dòng, bỏ qua ${r.skipped.length} (vừa đổi hoặc chưa đủ điều kiện): ${r.skipped[0]!.message}`,
      });
      void refresh();
    },
    onError: (e) => {
      setMsg({ ok: false, text: actionErrorText(e) });
      void refresh();
    },
  });

  const toggle = (row: AdminEcoFact) =>
    setSelected((prev) => {
      const next = new Map([...prev].filter(([id, at]) => approvable.some((r) => r.id === id && r.updatedAt === at)));
      if (next.has(row.id)) next.delete(row.id);
      else if (next.size < ECO_APPROVE_BATCH_MAX) next.set(row.id, row.updatedAt);
      return next;
    });
  const toggleAll = () => setSelected(allChosen ? new Map() : new Map(approvable.slice(0, ECO_APPROVE_BATCH_MAX).map((r) => [r.id, r.updatedAt])));

  const approveChosen = async () => {
    if (chosen.length === 0 || batch.isPending) return;
    const ok = await confirm({
      title: `Duyệt ${chosen.length} sự thật?`,
      message: 'Khách thấy các dòng này ở nhãn thẻ và trang sản phẩm khi cờ eco.product_badges_enabled bật, ở Hộ chiếu Xanh khi cờ eco.passport_enabled bật; hai cờ không đổi ở đây.\nMáy chủ kiểm lại từng dòng và bỏ qua dòng vừa đổi hay chưa đủ điều kiện.',
      confirmLabel: `Duyệt ${chosen.length} dòng`,
    });
    if (ok) batch.mutate(chosen);
  };

  const retire = async (row: AdminEcoFact) => {
    const ok = await confirm({
      title: 'Ngừng dùng sự thật này?',
      message: `${row.productName}: ${ECO_KIND_LABEL[row.kind]}.\nKhách không còn thấy dòng này. Muốn dùng lại thì sửa rồi duyệt lại.`,
      confirmLabel: 'Ngừng dùng',
      tone: 'danger',
    });
    if (ok) act.mutate({ kind: 'retire', row });
  };

  return (
    <section data-testid="eco-facts-card" className="space-y-4">
      {dialog}
      {shown && (
        <Notice tone={shown.ok ? 'success' : 'danger'} role={shown.ok ? 'status' : 'alert'}>
          {shown.text}
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            className={chipClass(filter === f)}
            onClick={() => {
              setFilter(f);
              setSelected(new Map());
            }}
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
        <button type="button" className={`${BTN_PRIMARY} ml-auto`} onClick={() => setEditing('new')}>
          Thêm sự thật
        </button>
      </div>

      {editing && (
        <FactForm
          key={editing === 'new' ? 'new' : editing.id}
          row={editing === 'new' ? null : editing}
          onDone={(text) => {
            setEditing(null);
            setMsg({ ok: true, text });
            void refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      <CsvImport onDone={() => void refresh()} />
      <RefillDrafts
        onDone={() => {
          setFilter('DRAFT');
          void refresh();
        }}
      />

      {q.isPending ? (
        <ListSkeleton label="Đang tải sự thật xanh" />
      ) : q.isError ? (
        <LoadError message={loadErrorText(q.error)} onRetry={() => q.refetch()} retrying={q.isFetching} />
      ) : q.data.items.length === 0 ? (
        <p className="rounded-card border border-dashed border-stone-300 p-4 text-sm text-stone-600">Chưa có dòng nào ở mục này.</p>
      ) : (
        <>
          {approvable.length > 0 && (
            <div data-testid="eco-batch-bar" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-stone-200 bg-stone-0 px-3 py-1 text-sm">
              <label className="flex min-h-[44px] cursor-pointer items-center gap-2 sm:min-h-[36px]">
                <input type="checkbox" className="h-4 w-4" checked={allChosen} onChange={toggleAll} disabled={batch.isPending} />
                <span>{capped ? `Chọn ${ECO_APPROVE_BATCH_MAX} dòng đầu đủ điều kiện` : `Chọn tất cả đủ điều kiện (${approvable.length})`}</span>
              </label>
              <button
                type="button"
                className={`${BTN_XS_PRIMARY} ml-auto`}
                disabled={chosen.length === 0 || batch.isPending}
                aria-busy={batch.isPending || undefined}
                onClick={() => void approveChosen()}
              >
                {`Duyệt ${chosen.length} dòng đã chọn`}
              </button>
            </div>
          )}
          <ul className="space-y-2">
            {q.data.items.map((row) => (
              <FactRow
                key={row.id}
                row={row}
                busy={(act.isPending && act.variables?.row.id === row.id) || batch.isPending}
                selectable={row.status === 'DRAFT' && row.blockers.length === 0}
                selected={selected.get(row.id) === row.updatedAt}
                selectDisabled={selected.get(row.id) !== row.updatedAt && chosen.length >= ECO_APPROVE_BATCH_MAX}
                onSelect={() => toggle(row)}
                onEdit={() => setEditing(row)}
                onApprove={() => act.mutate({ kind: 'approve', row })}
                onRetire={() => void retire(row)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function FactRow({
  row,
  busy,
  selectable,
  selected,
  selectDisabled,
  onSelect,
  onEdit,
  onApprove,
  onRetire,
}: {
  row: AdminEcoFact;
  busy: boolean;
  selectable: boolean;
  selected: boolean;
  selectDisabled: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onApprove: () => void;
  onRetire: () => void;
}) {
  const blocked = row.blockers.length > 0;
  // Nháp Giảm nhựa chưa có số gam: dòng sinh từ danh sách Refill đứng ở đây tới khi có người cân vỏ và điền số.
  const awaitingWeight = row.status === 'DRAFT' && row.kind === 'PLASTIC_AVOIDED' && row.valueGrams == null;
  return (
    <li data-testid="eco-fact-row" data-status={row.status} className="rounded-card border border-stone-200 bg-stone-0 p-3 text-sm">
      <div className="flex items-start gap-2">
        {selectable && (
          <label className="-m-1 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center sm:h-9 sm:w-9">
            <input
              type="checkbox"
              className="h-4 w-4"
              aria-label={`Chọn để duyệt: ${row.productName}${row.variationName ? ` · ${row.variationName}` : ''}, ${ECO_KIND_LABEL[row.kind]}`}
              checked={selected}
              disabled={busy || selectDisabled}
              onChange={onSelect}
            />
          </label>
        )}
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold text-stone-900">
            {row.productName}
            {row.variationName ? <span className="font-normal text-stone-600"> · {row.variationName}</span> : null}
          </p>
          <p className="text-xs text-stone-600">{ECO_KIND_LABEL[row.kind]}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <ToneBadge tone={STATUS_TONE[row.status]}>{ECO_STATUS_LABEL[row.status]}</ToneBadge>
          {awaitingWeight && <ToneBadge tone="warning">Chờ cân</ToneBadge>}
        </div>
      </div>
      <dl className="mt-2 grid gap-1 text-xs text-stone-700 sm:grid-cols-2">
        {row.valueGrams != null && <Pair label="Gam nhựa giảm mỗi món">{`${formatVnNumber(row.valueGrams)} g`}</Pair>}
        {row.baselineText && <Pair label="Mốc so sánh">{row.baselineText}</Pair>}
        {row.label && <Pair label="Chữ hiển thị">{row.label}</Pair>}
        {row.co2Grams != null && <Pair label="CO₂ (gam)">{formatVnNumber(row.co2Grams)}</Pair>}
        <Pair label="Nguồn">
          {row.sourceUrl ? (
            <>
              <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-forest-700 underline">
                {row.sourceUrl}
              </a>
              {row.sourceKind === 'internal_sheet' && <span className="ml-1 whitespace-nowrap rounded-control bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-700">Phiếu cân nội bộ</span>}
            </>
          ) : (
            '—'
          )}
        </Pair>
        <Pair label="Ghi chú nguồn">{row.sourceNote || '—'}</Pair>
        {row.approvedAt && <Pair label="Duyệt lúc">{formatDateTime(row.approvedAt)}</Pair>}
      </dl>
      {blocked && row.status !== 'APPROVED' && (
        <div className="mt-2">
          <Notice tone="warning">
            <span className="font-semibold">Chưa duyệt được:</span> {row.blockers.map((b) => b.message).join(' ')}
          </Notice>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={BTN_XS_SECONDARY} onClick={onEdit} disabled={busy}>
          Sửa
        </button>
        {row.status !== 'APPROVED' && (
          <button type="button" className={BTN_XS_PRIMARY} onClick={onApprove} disabled={busy || blocked} aria-busy={busy || undefined}>
            Duyệt
          </button>
        )}
        {row.status !== 'RETIRED' && (
          <button type="button" className={BTN_XS_DANGER} onClick={onRetire} disabled={busy}>
            Ngừng dùng
          </button>
        )}
      </div>
    </li>
  );
}

function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="inline font-medium text-stone-600">{label}: </dt>
      <dd className="inline break-words">{children}</dd>
    </div>
  );
}

function FactForm({ row, onDone, onCancel }: { row: AdminEcoFact | null; onDone: (text: string) => void; onCancel: () => void }) {
  const [form, setForm] = useState<EcoFactForm>(row ? formOf(row) : EMPTY_FORM);
  const [picked, setPicked] = useState<PickedItem | null>(null);
  const [hit, setHit] = useState<AdminProductHit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof EcoFactForm>(k: K, v: EcoFactForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: () => (row ? updateEcoFact(row.id, form, row.updatedAt) : createEcoFact(form)),
    onSuccess: (saved) => onDone(row && row.status === 'APPROVED' && saved.status === 'DRAFT' ? 'Đã lưu. Dòng về nháp, cần duyệt lại.' : 'Đã lưu bản nháp.'),
    onError: (e) => setError(actionErrorText(e)),
  });
  const locked = row !== null;
  return (
    <form
      data-testid="eco-fact-form"
      className="space-y-3 rounded-card border border-stone-200 bg-stone-0 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (save.isPending) return;
        if (!row && !form.productSlug) {
          setError('Chọn sản phẩm trước khi lưu.');
          return;
        }
        setError(null);
        save.mutate();
      }}
    >
      <p className="text-sm font-semibold text-stone-900">{row ? 'Sửa sự thật' : 'Thêm sự thật (lưu là nháp)'}</p>
      {locked && <p className="text-xs text-stone-600">Sản phẩm, phân loại và loại không đổi được: muốn đổi thì Ngừng dùng dòng này rồi thêm dòng mới.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="block text-xs sm:col-span-2" data-testid="eco-product-field">
          <span className="font-medium text-stone-700">Sản phẩm</span>
          <div className="mt-1">
            {row ? (
              <input className={INPUT_CLASS} aria-label="Sản phẩm" value={row.productName} readOnly disabled />
            ) : (
              <ProductPicker
                mode="product"
                label="Tìm sản phẩm theo tên hoặc SKU"
                value={picked}
                onChange={setPicked}
                onPickHit={(h) => {
                  setHit(h);
                  setForm((f) => ({ ...f, productSlug: h?.slug ?? '', variationSku: '' }));
                }}
              />
            )}
          </div>
        </div>
        <Field label="Phân loại" hint="Để trống: áp cho cả sản phẩm.">
          <select className={INPUT_CLASS} value={form.variationSku} onChange={(e) => set('variationSku', e.target.value)} disabled={locked || !hit}>
            {row ? (
              <option value={form.variationSku}>{row.variationName ? `${row.variationName} · ${row.variationSku}` : 'Cả sản phẩm'}</option>
            ) : (
              <>
                <option value="">Cả sản phẩm</option>
                {hit?.variations.map((v) => (
                  <option key={v.id} value={v.sku}>
                    {`${v.name} · ${v.sku}${v.isActive ? '' : ' · đang ẩn'}`}
                  </option>
                ))}
              </>
            )}
          </select>
        </Field>
        <Field label="Loại">
          <select className={INPUT_CLASS} value={form.kind} onChange={(e) => set('kind', e.target.value as EcoFactForm['kind'])} disabled={locked}>
            {ECO_KINDS.map((k) => (
              <option key={k} value={k}>
                {ECO_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        {form.kind === 'PLASTIC_AVOIDED' && (
          <Field label="Gam nhựa giảm mỗi món" hint="Số nguyên, theo nguồn bên dưới.">
            <input className={INPUT_CLASS} inputMode="numeric" value={form.valueGrams} onChange={(e) => set('valueGrams', e.target.value)} maxLength={9} />
          </Field>
        )}
        <Field label="Mốc so sánh" hint='Ví dụ: "so với 20 chai 500ml cùng loại".'>
          <input className={INPUT_CLASS} value={form.baselineText} onChange={(e) => set('baselineText', e.target.value)} maxLength={ECO_FIELD_MAX.baselineText} />
        </Field>
        <Field label="Chữ hiển thị" hint="Bắt buộc cho Giấy tờ chứng nhận và Vùng nguyên liệu.">
          <input className={INPUT_CLASS} value={form.label} onChange={(e) => set('label', e.target.value)} maxLength={ECO_FIELD_MAX.label} />
        </Field>
        <Field label="CO₂ giảm (gam)" hint="Để trống trừ khi nguồn có số CO₂ riêng.">
          <input className={INPUT_CLASS} inputMode="numeric" value={form.co2Grams} onChange={(e) => set('co2Grams', e.target.value)} maxLength={9} />
        </Field>
        <Field label="Link nguồn (https)">
          <input className={INPUT_CLASS} type="url" value={form.sourceUrl} onChange={(e) => set('sourceUrl', e.target.value)} required maxLength={ECO_FIELD_MAX.sourceUrl} />
        </Field>
        <Field label="Ghi chú nguồn" hint="Trang, bảng số hay đoạn nào trong nguồn.">
          <input className={INPUT_CLASS} value={form.sourceNote} onChange={(e) => set('sourceNote', e.target.value)} required maxLength={ECO_FIELD_MAX.sourceNote} />
        </Field>
      </div>
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={BTN_PRIMARY} disabled={save.isPending} aria-busy={save.isPending || undefined}>
          Lưu nháp
        </button>
        <button type="button" className={BTN_SECONDARY} onClick={onCancel}>
          Đóng
        </button>
      </div>
    </form>
  );
}

function CsvImport({ onDone }: { onDone: () => void }) {
  const [result, setResult] = useState<EcoImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const run = useMutation({
    mutationFn: async (f: File) => importEcoFacts(await f.text()),
    onSuccess: (r) => {
      setResult(r);
      onDone();
    },
    onError: (e) => setError(actionErrorText(e)),
  });
  return (
    <details className="rounded-card border border-stone-200 bg-stone-0 p-3 text-sm">
      <summary className="flex min-h-[44px] cursor-pointer items-center font-semibold text-stone-900">Nhập CSV (tạo hoặc sửa nháp)</summary>
      <p className="mt-2 text-xs text-stone-600">
        Cột: productSlug, variationSku, kind, valueGrams, baselineText, label, co2Grams, sourceUrl, sourceNote. Dòng đã duyệt không bị ghi đè. Mẫu ở
        docs/eco/eco-facts-draft.csv.
      </p>
      <input
        ref={file}
        type="file"
        accept=".csv,text/csv"
        className="mt-2 block text-xs"
        aria-label="Chọn file CSV sự thật xanh"
        disabled={run.isPending}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setError(null);
          setResult(null);
          run.mutate(f);
          if (file.current) file.current.value = '';
        }}
      />
      {error && (
        <div className="mt-2">
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        </div>
      )}
      {result && (
        <div className="mt-2 space-y-1" role="status">
          <Notice tone={result.errors.length > 0 ? 'warning' : 'success'}>
            {`Thêm ${result.created}, sửa ${result.updated}, bỏ qua ${result.skippedApproved} dòng đã duyệt, lỗi ${result.errors.length}.`}
          </Notice>
          {result.errors.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-danger-fg">
              {result.errors.slice(0, 20).map((e) => (
                <li key={e.line}>{`Dòng ${e.line}: ${e.message}`}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}

function RefillDrafts({ onDone }: { onDone: () => void }) {
  const [sheetUrl, setSheetUrl] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<EcoRefillDraftResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => createRefillDrafts(sheetUrl, note),
    onSuccess: (r) => {
      setResult(r);
      onDone();
    },
    onError: (e) => setError(actionErrorText(e)),
  });
  return (
    <details data-testid="eco-refill-drafts" className="rounded-card border border-stone-200 bg-stone-0 p-3 text-sm">
      <summary className="flex min-h-[44px] cursor-pointer items-center font-semibold text-stone-900">Tạo nháp từ danh sách Refill</summary>
      <form
        className="mt-2 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (run.isPending) return;
          setError(null);
          setResult(null);
          run.mutate();
        }}
      >
        <p className="text-xs text-stone-600">
          Mỗi gói Refill trong danh mục nhận một nháp Can refill và một nháp Giảm nhựa. Cả hai chưa duyệt được: Giảm nhựa thiếu số gam (cân vỏ rồi điền), Can refill thiếu nguồn (mở dòng
          bấm Sửa để điền). Link phiếu cân bên dưới chỉ gắn vào các nháp Giảm nhựa. Chạy lại không tạo trùng và không đụng dòng đã có.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Link phiếu cân nội bộ (tuỳ chọn)" hint="Trang https://tubutree.com/… , gắn vào nháp Giảm nhựa; để trống thì điền nguồn sau.">
            <input className={INPUT_CLASS} type="url" inputMode="url" placeholder="https://tubutree.com/…" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} maxLength={ECO_FIELD_MAX.sourceUrl} />
          </Field>
          <Field label="Ghi chú nguồn (tuỳ chọn)" hint="Dòng hay bảng trong phiếu cân.">
            <input className={INPUT_CLASS} value={note} onChange={(e) => setNote(e.target.value)} maxLength={ECO_FIELD_MAX.sourceNote} />
          </Field>
        </div>
        <button type="submit" className={BTN_SECONDARY} disabled={run.isPending} aria-busy={run.isPending || undefined}>
          Tạo nháp
        </button>
        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
        {result && (
          <div role="status">
            <Notice tone={result.refillProducts === 0 ? 'warning' : 'success'}>
              {result.refillProducts === 0
                ? 'Danh mục chưa có gói Refill nào.'
                : `Tạo ${result.created} nháp từ ${result.refillProducts} gói Refill, bỏ qua ${result.skippedExisting} dòng đã có. Giảm nhựa cần số gam trước khi duyệt.`}
            </Notice>
          </div>
        )}
      </form>
    </details>
  );
}
