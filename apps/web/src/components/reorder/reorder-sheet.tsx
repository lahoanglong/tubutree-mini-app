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
  initialSelection, selectedLines, selectionTotals, targetLines,
  type LineSelection, type ReorderLine, type ReorderSource, type ReorderTarget,
} from './reorder-types';
import { useReorder } from './use-reorder';
import { ProductThumb } from '@/components/mini';

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

  // Đổi target → khởi tạo lại lựa chọn NGAY trong lúc render ("adjust state on prop change" của React),
  // nên khung hình đầu đã có dòng được chọn + CTA đúng số lượng (effect hậu-paint sẽ nháy "(0)").
  if (target !== seenTarget) {
    setSeenTarget(target);
    if (target) {
      setShown(target);
      setSel(initialSelection(target));
      setNotice(null);
      setPartiallyAdded(false);
    }
  }
  const view = target ?? shown;
  const lines = view ? targetLines(view) : [];
  const { units, subtotal } = view ? selectionTotals(view, sel) : { units: 0, subtotal: 0 };

  // Khoá ĐỒNG BỘ chống chạm đúp: isPending của react-query chỉ cập nhật sau một nhịp notify.
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const submit = async () => {
    if (!target || units === 0 || inFlight.current) return;
    inFlight.current = true;
    setNotice(null);
    let summary: ReorderSummary | null = null;
    try {
      summary = await reorder.submit(target, selectedLines(target, sel));
    } catch (err) {
      if (mounted.current) setNotice({ kind: 'error', text: homeErrorMessage(err) });
    } finally {
      inFlight.current = false;
    }
    if (!summary || !mounted.current) return;
    if (summary.addedUnits > 0 && !summary.hasProblems) {
      onDone?.(summary);
      onClose();
    }
    else {
      setNotice({ kind: 'problem', text: summary.message });
      if (summary.addedUnits > 0) setPartiallyAdded(true);
    }
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
            <span>{formatVnd(subtotal)}</span>
          </div>
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
          <button type="button" disabled={units === 0 || reorder.isPending || partiallyAdded} onClick={() => void submit()} className={`${ui.btnPrimary} w-full`}>
            {reorderText.addCta(units)}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {lines.map((line) => (
          <ReorderLineRow key={line.key} line={line} value={sel[line.key]} onChange={(v) => setSel((s) => ({ ...s, [line.key]: v }))} />
        ))}
      </div>
    </Sheet>
  );
}

function ReorderLineRow({ line, value, onChange }: { line: ReorderLine; value: LineSelection | undefined; onChange: (v: LineSelection) => void }) {
  const checked = line.available && (value?.checked ?? false);
  const qty = value?.quantity ?? line.defaultQuantity;
  return (
    <div data-testid="reorder-line" className={`flex items-start gap-2.5 ${line.available ? '' : 'opacity-50'}`}>
      <label className="flex h-11 w-11 flex-none items-center justify-center">
        <input
          type="checkbox"
          aria-label={reorderText.selectLine(line.productName)}
          checked={checked}
          disabled={!line.available}
          onChange={() => onChange({ checked: !checked, quantity: qty })}
          className="h-5 w-5 accent-forest-600"
        />
      </label>
      <ProductThumb src={line.thumbnail} alt="" size={56} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-sm font-semibold text-stone-900">{line.productName}</p>
        {line.variationName && <p className="text-xs text-stone-600">{line.variationName}</p>}
        {line.available ? (
          <>
            <p className="text-sm font-bold text-stone-900">{formatVnd(line.unitPrice)}</p>
            <QuantitySelector value={qty} max={line.maxQuantity} size="md" onChange={(n) => onChange({ checked, quantity: n })} />
          </>
        ) : (
          <p className="text-xs text-danger-fg">{reorderText.unavailable}</p>
        )}
      </div>
    </div>
  );
}
