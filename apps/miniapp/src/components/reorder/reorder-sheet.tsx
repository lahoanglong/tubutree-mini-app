import { useEffect, useRef, useState } from 'react';
import { vi } from '../../i18n/vi';
import { formatVnd } from '../../utils/format';
import { useCartUnits } from '../../hooks/use-cart-units';
import { useReorder } from '../../hooks/use-reorder';
import { useSheetSeq } from '../../hooks/use-sheet-seq';
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
  availableLines, availableSelectionState, initialSelection, lineAt, selectedLines, selectionSavings, selectionTotals, targetLines, toggleAllAvailable,
  unitsSharingCartLine,
  type LineSelection, type ReorderLine, type ReorderSource, type ReorderTarget,
} from './reorder-types';
import { ProductThumb } from '../ui/product-thumb';
import { reorderSavingsNote, reorderSkippedNote, type ReorderLineNotice } from '@tubutree/app-core/commerce/reorder-notice';

/** Khoảng giữa ô chọn, ảnh và chữ của một hàng (web: gap-2.5): dòng sản phẩm và hàng Chọn tất cả dùng chung để chữ thẳng cột. */
const ROW_GAP = 10;

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
  // Giỏ gộp số lượng cùng biến thể rồi mới so với suất Giờ vàng: giá hiện ở sheet phải tính cả phần đã có sẵn trong giỏ. Số liệu đóng
  // băng từ lúc bấm thêm, vì giỏ tải lại sau khi thêm sẽ đếm phần vừa thêm hai lần và làm giá nhảy trong lúc sheet trượt xuống.
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
      setFrozenCart(null);
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
  const skippedNote = reorderSkippedNote(lines);
  const { units, subtotal } = view ? selectionTotals(view, sel, cart) : { units: 0, subtotal: 0 };
  const savedNote = view ? reorderSavingsNote(selectionSavings(view, sel, cart)) : null;
  const availableCount = view ? availableLines(view).length : 0;
  const selectionState = view ? availableSelectionState(view, sel) : 'none';

  // Khoá ĐỒNG BỘ chống chạm đúp: isPending của react-query chỉ cập nhật sau một nhịp notify
  // (setTimeout 0) nên cú chạm thứ hai trong cùng nhịp vẫn thấy isPending=false.
  const inFlight = useRef(false);
  // Số lần mở của sheet, theo mã đích (đơn hoặc món): khách đóng sheet rồi mở lại (cùng đơn hay đơn khác) trong lúc lệnh còn bay thì lệnh cũ xong muộn
  // không được đóng sheet mới mở. Sheet sống qua các lần mở (cha chỉ đổi `target`), nên số đếm đặt ở đây là đủ.
  const sheetSeq = useSheetSeq(target ? (target.kind === 'order' ? `order:${target.orderCode}` : `item:${target.line.key}`) : null);
  const submit = async () => {
    if (!target || units === 0 || !cartReady || inFlight.current) return;
    inFlight.current = true;
    const sent = sheetSeq.mark();
    setFrozenCart(liveCart);
    let added = false;
    try {
      const summary = await reorder.submit(target, selectedLines(target, sel), () => sheetSeq.isCurrent(sent));
      added = summary.addedUnits > 0;
    } catch {
      /* useReorder đã báo lỗi — giữ sheet + lựa chọn để khách bấm lại */
    } finally {
      inFlight.current = false;
    }
    if (!added) setFrozenCart(null);
    // Ngoài try: lỗi của onClose (bug của caller) không bị nuốt như lỗi mạng.
    if (added && sheetSeq.isCurrent(sent)) onClose();
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
          {savedNote && (
            <Text variant="caption" tone="success" as="div" numeric data-testid="reorder-savings-note" style={{ fontWeight: 600 }}>
              {savedNote}
            </Text>
          )}
          <Text variant="caption" tone="tertiary" as="div">
            {vi.reorder.priceNote}
          </Text>
          <Button fullWidth size="lg" loading={reorder.isPending || !cartReady} disabled={units === 0} onPress={() => void submit()}>
            {vi.reorder.addCta(units)}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {skippedNote && (
          <Text variant="body-sm" tone="secondary" as="p" data-testid="reorder-skipped-note">
            {skippedNote}
          </Text>
        )}
        {view && availableCount >= 2 && (
          // Cùng nhịp với dòng sản phẩm bên dưới (ô 44px + khoảng 10px) để chữ thẳng hàng với ảnh và với web; chữ nhìn thấy ẩn khỏi trình đọc
          // màn hình (tên của ô đã nằm trong nhãn ẩn) và vẫn chạm được.
          <div style={{ display: 'flex', alignItems: 'center', gap: ROW_GAP }}>
            <Checkbox
              data-testid="reorder-toggle-all"
              checked={selectionState === 'all'}
              indeterminate={selectionState === 'some'}
              onChange={() => setSel((s) => toggleAllAvailable(view, s))}
            >
              <span style={SR_ONLY}>{vi.reorder.selectAll(availableCount)}</span>
            </Checkbox>
            <div
              aria-hidden="true"
              data-testid="reorder-toggle-all-label"
              onClick={() => setSel((s) => toggleAllAvailable(view, s))}
              style={{ flex: 1, alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}
            >
              <Text variant="body-sm" tone="primary" style={{ fontWeight: 600 }}>
                {vi.reorder.selectAll(availableCount)}
              </Text>
            </div>
          </div>
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
    </BottomSheet>
  );
}

function ReorderLineRow({
  line,
  value,
  inCart,
  onChange,
}: {
  line: ReorderLine;
  value: LineSelection | undefined;
  /** Số lượng cùng biến thể sẽ nằm chung dòng giỏ (đã có sẵn + dòng khác của sheet). */
  inCart: number;
  onChange: (v: LineSelection) => void;
}) {
  const checked = line.available && (value?.checked ?? false);
  const qty = value?.quantity ?? line.defaultQuantity;
  const { unitPrice, notices } = lineAt(line, qty, inCart);
  return (
    <div
      data-testid="reorder-line"
      style={{ display: 'flex', alignItems: 'flex-start', gap: ROW_GAP }}
    >
      <Checkbox checked={checked} disabled={!line.available} onChange={() => onChange({ checked: !checked, quantity: qty })}>
        <span style={SR_ONLY}>{vi.reorder.selectLine(line.productName)}</span>
      </Checkbox>
      {/* Mờ chỉ ảnh: chữ giải thích mờ theo cả dòng chỉ còn 2,3:1 (WCAG 1.4.3). */}
      <div style={{ flex: 'none', opacity: line.available ? 1 : 0.5 }}>
        <ProductThumb src={line.thumbnail} alt="" size={56} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Text variant="body-sm" tone={line.available ? 'primary' : 'secondary'} as="div" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {line.productName}
        </Text>
        {line.variationName && (
          <Text variant="caption" tone="tertiary" as="div">
            {line.variationName}
          </Text>
        )}
        {line.available && <PriceTag value={unitPrice} size="sm" />}
        <LineNotices notices={notices} />
        {line.available && (
          <QuantitySelector value={qty} max={line.maxQuantity} size="md" itemLabel={line.productName} onChange={(n) => onChange({ checked, quantity: n })} />
        )}
      </div>
    </div>
  );
}

/** Hết hàng, ngừng bán, đã giảm số lượng, giá đổi: mỗi câu một dòng ngay dưới giá, đọc liền với tên món. */
function LineNotices({ notices }: { notices: readonly ReorderLineNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <>
      {notices.map((n) => (
        <Text key={n.kind} variant="caption" tone={n.tone} as="div" numeric data-notice={n.kind}>
          {n.text}
        </Text>
      ))}
    </>
  );
}
