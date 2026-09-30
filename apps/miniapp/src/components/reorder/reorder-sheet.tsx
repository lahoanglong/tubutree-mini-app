import { useEffect, useRef, useState } from 'react';
import { vi } from '../../i18n/vi';
import { formatVnd } from '../../utils/format';
import { useReorder } from '../../hooks/use-reorder';
import { trackReorderClicked } from '../../services/buy-flow-events';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/form';
import { KeyValueRow } from '../ui/key-value-row';
import { PriceTag } from '../ui/price-tag';
import { QuantitySelector } from '../ui/quantity-selector';
import { SR_ONLY } from '../ui/sr-only';
import { Text } from '../ui/text';
import {
  initialSelection, selectedLines, selectionTotals, targetLines,
  type LineSelection, type ReorderLine, type ReorderSource, type ReorderTarget,
} from './reorder-types';

export interface ReorderSheetProps {
  target: ReorderTarget | null;
  source: ReorderSource;
  onClose: () => void;
  navigateToCart?: boolean;
}

/**
 * Sheet mua lại dùng chung (spec §3.3): chọn dòng + số lượng, dòng hết hàng mờ và khoá, tổng tạm
 * tính, CTA "Thêm vào giỏ (n)". Lỗi mạng giữ nguyên lựa chọn; chỉ đóng khi đã thêm được ≥1 món.
 */
export function ReorderSheet({ target, source, onClose, navigateToCart }: ReorderSheetProps) {
  // Nội dung dựng từ `shown` = target KHÁC null gần nhất: khi đóng (target → null) ZaUI Sheet còn giữ
  // nội dung ~200ms để trượt xuống — không được rút cạn dòng/mô tả ngay lúc đó.
  const [shown, setShown] = useState<ReorderTarget | null>(target);
  const [sel, setSel] = useState<Record<string, LineSelection>>(() => (target ? initialSelection(target) : {}));
  const [seenTarget, setSeenTarget] = useState<ReorderTarget | null>(target);
  const reorder = useReorder(source, { navigateToCart });

  // Đổi target → khởi tạo lại lựa chọn NGAY trong lúc render ("adjust state on prop change" của React),
  // nên khung hình đầu đã có dòng được chọn + CTA đúng số lượng (effect hậu-paint sẽ nháy "(0)").
  if (target !== seenTarget) {
    setSeenTarget(target);
    if (target) {
      setShown(target);
      setSel(initialSelection(target));
    }
  }
  const view = target ?? shown;

  // Đúng 1 lần mỗi lần mở (target mới); re-render vì lý do khác không bắn lại.
  useEffect(() => {
    if (!target) return;
    trackReorderClicked(
      target.kind === 'order'
        ? { source, orderCode: target.orderCode }
        : { source, variationId: target.line.variationId },
    );
  }, [target]); // chỉ khi target đổi; đổi `source` không tính là mở mới

  const lines = view ? targetLines(view) : [];
  const { units, subtotal } = view ? selectionTotals(view, sel) : { units: 0, subtotal: 0 };

  // Khoá ĐỒNG BỘ chống chạm đúp: isPending của react-query chỉ cập nhật sau một nhịp notify
  // (setTimeout 0) nên cú chạm thứ hai trong cùng nhịp vẫn thấy isPending=false.
  const inFlight = useRef(false);
  const submit = async () => {
    if (!target || units === 0 || inFlight.current) return;
    inFlight.current = true;
    let added = false;
    try {
      const summary = await reorder.submit(target, selectedLines(target, sel));
      added = summary.addedUnits > 0;
    } catch {
      /* useReorder đã báo lỗi — giữ sheet + lựa chọn để khách bấm lại */
    } finally {
      inFlight.current = false;
    }
    // Ngoài try: lỗi của onClose (bug của caller) không bị nuốt như lỗi mạng.
    if (added) onClose();
  };

  return (
    <BottomSheet
      open={target !== null}
      onClose={onClose}
      title={vi.reorder.sheetTitle}
      description={view?.kind === 'order' ? vi.reorder.fromOrder(view.orderCode) : undefined}
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <KeyValueRow label={vi.reorder.subtotal} value={formatVnd(subtotal)} emphasis />
          <Text variant="caption" tone="tertiary" as="div">
            {vi.reorder.priceNote}
          </Text>
          <Button fullWidth size="lg" loading={reorder.isPending} disabled={units === 0} onPress={() => void submit()}>
            {vi.reorder.addCta(units)}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {lines.map((line) => (
          <ReorderLineRow
            key={line.key}
            line={line}
            value={sel[line.key]}
            onChange={(v) => setSel((s) => ({ ...s, [line.key]: v }))}
          />
        ))}
      </div>
    </BottomSheet>
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
    <div
      data-testid="reorder-line"
      style={{ display: 'flex', alignItems: 'flex-start', gap: 10, opacity: line.available ? 1 : 0.5 }}
    >
      <Checkbox checked={checked} disabled={!line.available} onChange={() => onChange({ checked: !checked, quantity: qty })}>
        <span style={SR_ONLY}>{vi.reorder.selectLine(line.productName)}</span>
      </Checkbox>
      <div
        style={{
          width: 56, height: 56, flex: '0 0 auto', overflow: 'hidden',
          borderRadius: 'var(--radius-media)', background: 'var(--color-bg-subtle)',
        }}
      >
        {line.thumbnail && (
          <img src={line.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Text variant="body-sm" as="div" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {line.productName}
        </Text>
        {line.variationName && (
          <Text variant="caption" tone="tertiary" as="div">
            {line.variationName}
          </Text>
        )}
        {line.available ? (
          <>
            <PriceTag value={line.unitPrice} size="sm" />
            <QuantitySelector value={qty} max={line.maxQuantity} size="md" onChange={(n) => onChange({ checked, quantity: n })} />
          </>
        ) : (
          <Text variant="caption" tone="danger" as="div">
            {vi.reorder.unavailable}
          </Text>
        )}
      </div>
    </div>
  );
}
