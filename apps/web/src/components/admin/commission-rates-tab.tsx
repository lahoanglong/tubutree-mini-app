'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { importDealerPrices, listDealerTiers, previewDealerPrices, type DealerPriceImportStatus, type DealerPricePreview } from '@/lib/admin-client';
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
import { actionErrorText } from '@/lib/admin-error-text';
import { settleWithin } from '@/lib/settle-within';
import { reloadWhenStale } from '@/lib/stale-write-rejection';
import { useLockedMutation } from '@/components/game/use-locked-mutation';

const LIST_KEY = ['admin-commission-rates'] as const;
const errText = (e: unknown, fallback: string) => (e instanceof Error ? actionErrorText(e) : fallback);

/**
 * "Hoa hồng & giá sỉ" (D1-01, D3-01, D1-06): % hoa hồng CTV từng biến thể — nguồn duy nhất của hoa hồng, hàng đồng bộ từ
 * Pancake không mang % nên biến thể chưa đặt hưởng mức mặc định (affiliate.default_rate_pct) — và nhập giá sỉ theo bậc đại lý (API có sẵn, trước đây
 * không màn nào gọi). Không tự đặt mức nào: mọi mức do admin chọn.
 */
export function CommissionRatesTab() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-stone-900">Hoa hồng & giá sỉ</h2>
        <p className="mt-1 text-sm text-stone-600">
          % hoa hồng CTV tính trên số tiền khách trả cho từng dòng hàng: <strong>10 nghĩa là 10%</strong>. Để trống % thì dòng đó hưởng
          <strong> mức mặc định</strong> (đổi ở tab Cấu hình, thẻ &quot;Hoa hồng cộng tác viên và hạn xử lý của đối tác&quot;); hàng gian hàng đối tác để trống
          thì 0đ. Đặt 0% khi cố ý không trả hoa hồng.
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
  const products = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const maxRate = first?.maxRate ?? 50;
  // Sản phẩm vừa lưu đủ % rơi khỏi bộ lọc "chưa có %" sau khi tải lại; giữ thẻ (bản đã cập nhật) tại chỗ với dấu "Đã đủ %"
  // tới khi đổi bộ lọc hoặc tải lại trang.
  const [kept, setKept] = useState<Map<string, CommissionProduct>>(new Map());
  const prevIds = useRef<string[]>([]);
  const resetKept = () => {
    prevIds.current = [];
    setKept(new Map());
  };
  const shownProducts = useMemo(() => {
    const fresh = new Map(products.map((p) => [p.id, p]));
    const out: { product: CommissionProduct; done: boolean }[] = [];
    const placed = new Set<string>();
    for (const id of prevIds.current) {
      const cur = fresh.get(id);
      if (cur) out.push({ product: cur, done: false });
      else if (kept.has(id)) out.push({ product: kept.get(id)!, done: true });
      else continue;
      placed.add(id);
    }
    for (const p of products) if (!placed.has(p.id)) out.push({ product: p, done: false });
    return out;
  }, [products, kept]);
  useEffect(() => {
    prevIds.current = shownProducts.map((x) => x.product.id);
  }, [shownProducts]);
  const onSaved = (p: CommissionProduct) => setKept((m) => new Map(m).set(p.id, p));

  return (
    <section aria-label="% hoa hồng theo sản phẩm" className="space-y-3">
      {first && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span className={first.summary.missing > 0 ? 'font-semibold text-warning-fg' : 'text-success-fg'}>
            {first.summary.missing > 0
              ? `${first.summary.missing} biến thể đang bán chưa có % riêng`
              : 'Mọi biến thể đang bán đã có %'}
          </span>
          <span className="text-xs text-stone-600">Mức mặc định khi để trống: {formatRate(first.defaultRate)}</span>
          <span className="text-xs text-stone-500">Trần mỗi biến thể: {formatRate(maxRate)} (đổi ở tab Cấu hình, thẻ &quot;Hoa hồng cộng tác viên…&quot;)</span>
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
          onChange={(e) => {
            setTyped(e.target.value);
            resetKept();
          }}
          className={`${FIELD_XS} w-full sm:w-72`}
        />
        <button type="button" aria-pressed={missingOnly} onClick={() => {
            setMissingOnly((v) => !v);
            resetKept();
          }} className={chipClass(missingOnly)}>
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
      {list.isSuccess && shownProducts.length === 0 && (
        <p className="rounded-card border border-stone-200 bg-stone-0 p-6 text-center text-sm text-stone-500">
          {q ? `Không có sản phẩm nào khớp "${q}".` : missingOnly ? 'Không còn sản phẩm nào thiếu % hoa hồng.' : 'Chưa có sản phẩm nào.'}
        </p>
      )}
      <ul className="space-y-3">
        {shownProducts.map(({ product, done }) => (
          <ProductCard key={product.id} product={product} done={done} onSaved={onSaved} maxRate={maxRate} defaultRate={first?.defaultRate ?? 8} tierNames={tierNames} />
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
  const refresh = () => qc.invalidateQueries({ queryKey: LIST_KEY });
  const mut = useLockedMutation({
    mutationFn: (rate: number) => fillMissingRates(rate),
    onSuccess: (r) => {
      setMsg({ ok: true, text: `Đã đặt ${formatRate(r.affiliateRate)} cho ${r.updated} biến thể.` });
      setText('');
      return settleWithin(refresh());
    },
    onError: (e) => {
      setMsg({ ok: false, text: errText(e, 'Không áp được %.') });
      return reloadWhenStale(e, refresh);
    },
  });
  if (missingTubu === 0 && !msg) return null;

  const onApply = async () => {
    if (mut.isPending) return;
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
            inputMode="numeric"
            aria-label="% áp cho biến thể chưa có %"
            placeholder="vd 10"
            value={text}
            onChange={(e) => setText(e.target.value)}
            readOnly={mut.isPending}
            aria-busy={mut.isPending || undefined}
            className={`${FIELD_XS} w-20`}
          />
          <span aria-hidden="true">%</span>
          <button
            type="button"
            onClick={onApply}
            disabled={!text.trim()}
            aria-busy={mut.isPending || undefined}
            aria-disabled={mut.isPending || undefined}
            className={`${BTN_XS_PRIMARY} aria-disabled:opacity-60`}
          >
            {mut.isPending ? 'Đang áp…' : 'Áp dụng'}
          </button>
        </div>
      )}
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`mt-1 text-xs tabular-nums ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
          {msg.text}
        </p>
      )}
      {dialog}
    </div>
  );
}

function ProductCard({
  product: p,
  done,
  onSaved,
  maxRate,
  defaultRate,
  tierNames,
}: {
  product: CommissionProduct;
  done: boolean;
  onSaved: (p: CommissionProduct) => void;
  maxRate: number;
  defaultRate: number;
  tierNames: Map<string, string>;
}) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const active = p.variations.filter((v) => v.isActive).length;
  const refresh = () => qc.invalidateQueries({ queryKey: LIST_KEY });
  const mut = useLockedMutation({
    mutationFn: (rate: number) => setProductRate(p.id, rate),
    onSuccess: (r) => {
      setMsg({ ok: true, text: `Đã đặt ${formatRate(r.affiliateRate)} cho ${r.updated} biến thể đang bán.` });
      setText('');
      onSaved({ ...p, variations: p.variations.map((v) => (v.isActive ? { ...v, affiliateRate: r.affiliateRate } : v)) });
      return settleWithin(refresh());
    },
    onError: (e) => {
      setMsg({ ok: false, text: errText(e, 'Không đặt được %.') });
      return reloadWhenStale(e, refresh);
    },
  });
  const onApply = async () => {
    if (mut.isPending) return;
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
        {done && <ToneBadge tone="success">Đã đủ %</ToneBadge>}
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
            inputMode="numeric"
            aria-label={`% cho mọi biến thể đang bán của ${p.name}`}
            placeholder="%"
            value={text}
            onChange={(e) => setText(e.target.value)}
            readOnly={mut.isPending}
            aria-busy={mut.isPending || undefined}
            className={`${FIELD_XS} w-20`}
          />
          <button
            type="button"
            onClick={onApply}
            disabled={!text.trim()}
            aria-busy={mut.isPending || undefined}
            aria-disabled={mut.isPending || undefined}
            className={`${BTN_XS_SECONDARY} aria-disabled:opacity-60`}
          >
            {mut.isPending ? 'Đang đặt…' : 'Đặt cho cả SP'}
          </button>
        </div>
      )}
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`mt-1 text-xs tabular-nums ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
          {msg.text}
        </p>
      )}
      <ul className="mt-2 divide-y divide-stone-200 border-t border-stone-200">
        {p.variations.map((v) => (
          <VariationRow key={v.id} v={v} onRateSaved={(rate) => onSaved({ ...p, variations: p.variations.map((x) => (x.id === v.id ? { ...x, affiliateRate: rate } : x)) })} blocked={p.affiliateBlocked} partner={p.isPartner} maxRate={maxRate} defaultRate={defaultRate} tierNames={tierNames} />
        ))}
      </ul>
      {dialog}
    </li>
  );
}

function VariationRow({
  v,
  onRateSaved,
  blocked,
  partner,
  maxRate,
  defaultRate,
  tierNames,
}: {
  v: CommissionVariation;
  onRateSaved: (rate: number | null) => void;
  blocked: boolean;
  partner: boolean;
  maxRate: number;
  defaultRate: number;
  tierNames: Map<string, string>;
}) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const initial = v.affiliateRate === null ? '' : String(v.affiliateRate).replace('.', ',');
  const [text, setText] = useState(initial);
  // Mức trên server đổi (vừa lưu, đặt cả SP, CSV) thì ô nhập theo mức mới; hàng giữ nguyên để "Đã lưu" không mất khi tải lại.
  const [shownInitial, setShownInitial] = useState(initial);
  if (shownInitial !== initial) {
    setShownInitial(initial);
    setText(initial);
  }
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: LIST_KEY });
  // Khoá giữ tới khi danh sách tải lại xong (tối đa 4 giây): nhả sớm thì nút còn hiện với mức cũ.
  const mut = useLockedMutation({
    mutationFn: (rate: number | null) => setVariationRate(v.id, rate),
    onSuccess: (r) => {
      setMsg({ ok: true, text: r.affiliateRate === null ? 'Đã về mức mặc định.' : `Đã lưu ${formatRate(r.affiliateRate)}.` });
      onRateSaved(r.affiliateRate);
      return settleWithin(refresh());
    },
    onError: (e) => {
      setMsg({ ok: false, text: errText(e, 'Không lưu được %.') });
      return reloadWhenStale(e, refresh);
    },
  });
  const parsed = text.trim() && text !== initial ? parseRateInput(text, maxRate) : null;
  const invalid = parsed && 'error' in parsed ? parsed.error : null;
  const dirty = !!parsed && 'rate' in parsed && parsed.rate !== v.affiliateRate;
  const onSave = () => {
    if (dirty && !mut.isPending) mut.mutate((parsed as { rate: number }).rate);
  };
  const onClear = async () => {
    if (mut.isPending) return;
    const after = blocked ? 'sản phẩm đang chặn CTV nên hoa hồng vẫn 0đ' : partner ? 'hàng đối tác nên hoa hồng 0đ' : `sẽ trả ${formatRate(defaultRate)} mặc định`;
    const ok = await confirm({
      title: 'Về mức mặc định',
      message: `Xoá ${formatRate(v.affiliateRate)} riêng của ${v.sku}: ${after}.\n\nĐơn đặt từ lúc này tính theo mức mới; hoa hồng đơn cũ giữ nguyên.`,
      confirmLabel: 'Về mặc định',
    });
    if (ok) mut.mutate(null);
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
          {v.affiliateRate === null ? (
            blocked ? (
              <span className="font-semibold text-warning-fg">Bị chặn: 0đ</span>
            ) : partner ? (
              <span className="font-semibold text-warning-fg">Hàng đối tác chưa đặt %: 0đ</span>
            ) : (
              <>
                <span className="text-stone-700">Mặc định {formatRate(defaultRate)}</span>
                {defaultRate > 0 && <> ≈ {formatVnd(Math.floor((price * defaultRate) / 100))}/sp</>}
              </>
            )
          ) : (
            <>
              <span className="text-stone-700">{formatRate(v.affiliateRate)}</span>
              {!blocked && v.affiliateRate > 0 && <> ≈ {formatVnd(Math.floor((price * v.affiliateRate) / 100))}/sp</>}
            </>
          )}
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
          inputMode="numeric"
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
          readOnly={mut.isPending}
          aria-busy={mut.isPending || undefined}
          className={`${FIELD_XS} w-20 text-right`}
        />
        <span aria-hidden="true" className="text-stone-500">%</span>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty}
          aria-busy={mut.isPending || undefined}
          aria-disabled={mut.isPending || undefined}
          className={`${BTN_XS_PRIMARY} aria-disabled:opacity-60`}
        >
          {mut.isPending ? 'Đang lưu…' : 'Lưu'}
        </button>
        {v.affiliateRate !== null && (
          <button
            type="button"
            onClick={onClear}
            aria-busy={mut.isPending || undefined}
            aria-disabled={mut.isPending || undefined}
            aria-label={`Về mặc định ${v.sku}`}
            className={`${BTN_XS_SECONDARY} aria-disabled:opacity-60`}
          >
            Về mặc định
          </button>
        )}
      </div>
      {dialog}
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
    meta: { skipAdminInvalidate: true },
    onSuccess: (p) => setPreview(p),
    onError: (e) => setMsg({ ok: false, text: errText(e, 'Không xem trước được.') }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: LIST_KEY });
  const applyMut = useLockedMutation({
    mutationFn: () => applyRateImport(csv),
    onSuccess: (r) => {
      const notFound = r.notFound.length ? ` ${r.notFound.length} SKU không khớp, đã bỏ qua: ${r.notFound.slice(0, 20).join(', ')}${r.notFound.length > 20 ? '…' : ''}.` : '';
      setMsg({ ok: true, text: `Đã đổi % cho ${r.updated} biến thể, ${r.unchanged} dòng không đổi.${notFound}` });
      setPreview(null);
      setCsv('');
      return settleWithin(refresh());
    },
    onError: (e) => {
      setMsg({ ok: false, text: errText(e, 'Không áp dụng được.') });
      return reloadWhenStale(e, refresh);
    },
  });
  const busy = previewMut.isPending || applyMut.isPending;
  const rows = preview ? [...preview.rows].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.line - b.line) : [];

  const onApply = async () => {
    if (!preview?.canApply || busy) return;
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
        Dán 2 cột SKU và % từ Excel, mỗi dòng một SKU; gõ &ldquo;mặc định&rdquo; ở cột % để xoá % riêng (về mức mặc định). Xem trước rồi mới áp; còn dòng lỗi (sai định dạng, vượt trần, SKU lặp) thì
        không dòng nào được ghi.
      </p>
      <textarea
        aria-label="Nội dung CSV sku,% hoa hồng"
        rows={6}
        placeholder={'SKU,% hoa hồng\nNRC-500,10\nNG-1L;7'}
        maxLength={300000}
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
          setPreview(null);
          setMsg(null);
        }}
        readOnly={applyMut.isPending}
        aria-busy={applyMut.isPending || undefined}
        className={`${INPUT_CLASS} font-mono text-xs`}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            if (busy) return;
            setMsg(null);
            previewMut.mutate();
          }}
          disabled={!csv.trim()}
          aria-busy={previewMut.isPending || undefined}
          aria-disabled={busy || undefined}
          className={`${BTN_SECONDARY} aria-disabled:opacity-60`}
        >
          {previewMut.isPending ? 'Đang kiểm…' : 'Xem trước'}
        </button>
        {preview && (
          <button
            type="button"
            onClick={onApply}
            disabled={!preview.canApply}
            aria-busy={applyMut.isPending || undefined}
            aria-disabled={busy || undefined}
            className={`${BTN_PRIMARY} aria-disabled:opacity-60`}
          >
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
                    {r.currentRate === null ? 'mặc định' : formatRate(r.currentRate)} → {r.rate === null ? 'mặc định' : formatRate(r.rate)}
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

const DEALER_STATUS: Record<DealerPriceImportStatus, { label: string; tone: 'success' | 'neutral' | 'warning' | 'danger' }> = {
  OK: { label: 'Khớp — sẽ đổi', tone: 'success' },
  UNCHANGED: { label: 'Không đổi', tone: 'neutral' },
  NOT_FOUND: { label: 'Không khớp SKU', tone: 'warning' },
  INVALID: { label: 'Sai định dạng', tone: 'danger' },
  OUT_OF_RANGE: { label: 'Ngoài khoảng giá', tone: 'danger' },
  DUPLICATE: { label: 'SKU lặp', tone: 'danger' },
};
const DEALER_STATUS_ORDER: DealerPriceImportStatus[] = ['INVALID', 'OUT_OF_RANGE', 'DUPLICATE', 'NOT_FOUND', 'OK', 'UNCHANGED'];
const vndOrDash = (n: number | null) => (n === null ? 'chưa có' : formatVnd(n));

/**
 * Nhập giá sỉ theo bậc (D1-06). Giá sỉ > 0 thắng mọi chiết khấu khi đại lý đặt hàng, nên đi như CSV hoa hồng: xem trước (BE đọc
 * 185.000 / 240,000 / 1.250.000 đúng số đồng, kiểm sàn chiết khấu đại lý và giá lẻ) rồi mới áp; còn dòng lỗi thì không ghi dòng nào.
 */
function DealerPriceImport() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [tierId, setTierId] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<DealerPricePreview | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const previewMut = useMutation({
    mutationFn: () => previewDealerPrices(tierId, csv),
    meta: { skipAdminInvalidate: true },
    onSuccess: (p) => setPreview(p),
    onError: (e) => setMsg({ ok: false, text: errText(e, 'Không xem trước được.') }),
  });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: LIST_KEY }), qc.invalidateQueries({ queryKey: ['admin-dealer-price-history'] })]);
  const applyMut = useLockedMutation({
    mutationFn: () => importDealerPrices(tierId, csv),
    onSuccess: (r) => {
      const notFound = r.notFound.length ? ` ${r.notFound.length} SKU không khớp, đã bỏ qua: ${r.notFound.slice(0, 20).join(', ')}${r.notFound.length > 20 ? '…' : ''}.` : '';
      setMsg({ ok: true, text: `Đã cập nhật ${r.updated} giá sỉ, ${r.unchanged} dòng không đổi.${notFound}` });
      setPreview(null);
      setCsv('');
      return settleWithin(refresh());
    },
    onError: (e) => {
      setMsg({ ok: false, text: errText(e, 'Không nhập được giá sỉ.') });
      return reloadWhenStale(e, refresh);
    },
  });
  const busy = previewMut.isPending || applyMut.isPending;
  const rows = preview
    ? [...preview.rows].sort((a, b) => DEALER_STATUS_ORDER.indexOf(a.status) - DEALER_STATUS_ORDER.indexOf(b.status) || a.line - b.line)
    : [];

  const onPreview = () => {
    if (busy) return;
    if (!tierId) return setMsg({ ok: false, text: 'Chọn bậc đại lý trước.' });
    setMsg(null);
    previewMut.mutate();
  };
  const onApply = async () => {
    if (!preview?.canApply || busy) return;
    const ok = await confirm({
      title: 'Nhập giá sỉ đại lý',
      message:
        `Ghi giá sỉ mới cho ${preview.counts.OK} biến thể vào bậc đã chọn` +
        (preview.counts.NOT_FOUND ? `, bỏ qua ${preview.counts.NOT_FOUND} SKU không khớp` : '') +
        '?\n\nĐơn đại lý đặt từ lúc này dùng giá mới; mỗi lần đổi giá được ghi vào "Lịch sử giá đại lý".',
      confirmLabel: `Ghi ${preview.counts.OK} giá`,
    });
    if (ok && !busy) applyMut.mutate();
  };

  return (
    <section aria-label="Giá sỉ đại lý" className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3">
      <h3 className="text-sm font-semibold text-stone-900">Giá sỉ đại lý theo bậc</h3>
      <p className="text-xs text-stone-600">
        Chọn bậc, dán 2 cột SKU và giá sỉ (đồng) từ Excel, mỗi dòng một SKU. Giá không được thấp hơn giá lẻ trừ chiết khấu đại lý tối đa, và không cao hơn giá lẻ. Xem trước rồi mới
        ghi; còn dòng lỗi thì không dòng nào được ghi.
      </p>
      <DealerTierSelect
        value={tierId}
        onChange={(id) => {
          setTierId(id);
          setPreview(null);
        }}
        className="w-full sm:w-80"
      />
      <textarea
        aria-label="Nội dung CSV sku,giá sỉ"
        rows={5}
        placeholder={'SKU;Giá sỉ\nNRC-500;185.000\nNG-1L;240.000'}
        maxLength={300000}
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
          setPreview(null);
          setMsg(null);
        }}
        readOnly={applyMut.isPending}
        aria-busy={applyMut.isPending || undefined}
        className={`${INPUT_CLASS} font-mono text-xs`}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onPreview}
          disabled={!csv.trim()}
          aria-busy={previewMut.isPending || undefined}
          aria-disabled={busy || undefined}
          className={`${BTN_SECONDARY} aria-disabled:opacity-60`}
        >
          {previewMut.isPending ? 'Đang kiểm…' : 'Xem trước giá sỉ'}
        </button>
        {preview && (
          <button
            type="button"
            onClick={onApply}
            disabled={!preview.canApply}
            aria-busy={applyMut.isPending || undefined}
            aria-disabled={busy || undefined}
            className={`${BTN_PRIMARY} aria-disabled:opacity-60`}
          >
            {applyMut.isPending ? 'Đang ghi…' : `Ghi ${preview.counts.OK} giá sỉ`}
          </button>
        )}
      </div>
      {msg && <Notice tone={msg.ok ? 'success' : 'danger'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</Notice>}
      {preview && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {DEALER_STATUS_ORDER.filter((s) => preview.counts[s] > 0).map((s) => (
              <ToneBadge key={s} tone={DEALER_STATUS[s].tone}>
                {DEALER_STATUS[s].label}: {preview.counts[s]}
              </ToneBadge>
            ))}
          </div>
          {preview.blocking > 0 && (
            <Notice tone="danger">Còn {preview.blocking} dòng lỗi — sửa trong Excel, dán lại rồi xem trước lại.</Notice>
          )}
          {preview.blocking === 0 && preview.counts.OK === 0 && <Notice tone="info">Không có giá nào cần đổi.</Notice>}
          <ul className="max-h-96 divide-y divide-stone-200 overflow-y-auto rounded-control border border-stone-200">
            {rows.map((r) => (
              <li key={r.line} data-dealer-row={r.status} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-1.5 text-xs">
                <span className="w-12 shrink-0 text-stone-500">Dòng {r.line}</span>
                <span className="min-w-0 break-all font-mono text-stone-900">{r.sku || '—'}</span>
                <ToneBadge tone={DEALER_STATUS[r.status].tone}>{DEALER_STATUS[r.status].label}</ToneBadge>
                {(r.status === 'OK' || r.status === 'UNCHANGED') && (
                  <span className="text-stone-700">
                    {vndOrDash(r.currentPrice)} → {vndOrDash(r.price)}
                    {r.retailPrice !== null && <span className="text-stone-500"> (giá lẻ {formatVnd(r.retailPrice)})</span>}
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
