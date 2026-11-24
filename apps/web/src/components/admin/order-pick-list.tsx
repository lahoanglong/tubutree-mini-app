'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import { actionErrorText } from '@/lib/admin-error-text';
import {
  collectFilterOrderIds,
  getPickList,
  pickPaymentText,
  PICK_LIST_MAX,
  type PickLine,
  type PickListFilter,
  type PickListResponse,
  type PickOrder,
} from '@/lib/admin-pick-list';
import { formatDateTime } from '@/lib/format-date';
import { ADMIN_TABULAR } from './tabular-nums';
import { BTN_PRIMARY, BTN_SECONDARY, Notice } from './ui';

/**
 * Khổ in A4: chỉ lớp phủ phiếu được in, mọi phần khác của trang (menu, bảng đơn, thanh thao tác) ẩn. Phiếu từng đơn không bị cắt
 * ngang trang; Phần 2 sang trang mới để Phần 1 (tờ nhặt hàng) tách ra cầm đi kho được. Lớp phủ khoá cuộn `body` lúc mở, nên khi in phải mở lại
 * `overflow`: trình duyệt in thân trang đang `overflow: hidden` có thể chỉ ra trang đầu.
 */
const PRINT_CSS = `
@page { size: A4 portrait; margin: 10mm; }
@media print {
  body > *:not([data-pick-list-root]) { display: none !important; }
  html, body { background: #fff !important; overflow: visible !important; height: auto !important; }
  [data-pick-list-root] { position: static !important; inset: auto !important; height: auto !important; overflow: visible !important; background: #fff !important; }
  [data-pick-list-toolbar] { display: none !important; }
  [data-pick-list-page] { max-width: none !important; padding: 0 !important; font-size: 10.5pt; color: #000; }
  [data-pick-part="orders"] { break-before: page; page-break-before: always; }
  [data-pick-order] { break-inside: avoid; page-break-inside: avoid; }
  [data-pick-summary] thead { display: table-header-group; }
  [data-pick-summary] tr { break-inside: avoid; page-break-inside: avoid; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

const TICK = 'inline-block h-3.5 w-3.5 shrink-0 rounded-[2px] border border-stone-700 align-middle';
const PAY_TONE: Record<ReturnType<typeof pickPaymentText>['tone'], string> = {
  collect: 'border-2 border-stone-900 text-stone-900',
  hold: 'border-2 border-danger-fg text-danger-fg',
  none: 'border border-stone-450 text-stone-700',
};

function lineName(l: Pick<PickLine, 'productName' | 'variationName'>) {
  return l.variationName && l.variationName !== l.productName ? `${l.productName} · ${l.variationName}` : l.productName;
}

function Backordered({ qty }: { qty: number }) {
  return qty > 0 ? <span className="ml-1 text-[11px] font-semibold text-warning-fg">(thiếu {qty}, đặt trước)</span> : null;
}

function OrderLines({ lines }: { lines: PickLine[] }) {
  return (
    <ul className="divide-y divide-stone-100">
      {lines.map((l, i) => (
        <li key={`${l.variationId}-${i}`} className="flex items-start gap-2 py-1">
          <span aria-hidden className={`${TICK} mt-0.5`} />
          <span className="min-w-0 flex-1 break-words">
            {lineName(l)}
            {l.sku && <span className="ml-1 whitespace-nowrap text-[11px] text-stone-500">{l.sku}</span>}
            <Backordered qty={l.backorderedQty} />
          </span>
          <span className="shrink-0 font-semibold">×{l.quantity}</span>
        </li>
      ))}
    </ul>
  );
}

function OrderSlip({ o, index, count }: { o: PickOrder; index: number; count: number }) {
  const pay = pickPaymentText(o.payment);
  return (
    <article data-pick-order={o.code} className="rounded-control border border-stone-300 p-3 text-xs text-stone-900">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-bold">
            {o.code}
            <span className="ml-2 text-[11px] font-normal text-stone-500">
              {index + 1}/{count}
            </span>
          </div>
          <div className="text-[11px] text-stone-600">
            {o.statusLabel} · đặt {formatDateTime(o.createdAt)}
            {o.type === 'DEALER' ? ' · Đơn đại lý' : ''}
            {o.hasRecyclingPickup ? ' · Kèm thu gom vỏ' : ''}
          </div>
        </div>
        <div data-pick-payment={o.payment.state} className={`rounded-control px-2 py-1 text-xs font-bold ${PAY_TONE[pay.tone]}`}>
          {pay.text}
        </div>
      </header>
      <div className="mt-2">
        <span className="font-semibold">{o.recipient || 'Người nhận'}</span>
        {o.phoneMasked && <span className="ml-2">{o.phoneMasked}</span>}
      </div>
      <div className="break-words text-stone-700">{o.address || 'Đơn chưa ghi địa chỉ giao hàng.'}</div>
      {o.note && <div className="mt-1 break-words italic text-stone-700">Ghi chú khách: {o.note}</div>}
      {o.items.length > 0 && (
        <div className="mt-2" data-pick-items>
          <OrderLines lines={o.items} />
        </div>
      )}
      {o.gifts.length > 0 && (
        <div className="mt-2" data-pick-gifts>
          <div className="text-[11px] font-semibold uppercase text-stone-600">Quà tặng 0đ (không tính tiền)</div>
          <OrderLines lines={o.gifts} />
        </div>
      )}
    </article>
  );
}

/** Lý do bị loại hiện tối đa chừng này dòng, phần còn lại gộp một dòng: in cả bộ lọc chưa lọc trạng thái có thể loại hàng trăm đơn đã giao. */
const EXCLUDED_SHOWN = 20;

function PickListBody({ data, notice }: { data: PickListResponse; notice?: string }) {
  const n = data.orderCount;
  const hidden = data.excluded.length - EXCLUDED_SHOWN;
  return (
    <>
      <header className="border-b border-stone-300 pb-2">
        <h1 className="font-display text-lg font-bold text-stone-900">Phiếu soạn hàng · {n} đơn</h1>
        <p className="text-xs text-stone-600">
          {data.totalUnits} món bán{data.giftUnits > 0 ? ` + ${data.giftUnits} quà 0đ` : ''} · in lúc {formatDateTime(data.generatedAt)}
        </p>
      </header>
      {notice && (
        <div className="mt-3" data-pick-notice>
          <Notice tone="warning" role="alert">
            {notice}
          </Notice>
        </div>
      )}
      {data.excluded.length > 0 && (
        <div className="mt-3" data-pick-excluded>
          <Notice tone="warning" role="alert">
            <p className="font-semibold">Không in {data.excluded.length} đơn:</p>
            <ul className="mt-1 list-disc pl-4">
              {data.excluded.slice(0, EXCLUDED_SHOWN).map((e) => (
                <li key={e.id}>{e.reason}</li>
              ))}
              {hidden > 0 && <li>… và {hidden} đơn khác (đã huỷ, đã rời kho hoặc chưa trả tiền).</li>}
            </ul>
          </Notice>
        </div>
      )}
      {n === 0 ? (
        <p className="mt-4 text-sm text-stone-600">Không còn đơn nào cần soạn trong lượt này.</p>
      ) : (
        <>
          <section data-pick-part="summary" className="mt-4">
            <h2 className="text-sm font-bold uppercase text-stone-800">Phần 1 · Tổng hàng cần nhặt</h2>
            <table data-pick-summary className="mt-2 w-full border-collapse text-xs text-stone-900">
              <thead>
                <tr className="border-b-2 border-stone-700 text-left">
                  <th scope="col" className="w-6 py-1">
                    <span className="sr-only">Đã nhặt</span>
                  </th>
                  <th scope="col" className="py-1">Sản phẩm</th>
                  <th scope="col" className="w-12 py-1 text-right">SL</th>
                  <th scope="col" className="w-14 py-1 text-right">Số đơn</th>
                </tr>
              </thead>
              <tbody>
                {data.summary.map((r) => (
                  <tr key={`${r.variationId}-${r.isGift ? 'gift' : 'sale'}`} data-pick-row={r.sku ?? r.variationId} data-gift={r.isGift ? 'true' : 'false'} className="border-b border-stone-200 align-top">
                    <td className="py-1.5">
                      <span aria-hidden className={TICK} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <span className="break-words">{lineName(r)}</span>
                      {r.isGift && <span className="ml-1 rounded-full border border-stone-450 px-1.5 text-[10px] font-semibold">Quà 0đ</span>}
                      {!r.redeemed && (
                        <div className="text-[11px] text-stone-500">
                          {r.sku ?? 'Chưa có mã SKU'}
                          <Backordered qty={r.backorderedQty} />
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 text-right text-sm font-bold">{r.quantity}</td>
                    <td className="py-1.5 text-right">{r.orderCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section data-pick-part="orders" className="mt-6">
            <h2 className="text-sm font-bold uppercase text-stone-800">Phần 2 · Phiếu đóng gói từng đơn</h2>
            <div className="mt-2 space-y-3">
              {data.orders.map((o, i) => (
                <OrderSlip key={o.id} o={o} index={i} count={n} />
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}

/**
 * Lớp phủ toàn màn hình xem trước rồi in phiếu soạn hàng (A4) cho các đơn `ids`. Chỉ đọc: không đổi trạng thái đơn nào.
 * Đơn kho không soạn được (đã huỷ/hoàn, đã rời kho, chờ tiền, gian hàng tự giao) không vào phiếu, lý do hiện ở đầu phiếu (cả bản in).
 */
export function PickListSheet({ ids, onClose, notice }: { ids: readonly string[]; onClose: () => void; notice?: string }) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<PickListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const idsKey = ids.join(',');
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    let live = true;
    setError(null);
    getPickList(idsKey.split(','))
      .then((r) => live && setData(r))
      .catch((e: unknown) => live && setError(actionErrorText(e)));
    return () => {
      live = false;
    };
  }, [idsKey, attempt]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    boxRef.current?.querySelector<HTMLElement>('[data-pick-close]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'Tab' && boxRef.current) {
        const items = [...boxRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')];
        if (items.length === 0) return;
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === items.length - 1 ? 0 : at + 1;
        e.preventDefault();
        items[next]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  const canPrint = !!data && data.orderCount > 0;
  return createPortal(
    <div
      ref={boxRef}
      data-pick-list-root
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={`fixed inset-0 z-[100] overflow-y-auto bg-stone-0 text-stone-900 ${ADMIN_TABULAR}`}
    >
      <style>{PRINT_CSS}</style>
      <div data-pick-list-toolbar className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-stone-200 bg-stone-0 px-4 py-2 shadow-card">
        <h2 id={titleId} className="mr-auto text-sm font-semibold">
          Phiếu soạn hàng{data ? ` · ${data.orderCount} đơn` : ''}
        </h2>
        <button type="button" data-pick-close onClick={onClose} className={BTN_SECONDARY}>
          Đóng
        </button>
        <button type="button" data-pick-print onClick={() => window.print()} disabled={!canPrint} className={`${BTN_PRIMARY} flex items-center gap-1.5`}>
          <Printer aria-hidden className="h-4 w-4" />
          In (A4)
        </button>
      </div>
      <div data-pick-list-page className="mx-auto max-w-[210mm] px-4 py-4">
        {error ? (
          <div className="space-y-2">
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
            <button
              type="button"
              onClick={() => {
                setData(null);
                setAttempt((a) => a + 1);
              }}
              className={BTN_SECONDARY}
            >
              Thử lại
            </button>
          </div>
        ) : data ? (
          <PickListBody data={data} notice={notice} />
        ) : (
          <p role="status" className="text-sm text-stone-600">
            Đang soạn phiếu cho {ids.length} đơn…
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Nút "In phiếu soạn (N đơn)" ở thanh công cụ tab Đơn hàng: in MỌI đơn khớp bộ lọc đang xem (không chỉ trang này), tối đa
 * `PICK_LIST_MAX`. Bộ lọc nhiều hơn thì báo lọc hẹp lại, không in một phần. Đơn không soạn được (đã giao, chờ tiền…) máy chủ tự loại.
 */
export function PickListFilterButton({ filter, total, disabled }: { filter: PickListFilter; total: number | undefined; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<{ ids: string[]; notice?: string } | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const start = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const r = await collectFilterOrderIds(filter);
      if (r.tooMany) setMsg(`Bộ lọc đang có ${r.total} đơn, mỗi lượt in tối đa ${PICK_LIST_MAX} đơn. Lọc theo trạng thái hoặc ngày đặt rồi in lại.`);
      else if (r.ids.length === 0) setMsg('Không có đơn nào khớp bộ lọc để in.');
      else
        setOpen({
          ids: r.ids,
          ...(r.complete
            ? {}
            : { notice: 'Danh sách đơn đổi ngay lúc gom (có đơn vừa đổi trạng thái hoặc đơn mới vào): phiếu này có thể thiếu đơn. Đóng phiếu rồi bấm in lại để chắc đủ đơn.' }),
        });
    } catch (e) {
      setMsg(actionErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        data-pick-filter
        onClick={() => void start()}
        disabled={busy || disabled || !total}
        className={`${BTN_SECONDARY} flex items-center gap-1.5 whitespace-nowrap`}
        title={`In phiếu soạn hàng cho mọi đơn khớp bộ lọc (tối đa ${PICK_LIST_MAX} đơn)`}
      >
        <Printer aria-hidden="true" className="h-4 w-4 shrink-0" />
        {busy ? 'Đang gom đơn…' : `In phiếu soạn${total ? ` (${total} đơn)` : ''}`}
      </button>
      {msg && (
        <p role="status" data-pick-filter-msg className="w-full text-xs text-danger-fg">
          {msg}
        </p>
      )}
      {open && <PickListSheet ids={open.ids} notice={open.notice} onClose={close} />}
    </>
  );
}
