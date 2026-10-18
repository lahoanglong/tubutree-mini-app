'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, ClipboardList, Save, Search, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteTemplate, placeDealerOrder, saveTemplate, type PricelistRow } from '@tubutree/app-core/api/dealer';
import { dealerPricelistQuery, dealerTemplatesQuery } from '@tubutree/app-core/queries/dealer';
import { DEALER_MAX_QTY, preorderQty, realDiscountPct } from '@tubutree/app-core/dealer-pricing';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { newIdempotencyKey } from '@/lib/idempotency-key';
import { useDebounced } from '@/lib/use-debounced';
import { ui } from '@/lib/guest-ui';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { QuantitySelector } from '@/components/ui/quantity-selector';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { errText } from './dealer-shell';

const OUT_OF_STOCK_PREORDER = 'Hết hàng — được đặt trước';
const preorderLine = (n: number) => `Đặt trước ${n}, giao khi hàng về`;
const preorderNote = (lines: number) =>
  `${lines} mặt hàng đặt vượt tồn: cả đơn sẽ giao khi đủ hàng, giữ giá hôm nay. Đơn trả trước vẫn thanh toán đủ ngay.`;

type Notice = { text: string; error: boolean };

function PriceRow({ row, qty, onQty }: { row: PricelistRow; qty: number; onQty: (n: number) => void }) {
  const preorder = preorderQty(qty, row.stock);
  const discountPct = realDiscountPct(row.retailPrice, row.dealerPrice);
  return (
    <li className="flex items-center gap-2 border-b border-stone-200 p-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-stone-900">
          {row.product} · {row.variation}
        </div>
        <div className="text-xs text-stone-600">
          {row.sku} · {row.stock > 0 ? `tồn ${row.stock}` : OUT_OF_STOCK_PREORDER}
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-bold tabular-nums text-stone-900">{formatVnd(row.dealerPrice)}</span>
          <span className="text-xs tabular-nums text-stone-600 line-through">{formatVnd(row.retailPrice)}</span>
          {discountPct > 0 && <span className="text-xs font-semibold text-forest-700">-{discountPct}%</span>}
        </div>
        {preorder > 0 && (
          <div className="mt-1">
            <Badge tone="warning" size="sm">
              {preorderLine(preorder)}
            </Badge>
          </div>
        )}
      </div>
      <div className="flex-none">
        <QuantitySelector value={qty} min={0} max={DEALER_MAX_QTY} size="md" onChange={onQty} />
      </div>
    </li>
  );
}

/** Bảng giá đại lý + đặt nhanh: số lượng theo biến thể, đặt trước khi vượt tồn, mẫu đơn, dán đơn từ bảng tính. */
export function PriceTab({ creditLimit, debt }: { creditLimit: number; debt: number }) {
  const qc = useQueryClient();
  const router = useRouter();
  const priceQ = useQuery(dealerPricelistQuery(coreHttp));
  const templatesQ = useQuery(dealerTemplatesQuery(coreHttp));
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 250);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteResult, setPasteResult] = useState<{ matched: number; unmatched: string[] } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [tplName, setTplName] = useState('');

  const cart = useMemo(() => Object.entries(qty).filter(([, n]) => n > 0), [qty]);

  const saveTpl = useMutation({
    mutationFn: () => saveTemplate(coreHttp, tplName, cart.map(([variationId, quantity]) => ({ variationId, quantity }))),
    onSuccess: () => {
      setSaveOpen(false);
      setTplName('');
      setNotice({ text: 'Đã lưu mẫu đơn.', error: false });
      void qc.invalidateQueries({ queryKey: dealerTemplatesQuery(coreHttp).queryKey });
    },
  });
  const delTpl = useMutation({
    mutationFn: (id: string) => deleteTemplate(coreHttp, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dealerTemplatesQuery(coreHttp).queryKey }),
    onError: (e) => setNotice({ text: errText(e), error: true }),
  });

  /** Dán "SKU<sep>SốLượng" mỗi dòng (sep = tab/phẩy/chấm phẩy/khoảng trắng) và khớp với bảng giá. */
  const applyPaste = () => {
    // Bảng giá chưa tải xong thì mọi SKU hợp lệ sẽ bị báo nhầm "không khớp".
    if (priceQ.isLoading) return;
    const bySku = new Map((priceQ.data ?? []).map((r) => [r.sku.toUpperCase(), r.variationId]));
    const next: Record<string, number> = { ...qty };
    let matched = 0;
    const unmatched: string[] = [];
    for (const raw of pasteText.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split(/[\t,;]+|\s{2,}|\s+(?=\d+$)/).map((p) => p.trim()).filter(Boolean);
      const sku = (parts[0] ?? '').toUpperCase();
      const q = parseInt(parts[parts.length - 1] ?? '', 10);
      const vid = bySku.get(sku);
      if (vid && q > 0) {
        next[vid] = Math.min(DEALER_MAX_QTY, (next[vid] ?? 0) + q);
        matched++;
      } else if (sku) {
        unmatched.push(sku);
      }
    }
    setQty(next);
    setPasteResult({ matched, unmatched });
  };

  const rows = useMemo(() => {
    const list = priceQ.data ?? [];
    const q = debounced.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => r.product.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q) || r.brand.toLowerCase().includes(q));
  }, [priceQ.data, debounced]);

  const total = useMemo(() => {
    const price = new Map((priceQ.data ?? []).map((r) => [r.variationId, r.dealerPrice]));
    return cart.reduce((s, [id, n]) => s + (price.get(id) ?? 0) * n, 0);
  }, [cart, priceQ.data]);
  const preorderLines = useMemo(() => {
    const stockOf = new Map((priceQ.data ?? []).map((r) => [r.variationId, r.stock]));
    return cart.filter(([id, n]) => preorderQty(n, stockOf.get(id) ?? 0) > 0).length;
  }, [cart, priceQ.data]);

  // Idempotency-Key giữ nguyên qua các lần bấm lại của CÙNG một lần đặt (bấm đúp/timeout mạng) để API không tạo đơn công nợ đôi;
  // đổi sau khi đặt thành công vì đơn sau là đơn mới (như Mini App), và đổi khi giỏ/phương thức khác lần thử trước: cùng key thì
  // API trả lại đơn cũ (có thể đã được tạo dù mạng báo lỗi) và giỏ mới bị xoá mà chưa hề đặt.
  const orderKey = useRef(newIdempotencyKey());
  const lastAttempt = useRef<string | null>(null);
  // `disabled={isPending}` chỉ có hiệu lực sau lần render kế: hai cú bấm cùng khung hình vẫn gọi mutate hai lần.
  const placeBusy = useRef(false);
  const place = useMutation({
    mutationFn: (method: 'CREDIT' | 'PREPAID') =>
      placeDealerOrder(coreHttp, cart.map(([variationId, quantity]) => ({ variationId, quantity })), method, undefined, orderKey.current),
    onSuccess: (order, method) => {
      const hasPreorder = order.items?.some((it) => (it.backorderedQty ?? 0) > 0) ?? false;
      setNotice({
        text: hasPreorder ? 'Đã tạo đơn đại lý — đơn sẽ giao khi đủ hàng, giữ giá hôm nay.' : 'Đã tạo đơn đại lý!',
        error: false,
      });
      orderKey.current = newIdempotencyKey();
      setQty({});
      for (const key of ['dealer-orders', 'dealer-me', 'dealer-credit', 'dealer-rewards', 'dealer-report']) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
      lastAttempt.current = null;
      // Chỉ đơn máy chủ trả về còn chờ chuyển khoản mới có trang để chuyển; đơn công nợ (CONFIRMED) cũng ghi BANK_TRANSFER nên phải xét cả trạng thái.
      if (method === 'PREPAID' && order.paymentMethod === 'BANK_TRANSFER' && order.status === 'PENDING_PAYMENT') router.push(`/thanh-toan/chuyen-khoan/${encodeURIComponent(order.code)}`);
    },
    onError: (e) => setNotice({ text: errText(e), error: true }),
    onSettled: () => {
      placeBusy.current = false;
    },
  });
  const submit = (method: 'CREDIT' | 'PREPAID') => {
    if (placeBusy.current) return;
    placeBusy.current = true;
    setNotice(null);
    const attempt = `${method}|${cart.map(([id, n]) => `${id}:${n}`).join(',')}`;
    if (lastAttempt.current !== null && lastAttempt.current !== attempt) orderKey.current = newIdempotencyKey();
    lastAttempt.current = attempt;
    place.mutate(method);
  };

  const overLimit = debt + total > creditLimit;
  const placing = place.isPending;
  const templates = templatesQ.data ?? [];

  const orderControls = (
    <>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className={`${ui.btnText} gap-1 no-underline`} onClick={() => setSaveOpen(true)}>
          <Save className="h-4 w-4" aria-hidden="true" />
          Lưu mẫu
        </button>
        <span className="text-lg font-bold tabular-nums text-stone-900">{formatVnd(total)}</span>
      </div>
      {preorderLines > 0 && <p className="text-xs text-warning-fg">{preorderNote(preorderLines)}</p>}
      {overLimit && (
        <p className="flex items-center gap-1 text-xs text-danger-fg">
          <AlertTriangle className="h-4 w-4 flex-none" aria-hidden="true" />
          Vượt hạn mức công nợ — chọn Trả trước hoặc giảm số lượng.
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={placing} onClick={() => submit('PREPAID')} className={`${ui.btnSecondary} flex-1`}>
          Trả trước
        </button>
        <button type="button" disabled={overLimit || placing} onClick={() => submit('CREDIT')} className={`${ui.btnPrimary} flex-1`}>
          {placing ? 'Đang đặt...' : 'Ghi công nợ'}
        </button>
      </div>
    </>
  );

  return (
    <div className="pb-6">
      <div role="status" aria-live="polite">
        {notice && <p className={`mb-3 text-sm ${notice.error ? 'text-danger-fg' : 'font-medium text-success-fg'}`}>{notice.text}</p>}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" aria-hidden="true" />
          <input
            type="search"
            aria-label="Tìm sản phẩm"
            placeholder="Tìm theo tên / SKU / thương hiệu"
            className={`${ui.field} pl-9`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          type="button"
          className={`${ui.btnSecondary} flex-none`}
          onClick={() => {
            setPasteResult(null);
            setPasteOpen(true);
          }}
        >
          Dán đơn
        </button>
      </div>

      {/* Mẫu đơn lưu sẵn: chạm tên để đặt lại, nút X để xoá. */}
      {templates.length > 0 && (
        <ul aria-label="Mẫu đơn đã lưu" className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-none items-center rounded-full border border-stone-900 bg-stone-0">
              <button
                type="button"
                className="flex min-h-11 items-center gap-1.5 pl-3 pr-1 text-xs font-semibold text-stone-900"
                onClick={() => setQty(Object.fromEntries(t.items.map((i) => [i.variationId, i.quantity])))}
              >
                <ClipboardList className="h-4 w-4 flex-none" aria-hidden="true" />
                {t.name} ({t.items.length})
              </button>
              <button
                type="button"
                aria-label="Xoá mẫu đơn"
                aria-disabled={delTpl.isPending}
                className={`flex min-h-11 min-w-11 items-center justify-center ${delTpl.isPending ? 'opacity-50' : ''}`}
                onClick={() => {
                  if (!delTpl.isPending) delTpl.mutate(t.id);
                }}
              >
                <X className="h-4 w-4 text-danger-fg" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={`mt-3 overflow-hidden ${ui.card}`}>
        {priceQ.isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={40} />
            ))}
          </div>
        ) : priceQ.isError && !priceQ.data ? (
          <ErrorState message={errText(priceQ.error)} onRetry={() => void priceQ.refetch()} />
        ) : rows.length > 0 ? (
          <ul className="md:grid md:grid-cols-2">
            {rows.map((r) => (
              <PriceRow key={r.variationId} row={r} qty={qty[r.variationId] ?? 0} onQty={(n) => setQty((s) => ({ ...s, [r.variationId]: n }))} />
            ))}
          </ul>
        ) : (
          <p className="p-6 text-center text-sm text-stone-600">Không tìm thấy sản phẩm</p>
        )}
      </div>

      {cart.length > 0 && (
        <>
          <section
            aria-label="Đặt hàng đại lý"
            className="mt-4 hidden rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card md:sticky md:bottom-4 md:block"
          >
            {orderControls}
          </section>
          <StickyActionBar label="Đặt hàng đại lý">{orderControls}</StickyActionBar>
        </>
      )}

      <Sheet
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Lưu mẫu đơn"
        footer={
          <button type="button" disabled={!tplName.trim() || saveTpl.isPending} onClick={() => saveTpl.mutate()} className={`${ui.btnPrimary} w-full`}>
            {saveTpl.isPending ? 'Đang lưu...' : 'Lưu mẫu'}
          </button>
        }
      >
        <input aria-label="Tên mẫu" placeholder="Tên mẫu (vd Đơn tháng)" className={ui.field} value={tplName} onChange={(e) => setTplName(e.target.value)} />
        {saveTpl.isError && (
          <p role="alert" className={`mt-2 ${ui.error}`}>
            {errText(saveTpl.error)}
          </p>
        )}
      </Sheet>

      <Sheet
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title="Đặt nhanh — dán từ Excel/Sheet"
        footer={
          <button type="button" disabled={!pasteText.trim() || priceQ.isLoading} onClick={applyPaste} className={`${ui.btnPrimary} w-full`}>
            Thêm vào đơn
          </button>
        }
      >
        <p className="mb-2 text-xs text-stone-600">
          Mỗi dòng: <b>SKU</b> và <b>số lượng</b> (cách nhau bằng tab/phẩy/khoảng trắng). VD:
          <br />
          POLANG-SP-500 10
        </p>
        <textarea
          aria-label="Danh sách SKU và số lượng"
          placeholder={'POLANG-SP-500\t10\nFUWA-DW-1L, 24'}
          rows={5}
          className={`${ui.field} py-2`}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
        />
        {priceQ.isLoading && <p className="mt-2 text-xs text-stone-600">Đang tải bảng giá, vui lòng đợi trước khi dán đơn…</p>}
        {pasteResult && (
          <p role="status" className={`mt-2 flex items-center gap-1 text-xs ${pasteResult.unmatched.length ? 'text-promo-fg' : 'text-forest-700'}`}>
            <Check className="h-4 w-4 flex-none" aria-hidden="true" />
            <span>
              Khớp {pasteResult.matched} dòng
              {pasteResult.unmatched.length > 0 ? ` · Không khớp: ${pasteResult.unmatched.join(', ')}` : ''}
            </span>
          </p>
        )}
      </Sheet>
    </div>
  );
}
