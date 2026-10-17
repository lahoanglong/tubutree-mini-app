'use client';

import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { importDealerPrices, listDealerTiers } from '@/lib/admin-client';
import {
  RATE_IMPORT_STATUS,
  applyRateImport,
  fillMissingRates,
  formatRate,
  listCommissionRates,
  parseRateInput,
  previewRateImport,
  setProductRate,
  setVariationRate,
  type CommissionProduct,
  type CommissionVariation,
  type RateImportPreview,
  type RateImportStatus,
} from '@/lib/commission-rates';
import { formatVnd } from '@/lib/shop-client';
import { useConfirm } from './confirm-dialog';
import { DealerTierSelect } from './dealer-tier-select';
import { useDebounced } from './search-picker';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_XS_PRIMARY, BTN_XS_SECONDARY, FIELD_XS, INPUT_CLASS, Notice, ToneBadge, chipClass } from './ui';

const LIST_KEY = ['admin-commission-rates'] as const;
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * "Hoa hồng & giá sỉ" (D1-01, D3-01, D1-06): % hoa hồng CTV từng biến thể — nguồn duy nhất của hoa hồng, hàng đồng bộ từ
 * Pancake không mang % nên biến thể chưa đặt thì CTV nhận 0đ — và nhập giá sỉ theo bậc đại lý (API có sẵn, trước đây
 * không màn nào gọi). Không tự đặt mức nào: mọi mức do admin chọn.
 */
export function CommissionRatesTab() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-stone-900">Hoa hồng & giá sỉ</h2>
        <p className="mt-1 text-sm text-stone-600">
          % hoa hồng CTV tính trên số tiền khách trả cho từng dòng hàng: <strong>10 nghĩa là 10%</strong>. Biến thể chưa có % thì CTV
          nhận 0đ cho dòng đó; đặt 0% khi cố ý không trả hoa hồng.
        </p>
      </div>
      <RateList />
      <RateCsvImport />
      <DealerPriceImport />
    </div>
  );
}

function RateList() {
  const [typed, setTyped] = useState('');
  const [missingOnly, setMissingOnly] = useState(true);
  const q = useDebounced(typed.trim(), 300);
  const list = useInfiniteQuery({
    queryKey: [...LIST_KEY, q, missingOnly],
    queryFn: ({ pageParam }) => listCommissionRates({ q, missing: missingOnly, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const tiers = useQuery({ queryKey: ['admin-dealer-tiers'], queryFn: listDealerTiers, staleTime: 60_000 });
  const tierNames = useMemo(() => new Map((tiers.data ?? []).map((t) => [t.id, t.name])), [tiers.data]);
  const first = list.data?.pages[0];
  const products = list.data?.pages.flatMap((p) => p.items) ?? [];
  const maxRate = first?.maxRate ?? 50;

  return (
    <section aria-label="% hoa hồng theo sản phẩm" className="space-y-3">
      {first && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span className={first.summary.missing > 0 ? 'font-semibold text-warning-fg' : 'text-success-fg'}>
            {first.summary.missing > 0
              ? `${first.summary.missing} biến thể đang bán chưa có % (CTV nhận 0đ)`
              : 'Mọi biến thể đang bán đã có %'}
          </span>
          <span className="text-xs text-stone-500">Trần mỗi biến thể: {formatRate(maxRate)} (cấu hình affiliate.max_rate_pct)</span>
        </div>
      )}
      {first && <FillMissing missingTubu={first.summary.missingTubu} maxRate={maxRate} />}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Tìm theo tên sản phẩm hoặc SKU"
          placeholder="Tìm tên sản phẩm hoặc SKU"
          maxLength={64}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className={`${FIELD_XS} w-full sm:w-72`}
        />
        <button type="button" aria-pressed={missingOnly} onClick={() => setMissingOnly((v) => !v)} className={chipClass(missingOnly)}>
          Chỉ SP còn biến thể chưa có %
        </button>
      </div>

      {list.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-danger-fg">
          {errText(list.error, 'Không tải được danh sách sản phẩm.')}{' '}
          <button type="button" onClick={() => void list.refetch()} className="min-h-[44px] font-medium underline sm:min-h-0">
            Thử lại
          </button>
        </p>
      )}
      {list.isSuccess && products.length === 0 && (
        <p className="rounded-card border border-stone-200 bg-stone-0 p-6 text-center text-sm text-stone-500">
          {q ? `Không có sản phẩm nào khớp "${q}".` : missingOnly ? 'Không còn sản phẩm nào thiếu % hoa hồng.' : 'Chưa có sản phẩm nào.'}
        </p>
      )}
      <ul className="space-y-3">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} maxRate={maxRate} tierNames={tierNames} />
        ))}
      </ul>
      {list.hasNextPage && (
        <div className="text-center">
          <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className={BTN_SECONDARY}>
            {list.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
          </button>
          {list.isFetchNextPageError && <p className="mt-1 text-xs text-danger-fg">Không tải thêm được, thử lại.</p>}
        </div>
      )}
    </section>
  );
}

function FillMissing({ missingTubu, maxRate }: { missingTubu: number; maxRate: number }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const mut = useMutation({
    mutationFn: (rate: number) => fillMissingRates(rate),
    onSuccess: (r) => {
      setMsg({ ok: true, text: `Đã đặt ${formatRate(r.affiliateRate)} cho ${r.updated} biến thể.` });
      setText('');
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
    onError: (e) => setMsg({ ok: false, text: errText(e, 'Không áp được %.') }),
  });
  if (missingTubu === 0 && !msg) return null;

  const onApply = async () => {
    const parsed = parseRateInput(text, maxRate);
    if ('error' in parsed) return setMsg({ ok: false, text: parsed.error });
    setMsg(null);
    const ok = await confirm({
      title: 'Áp % cho biến thể chưa có %',
      message:
        `Đặt ${formatRate(parsed.rate)} cho ${missingTubu} biến thể đang bán chưa có % của hàng Tubu?\n\n` +
        'Biến thể đã có % (kể cả 0%) và hàng của gian hàng đối tác giữ nguyên. Đơn đặt từ lúc này tính hoa hồng theo mức mới.',
      confirmLabel: `Áp ${formatRate(parsed.rate)}`,
    });
    if (ok && !mut.isPending) mut.mutate(parsed.rate);
  };

  return (
    <div className="rounded-card border border-warning-fg bg-warning-bg p-3">
      {missingTubu > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-stone-800">
          <span className="min-w-0">Áp một mức cho {missingTubu} biến thể hàng Tubu chưa có %:</span>
          <input
            inputMode="decimal"
            aria-label="% áp cho biến thể chưa có %"
            placeholder="vd 10"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={mut.isPending}
            className={`${FIELD_XS} w-20`}
          />
          <span aria-hidden="true">%</span>
          <button type="button" onClick={onApply} disabled={mut.isPending || !text.trim()} className={BTN_XS_PRIMARY}>
            {mut.isPending ? 'Đang áp…' : 'Áp dụng'}
          </button>
        </div>
      )}
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`mt-1 text-xs ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
          {msg.text}
        </p>
      )}
      {dialog}
    </div>
  );
}

function ProductCard({ product: p, maxRate, tierNames }: { product: CommissionProduct; maxRate: number; tierNames: Map<string, string> }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const active = p.variations.filter((v) => v.isActive).length;
  const mut = useMutation({
    mutationFn: (rate: number) => setProductRate(p.id, rate),
    onSuccess: (r) => {
      setMsg({ ok: true, text: `Đã đặt ${formatRate(r.affiliateRate)} cho ${r.updated} biến thể đang bán.` });
      setText('');
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
    onError: (e) => setMsg({ ok: false, text: errText(e, 'Không đặt được %.') }),
  });
  const onApply = async () => {
    const parsed = parseRateInput(text, maxRate);
    if ('error' in parsed) return setMsg({ ok: false, text: parsed.error });
    setMsg(null);
    const ok = await confirm({
      title: 'Đặt % cho cả sản phẩm',
      message: `Đặt ${formatRate(parsed.rate)} cho ${active} biến thể đang bán của "${p.name}"? Mức cũ của các biến thể này bị thay.`,
      confirmLabel: `Đặt ${formatRate(parsed.rate)}`,
    });
    if (ok && !mut.isPending) mut.mutate(parsed.rate);
  };

  return (
    <li data-commission-product className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 break-words text-sm font-semibold text-stone-900">{p.name}</span>
        {!p.isActive && <ToneBadge tone="neutral">Ngừng bán</ToneBadge>}
        {p.isPartner && <ToneBadge tone="info">Gian hàng đối tác</ToneBadge>}
        {p.approvalStatus !== 'APPROVED' && <ToneBadge tone="warning">Chưa duyệt</ToneBadge>}
        {p.affiliateBlocked && (
          <ToneBadge tone="danger" title="Sản phẩm bị chặn CTV: hoa hồng luôn 0đ dù biến thể có %">
            Chặn CTV — luôn 0đ
          </ToneBadge>
        )}
      </div>
      {active > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-600">
          <span>Mọi biến thể đang bán:</span>
          <input
            inputMode="decimal"
            aria-label={`% cho mọi biến thể đang bán của ${p.name}`}
            placeholder="%"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={mut.isPending}
            className={`${FIELD_XS} w-20`}
          />
          <button type="button" onClick={onApply} disabled={mut.isPending || !text.trim()} className={BTN_XS_SECONDARY}>
            {mut.isPending ? 'Đang đặt…' : 'Đặt cho cả SP'}
          </button>
        </div>
      )}
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`mt-1 text-xs ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
          {msg.text}
        </p>
      )}
      <ul className="mt-2 divide-y divide-stone-200 border-t border-stone-200">
        {p.variations.map((v) => (
          <VariationRow key={`${v.id}:${v.affiliateRate ?? ''}`} v={v} maxRate={maxRate} tierNames={tierNames} />
        ))}
      </ul>
      {dialog}
    </li>
  );
}

function VariationRow({ v, maxRate, tierNames }: { v: CommissionVariation; maxRate: number; tierNames: Map<string, string> }) {
  const qc = useQueryClient();
  const initial = v.affiliateRate === null ? '' : String(v.affiliateRate).replace('.', ',');
  const [text, setText] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const mut = useMutation({
    mutationFn: (rate: number) => setVariationRate(v.id, rate),
    onSuccess: (r) => {
      setMsg({ ok: true, text: `Đã lưu ${formatRate(r.affiliateRate)}.` });
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
    onError: (e) => setMsg({ ok: false, text: errText(e, 'Không lưu được %.') }),
  });
  const parsed = text.trim() && text !== initial ? parseRateInput(text, maxRate) : null;
  const invalid = parsed && 'error' in parsed ? parsed.error : null;
  const dirty = !!parsed && 'rate' in parsed && parsed.rate !== v.affiliateRate;
  const onSave = () => {
    if (dirty && !mut.isPending) mut.mutate((parsed as { rate: number }).rate);
  };
  const dealer = Object.entries(v.dealerPrices ?? {}).filter(([, price]) => typeof price === 'number');
  const price = v.salePrice ?? v.retailPrice;

  return (
    <li data-commission-variation className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="break-all font-mono font-medium text-stone-900">{v.sku}</span>
          <span className="text-stone-600">{v.name}</span>
          {!v.isActive && <ToneBadge tone="neutral">Ngừng bán</ToneBadge>}
        </div>
        <div className="mt-0.5 text-stone-500">
          Giá {formatVnd(price)} ·{' '}
          <span className={v.affiliateRate === null ? 'font-semibold text-warning-fg' : 'text-stone-700'}>{formatRate(v.affiliateRate)}</span>
          {v.affiliateRate !== null && v.affiliateRate > 0 && <> ≈ {formatVnd(Math.floor((price * v.affiliateRate) / 100))}/sp</>}
        </div>
        {dealer.length > 0 && (
          <div className="mt-0.5 text-stone-500">
            Giá sỉ: {dealer.map(([tier, p]) => `${tierNames.get(tier) ?? tier} ${formatVnd(p)}`).join(' · ')}
          </div>
        )}
        {invalid ? (
          <p role="alert" className="mt-0.5 text-danger-fg">
            {invalid}
          </p>
        ) : (
          msg && (
            <p role={msg.ok ? 'status' : 'alert'} className={`mt-0.5 ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
              {msg.text}
            </p>
          )
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          inputMode="decimal"
          aria-label={`% hoa hồng ${v.sku}`}
          aria-invalid={invalid ? true : undefined}
          placeholder="%"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setMsg(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave();
          }}
          disabled={mut.isPending}
          className={`${FIELD_XS} w-20 text-right`}
        />
        <span aria-hidden="true" className="text-stone-500">%</span>
        <button type="button" onClick={onSave} disabled={mut.isPending || !dirty} className={BTN_XS_PRIMARY}>
          {mut.isPending ? 'Đang lưu…' : 'Lưu'}
        </button>
      </div>
    </li>
  );
}

const STATUS_ORDER: RateImportStatus[] = ['INVALID', 'OVER_CAP', 'DUPLICATE', 'NOT_FOUND', 'OK', 'UNCHANGED'];

function RateCsvImport() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<RateImportPreview | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const previewMut = useMutation({
    mutationFn: () => previewRateImport(csv),
    onSuccess: (p) => setPreview(p),
    onError: (e) => setMsg({ ok: false, text: errText(e, 'Không xem trước được.') }),
  });
  const applyMut = useMutation({
    mutationFn: () => applyRateImport(csv),
    onSuccess: (r) => {
      const notFound = r.notFound.length ? ` ${r.notFound.length} SKU không khớp, đã bỏ qua: ${r.notFound.slice(0, 20).join(', ')}${r.notFound.length > 20 ? '…' : ''}.` : '';
      setMsg({ ok: true, text: `Đã đổi % cho ${r.updated} biến thể, ${r.unchanged} dòng không đổi.${notFound}` });
      setPreview(null);
      setCsv('');
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
    onError: (e) => setMsg({ ok: false, text: errText(e, 'Không áp dụng được.') }),
  });
  const busy = previewMut.isPending || applyMut.isPending;
  const rows = preview ? [...preview.rows].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.line - b.line) : [];

  const onApply = async () => {
    if (!preview?.canApply) return;
    const ok = await confirm({
      title: 'Áp % hoa hồng từ CSV',
      message:
        `Đổi % cho ${preview.counts.OK} biến thể` +
        (preview.counts.NOT_FOUND ? `, bỏ qua ${preview.counts.NOT_FOUND} SKU không khớp` : '') +
        '?\n\nĐơn đặt từ lúc này tính hoa hồng theo mức mới.',
      confirmLabel: `Áp ${preview.counts.OK} dòng`,
    });
    if (ok && !busy) applyMut.mutate();
  };

  return (
    <section aria-label="Nhập % hoa hồng từ CSV" className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3">
      <h3 className="text-sm font-semibold text-stone-900">Nhập % hoa hồng từ Excel (CSV &ldquo;sku,%&rdquo;)</h3>
      <p className="text-xs text-stone-600">
        Dán 2 cột SKU và % từ Excel, mỗi dòng một SKU. Xem trước rồi mới áp; còn dòng lỗi (sai định dạng, vượt trần, SKU lặp) thì
        không dòng nào được ghi.
      </p>
      <textarea
        aria-label="Nội dung CSV sku,% hoa hồng"
        rows={6}
        placeholder={'SKU,% hoa hồng\nNRC-500,10\nNG-1L;7,5'}
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
          setPreview(null);
          setMsg(null);
        }}
        disabled={applyMut.isPending}
        className={`${INPUT_CLASS} font-mono text-xs`}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setMsg(null);
            previewMut.mutate();
          }}
          disabled={busy || !csv.trim()}
          className={BTN_SECONDARY}
        >
          {previewMut.isPending ? 'Đang kiểm…' : 'Xem trước'}
        </button>
        {preview && (
          <button type="button" onClick={onApply} disabled={busy || !preview.canApply} className={BTN_PRIMARY}>
            {applyMut.isPending ? 'Đang áp…' : `Áp dụng ${preview.counts.OK} dòng`}
          </button>
        )}
      </div>
      {msg && <Notice tone={msg.ok ? 'success' : 'danger'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</Notice>}
      {preview && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_ORDER.filter((s) => preview.counts[s] > 0).map((s) => (
              <ToneBadge key={s} tone={RATE_IMPORT_STATUS[s].tone}>
                {RATE_IMPORT_STATUS[s].label}: {preview.counts[s]}
              </ToneBadge>
            ))}
          </div>
          {preview.blocking > 0 && (
            <Notice tone="danger">Còn {preview.blocking} dòng lỗi — sửa trong Excel, dán lại rồi xem trước lại.</Notice>
          )}
          {preview.blocking === 0 && preview.counts.OK === 0 && <Notice tone="info">Không có dòng nào cần đổi.</Notice>}
          <ul className="max-h-96 divide-y divide-stone-200 overflow-y-auto rounded-control border border-stone-200">
            {rows.map((r) => (
              <li key={r.line} data-import-row={r.status} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-1.5 text-xs">
                <span className="w-12 shrink-0 text-stone-500">Dòng {r.line}</span>
                <span className="min-w-0 break-all font-mono text-stone-900">{r.sku || '—'}</span>
                <ToneBadge tone={RATE_IMPORT_STATUS[r.status].tone}>{RATE_IMPORT_STATUS[r.status].label}</ToneBadge>
                {(r.status === 'OK' || r.status === 'UNCHANGED') && (
                  <span className="text-stone-700">
                    {formatRate(r.currentRate)} → {formatRate(r.rate)}
                  </span>
                )}
                {r.productName && <span className="min-w-0 break-words text-stone-500">{[r.productName, r.variationName].filter(Boolean).join(' · ')}</span>}
                {r.message && <span className="text-danger-fg">{r.message}{r.input ? ` (“${r.input}”)` : ''}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {dialog}
    </section>
  );
}

/** Nhập giá sỉ theo bậc (D1-06): API `admin/dealer-prices/import` có sẵn, ghi lịch sử ở tab "Lịch sử giá đại lý". */
function DealerPriceImport() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [tierId, setTierId] = useState('');
  const [csv, setCsv] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const mut = useMutation({
    mutationFn: () => importDealerPrices(tierId, csv),
    onSuccess: (r) => {
      const notFound = r.notFound.length ? ` Không tìm thấy SKU: ${r.notFound.slice(0, 20).join(', ')}${r.notFound.length > 20 ? '…' : ''}.` : '';
      setMsg({ ok: r.notFound.length === 0, text: `Đã cập nhật ${r.updated} giá sỉ, ${r.skipped} dòng bỏ qua (không đổi hoặc sai).${notFound}` });
      if (r.notFound.length === 0) setCsv('');
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      void qc.invalidateQueries({ queryKey: ['admin-dealer-price-history'] });
    },
    onError: (e) => setMsg({ ok: false, text: errText(e, 'Không nhập được giá sỉ.') }),
  });
  const lines = csv.split(/\r?\n/).filter((l) => l.trim()).length;

  const onImport = async () => {
    if (!tierId) return setMsg({ ok: false, text: 'Chọn bậc đại lý trước.' });
    setMsg(null);
    const ok = await confirm({
      title: 'Nhập giá sỉ đại lý',
      message: `Ghi giá sỉ cho ${lines} dòng vào bậc đã chọn? Dòng giá không hợp lệ hoặc SKU không có sẽ bị bỏ qua; mỗi lần đổi giá được ghi vào "Lịch sử giá đại lý".`,
      confirmLabel: 'Nhập giá sỉ',
    });
    if (ok && !mut.isPending) mut.mutate();
  };

  return (
    <section aria-label="Giá sỉ đại lý" className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3">
      <h3 className="text-sm font-semibold text-stone-900">Giá sỉ đại lý theo bậc</h3>
      <p className="text-xs text-stone-600">Chọn bậc, dán 2 cột SKU và giá sỉ (đồng) từ Excel, mỗi dòng một SKU.</p>
      <DealerTierSelect value={tierId} onChange={setTierId} className="w-full sm:w-80" />
      <textarea
        aria-label="Nội dung CSV sku,giá sỉ"
        rows={5}
        placeholder={'NRC-500,185000\nNG-1L,240000'}
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
          setMsg(null);
        }}
        disabled={mut.isPending}
        className={`${INPUT_CLASS} font-mono text-xs`}
      />
      <button type="button" onClick={onImport} disabled={mut.isPending || !csv.trim()} className={BTN_PRIMARY}>
        {mut.isPending ? 'Đang nhập…' : 'Nhập giá sỉ'}
      </button>
      {msg && <Notice tone={msg.ok ? 'success' : 'warning'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</Notice>}
      {dialog}
    </section>
  );
}
