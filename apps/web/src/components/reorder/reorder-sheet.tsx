'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatVnd } from '@/lib/format-vnd';
import { reorderText } from '@/lib/home-text';
import { ui } from '@/lib/guest-ui';
import { QuantitySelector } from '@/components/ui/quantity-selector';
import { Sheet } from '@/components/ui/sheet';
import { homeErrorMessage } from '@/components/home/home-block-error';
import type { ReorderSummary } from './reorder-summary';
import {
  availableLines, availableSelectionState, initialSelection, lineAt, selectedLines, selectionSavings, selectionTotals, targetLines, toggleAllAvailable,
  unitsSharingCartLine,
  type LineSelection, type ReorderLine, type ReorderSource, type ReorderTarget,
} from './reorder-types';
import { useCartUnits } from './use-cart-units';
import { useReorder } from './use-reorder';
import { ProductThumb } from '@/components/mini';
import { reorderSavingsNote, reorderSkippedNote, type ReorderLineNotice } from '@tubutree/app-core/commerce/reorder-notice';

export interface ReorderSheetProps {
  target: ReorderTarget | null;
  source?: ReorderSource;
  onClose: () => void;
  /** Thêm đủ mà không điều hướng sang giỏ: trang gọi dùng kết quả để tự báo, vì sheet đóng ngay. */
  onDone?: (summary: ReorderSummary) => void;
  navigateToCart?: boolean;
}

/**
 * Sheet mua lại dùng chung: chọn dòng + số lượng, dòng hết hàng mờ và khoá, tổng tạm tính, CTA "Thêm vào giỏ (n)". Lỗi mạng
 * giữ nguyên lựa chọn; chỉ đóng khi đã thêm đủ. Có dòng không thêm được (hết hàng, thiếu tồn) thì ở lại nêu lý do kèm lối vào giỏ,
 * vì web không có snackbar để báo sau khi đóng.
 */
export function ReorderSheet({ target, source, onClose, onDone, navigateToCart }: ReorderSheetProps) {
  // Nội dung dựng từ `shown` = target KHÁC null gần nhất để dòng không rút cạn ngay lúc đóng.
  const [shown, setShown] = useState<ReorderTarget | null>(target);
  const [sel, setSel] = useState<Record<string, LineSelection>>(() => (target ? initialSelection(target) : {}));
  const [seenTarget, setSeenTarget] = useState<ReorderTarget | null>(target);
  const [notice, setNotice] = useState<{ kind: 'error' | 'problem'; text: string } | null>(null);
  // Đã có dòng vào giỏ mà còn dòng chưa đủ: gửi lại cùng lựa chọn sẽ cộng thêm lần nữa vào dòng đã thêm.
  const [partiallyAdded, setPartiallyAdded] = useState(false);
  const reorder = useReorder({ navigateToCart, source });
  // Giỏ gộp số lượng cùng biến thể rồi mới so với suất Giờ vàng: giá hiện ở sheet phải tính cả phần đã có sẵn trong giỏ. Số liệu đóng
  // băng từ lúc bấm thêm, vì giỏ tải lại sau khi thêm sẽ đếm phần vừa thêm hai lần và làm giá trên sheet nhảy.
  // Giỏ đang tải lần đầu thì chưa biết phần đã có sẵn: khoá nút thêm tới khi giỏ về (giá và tạm tính tự tính lại), không tính như giỏ rỗng.
  const { units: liveCart, ready: cartReady } = useCartUnits(target !== null);
  const [frozenCart, setFrozenCart] = useState<ReadonlyMap<string, number> | null>(null);
  const cart = frozenCart ?? liveCart;

  // Đổi target → khởi tạo lại lựa chọn NGAY trong lúc render ("adjust state on prop change" của React),
  // nên khung hình đầu đã có dòng được chọn + CTA đúng số lượng (effect hậu-paint sẽ nháy "(0)").
  if (target !== seenTarget) {
    setSeenTarget(target);
    if (target) {
      setShown(target);
      setSel(initialSelection(target));
      setNotice(null);
      setPartiallyAdded(false);
      setFrozenCart(null);
    }
  }
  const view = target ?? shown;
  const lines = view ? targetLines(view) : [];
  const skippedNote = reorderSkippedNote(lines);
  const { units, subtotal } = view ? selectionTotals(view, sel, cart) : { units: 0, subtotal: 0 };
  const savedNote = view ? reorderSavingsNote(selectionSavings(view, sel, cart)) : null;
  const availableCount = view ? availableLines(view).length : 0;
  const selectionState = view ? availableSelectionState(view, sel) : 'none';

  // Khoá ĐỒNG BỘ chống chạm đúp: isPending của react-query chỉ cập nhật sau một nhịp notify.
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Sheet đóng được lúc lệnh còn bay. Chỉ khi sheet đang hiện ĐƠN KHÁC thì lệnh cũ xong muộn mới không được đóng sheet, hiện lời hay khoá nút của nó, hay đưa khách
  // sang giỏ làm mất số lượng đang chỉnh. Đóng rồi mở lại CÙNG đơn thì khách đang nhìn đúng đơn đó và sheet không có chữ gõ dở: lệnh muộn xử lý như khi chưa đóng,
  // nếu không thì không còn lời nào báo, nút bật lại và chạm lần hai cộng đôi mọi dòng vào giỏ.
  const targetKey = target ? (target.kind === 'order' ? `order:${target.orderCode}` : `item:${target.line.key}`) : null;
  const targetKeyNow = useRef(targetKey);
  targetKeyNow.current = targetKey;
  const submit = async () => {
    if (!target || units === 0 || !cartReady || inFlight.current) return;
    inFlight.current = true;
    const sentKey = targetKey;
    const showsOtherTarget = () => targetKeyNow.current !== null && targetKeyNow.current !== sentKey;
    setFrozenCart(liveCart);
    setNotice(null);
    let summary: ReorderSummary | null = null;
    try {
      summary = await reorder.submit(target, selectedLines(target, sel), () => !showsOtherTarget());
    } catch (err) {
      if (mounted.current && !showsOtherTarget()) {
        setFrozenCart(null);
        setNotice({ kind: 'error', text: homeErrorMessage(err) });
      }
    } finally {
      inFlight.current = false;
    }
    if (!summary || !mounted.current) return;
    const other = showsOtherTarget();
    if (summary.addedUnits > 0 && !summary.hasProblems) {
      onDone?.(summary);
      if (!other) onClose();
    }
    if (other) {
      // Giỏ đã được tải lại; khách chỉ cần biết món của lần trước đã vào giỏ.
      if (summary.addedUnits > 0) setNotice({ kind: 'problem', text: reorderText.addedEarlier(summary.addedUnits) });
      return;
    }
    if (summary.addedUnits > 0 && !summary.hasProblems) return;
    setNotice({ kind: 'problem', text: summary.message });
    if (summary.addedUnits > 0) setPartiallyAdded(true);
    else setFrozenCart(null);
  };

  return (
    <Sheet
      open={target !== null}
      onClose={onClose}
      title={reorderText.sheetTitle}
      description={view?.kind === 'order' ? `Từ đơn ${view.orderCode}` : undefined}
      footer={
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm font-semibold text-stone-900">
            <span>{reorderText.subtotal}</span>
            <span className="tabular-nums">{formatVnd(subtotal)}</span>
          </div>
          {savedNote && (
            <p data-testid="reorder-savings-note" className="text-xs font-semibold tabular-nums text-success-fg">
              {savedNote}
            </p>
          )}
          <p className="text-xs text-stone-600">{reorderText.priceNote}</p>
          {notice?.kind === 'error' && (
            <p role="alert" className={ui.error}>
              {notice.text}
            </p>
          )}
          {notice?.kind === 'problem' && (
            <p role="status" className="text-sm text-stone-700">
              {notice.text}{' '}
              <Link href="/gio-hang" className="font-semibold text-forest-700 underline">
                {reorderText.viewCart}
              </Link>
            </p>
          )}
          <button
            type="button"
            disabled={units === 0 || reorder.isPending || partiallyAdded || !cartReady}
            aria-busy={!cartReady || undefined}
            onClick={() => void submit()}
            className={`${ui.btnPrimary} w-full`}
          >
            {reorderText.addCta(units)}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {skippedNote && (
          <p className="text-sm text-[color:var(--color-text-secondary)]" data-testid="reorder-skipped-note">
            {skippedNote}
          </p>
        )}
        {view && availableCount >= 2 && (
          <label className="flex min-h-11 items-center gap-2.5 text-sm font-semibold text-[color:var(--color-text-primary)]">
            <span className="flex h-11 w-11 flex-none items-center justify-center">
              <input
                type="checkbox"
                data-testid="reorder-toggle-all"
                checked={selectionState === 'all'}
                ref={(el) => {
                  if (el) el.indeterminate = selectionState === 'some';
                }}
                onChange={() => setSel((s) => toggleAllAvailable(view, s))}
                className="h-5 w-5 accent-[color:var(--color-action-primary-bg)]"
              />
            </span>
            {reorderText.selectAll(availableCount)}
          </label>
        )}
        {lines.map((line) => (
          <ReorderLineRow
            key={line.key}
            line={line}
            value={sel[line.key]}
            inCart={view ? unitsSharingCartLine(view, sel, cart, line) : 0}
            onChange={(v) => setSel((s) => ({ ...s, [line.key]: v }))}
          />
        ))}
      </div>
    </Sheet>
  );
}

function ReorderLineRow({ line, value, inCart, onChange }: { line: ReorderLine; value: LineSelection | undefined; inCart: number; onChange: (v: LineSelection) => void }) {
  const checked = line.available && (value?.checked ?? false);
  const qty = value?.quantity ?? line.defaultQuantity;
  const { unitPrice, notices } = lineAt(line, qty, inCart);
  return (
    <div data-testid="reorder-line" className="flex items-start gap-2.5">
      <label className="flex h-11 w-11 flex-none items-center justify-center">
        <input
          type="checkbox"
          aria-label={reorderText.selectLine(line.productName)}
          checked={checked}
          disabled={!line.available}
          onChange={() => onChange({ checked: !checked, quantity: qty })}
          className="h-5 w-5 accent-[color:var(--color-action-primary-bg)]"
        />
      </label>
      {/* Mờ chỉ ảnh: chữ giải thích mờ theo cả dòng chỉ còn 2,3:1 (WCAG 1.4.3). */}
      <div className={`flex-none ${line.available ? '' : 'opacity-50'}`}>
        <ProductThumb src={line.thumbnail} alt="" size={56} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className={`truncate text-sm font-semibold ${line.available ? 'text-stone-900' : 'text-[color:var(--color-text-secondary)]'}`}>{line.productName}</p>
        {line.variationName && <p className="text-xs text-stone-600">{line.variationName}</p>}
        {line.available && <p className="text-sm font-bold tabular-nums text-stone-900">{formatVnd(unitPrice)}</p>}
        <LineNotices notices={notices} />
        {line.available && (
          <QuantitySelector value={qty} max={line.maxQuantity} size="md" itemLabel={line.productName} onChange={(n) => onChange({ checked, quantity: n })} />
        )}
      </div>
    </div>
  );
}

const NOTICE_TONE: Record<ReorderLineNotice['tone'], string> = { danger: 'text-danger-fg', warning: 'text-warning-fg', success: 'text-success-fg' };

/** Hết hàng, ngừng bán, đã giảm số lượng, giá đổi: mỗi câu một dòng ngay dưới giá, đọc liền với tên món. */
function LineNotices({ notices }: { notices: readonly ReorderLineNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <>
      {notices.map((n) => (
        <p key={n.kind} className={`text-xs tabular-nums ${NOTICE_TONE[n.tone]}`} data-notice={n.kind}>
          {n.text}
        </p>
      ))}
    </>
  );
}
