'use client';

import { useRef, useState } from 'react';
import { Sheet } from '@/components/ui/sheet';
import { QuantitySelector } from '@/components/ui/quantity-selector';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import {
  initialSelection,
  selectedLines,
  selectionTotals,
  targetLines,
  type LineSelection,
  type ReorderLine,
  type ReorderSource,
  type ReorderTarget,
} from './reorder';
import { useReorder, type ReorderNotice } from './use-reorder';

export interface ReorderSheetProps {
  target: ReorderTarget | null;
  source: ReorderSource;
  onClose: () => void;
  navigateToCart?: boolean;
  onNotice?: (notice: ReorderNotice) => void;
}

/**
 * Sheet mua lại dùng chung: chọn dòng + số lượng, dòng hết hàng mờ và khoá, tổng tạm tính, nút "Thêm vào giỏ (n)". Lỗi mạng
 * giữ nguyên lựa chọn; chỉ đóng khi đã thêm được ít nhất một món.
 */
export function ReorderSheet({ target, source, onClose, navigateToCart, onNotice }: ReorderSheetProps) {
  const [sel, setSel] = useState<Record<string, LineSelection>>(() => (target ? initialSelection(target) : {}));
  const [seenTarget, setSeenTarget] = useState<ReorderTarget | null>(target);
  const [error, setError] = useState<string | null>(null);
  const reorder = useReorder(source, { navigateToCart, onNotice });

  // Đổi target → khởi tạo lại lựa chọn ngay trong lúc render, nên khung hình đầu đã có dòng được chọn + CTA đúng số lượng
  // (effect sau khi vẽ sẽ nháy "(0)").
  if (target !== seenTarget) {
    setSeenTarget(target);
    setError(null);
    if (target) setSel(initialSelection(target));
  }

  const lines = target ? targetLines(target) : [];
  const { units, subtotal } = target ? selectionTotals(target, sel) : { units: 0, subtotal: 0 };

  // Khoá đồng bộ chống bấm đúp: `isPending` của react-query chỉ cập nhật sau một nhịp nên cú bấm thứ hai trong cùng nhịp vẫn thấy false.
  const inFlight = useRef(false);
  const submit = async () => {
    if (!target || units === 0 || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    let added = false;
    try {
      const summary = await reorder.submit(target, selectedLines(target, sel));
      added = summary.addedUnits > 0;
      if (!added) setError(summary.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thêm được vào giỏ. Vui lòng thử lại.');
    } finally {
      inFlight.current = false;
    }
    // Ngoài try: lỗi của onClose (bug của caller) không bị nuốt như lỗi mạng.
    if (added) onClose();
  };

  return (
    <Sheet
      open={target !== null}
      onClose={onClose}
      title="Mua lại"
      description={target?.kind === 'order' ? `Từ đơn ${target.orderCode}` : undefined}
      footer={
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-stone-700">Tạm tính</span>
            <span className="font-semibold text-stone-900">{formatVnd(subtotal)}</span>
          </div>
          <p className="text-xs text-stone-600">Giá theo hiện tại, xem chính xác ở giỏ hàng.</p>
          {error && (
            <p role="alert" className={ui.error}>
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={units === 0 || reorder.isPending}
            onClick={() => void submit()}
            className={`${ui.btnPrimary} w-full`}
          >
            {`Thêm vào giỏ (${units})`}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {lines.map((line) => (
          <ReorderLineRow
            key={line.key}
            line={line}
            value={sel[line.key]}
            onChange={(v) => setSel((s) => ({ ...s, [line.key]: v }))}
          />
        ))}
      </div>
    </Sheet>
  );
}

function ReorderLineRow({
  line,
  value,
  onChange,
}: {
  line: ReorderLine;
  value: LineSelection | undefined;
  onChange: (v: LineSelection) => void;
}) {
  const checked = line.available && (value?.checked ?? false);
  const qty = value?.quantity ?? line.defaultQuantity;
  return (
    <div data-testid="reorder-line" className={`flex items-start gap-2.5 ${line.available ? '' : 'opacity-50'}`}>
      <label className="-m-1.5 flex h-11 w-11 flex-none items-center justify-center">
        <input
          type="checkbox"
          aria-label={`Chọn ${line.productName}`}
          checked={checked}
          disabled={!line.available}
          onChange={() => onChange({ checked: !checked, quantity: qty })}
          className="h-5 w-5 accent-forest-600"
        />
      </label>
      <div className="h-14 w-14 flex-none overflow-hidden rounded-control bg-stone-100">
        {line.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={line.thumbnail} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-semibold text-stone-900">{line.productName}</span>
        {line.variationName && <span className="text-xs text-stone-600">{line.variationName}</span>}
        {line.available ? (
          <>
            <span className="text-sm font-semibold text-forest-700">{formatVnd(line.unitPrice)}</span>
            <QuantitySelector value={qty} max={line.maxQuantity} size="sm" onChange={(n) => onChange({ checked, quantity: n })} />
          </>
        ) : (
          <span className="text-xs text-danger-fg">Tạm hết hàng</span>
        )}
      </div>
    </div>
  );
}
