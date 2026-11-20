import type { RefillSavingPill } from '@tubutree/app-core/refill/refill-saving';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Text } from '../ui/text';

export interface PdpRebuyRowProps {
  /** "dd/mm" của lần mua (đơn đã giao) gần nhất, từ `pdpRebuy`. */
  dateLabel: string;
  /** Tên phân loại lần trước, để nhãn đọc nói rõ nút thêm phân loại nào. */
  variationName: string;
  busy: boolean;
  /** Một lệnh ghi giỏ khác của trang đang chạy (chung khoá): báo bằng aria-disabled, không `disabled`, để nút đang giữ focus không rớt focus. */
  blocked: boolean;
  onRebuy: () => void;
  /** Chai đã ghép gói Refill (cặp công khai, cờ `catalog.refill_first_enabled`): liên kết dưới dòng mở trang gói Refill. */
  refill?: RefillSavingPill | null;
  onRefill?: (slug: string) => void;
}

const REFILL_LINK = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--space-inline-xs) var(--space-inline-sm)',
  width: '100%',
  boxSizing: 'border-box',
  margin: 0,
  padding: '0 var(--space-inset-page) var(--space-inset-card)',
  border: 0,
  background: 'var(--color-bg-surface)',
  textAlign: 'left',
  cursor: 'pointer',
} as const;

/**
 * "Bạn đã mua ngày dd/mm · Mua lại": một chạm thêm đúng phân loại lần trước, số lượng 1. Nút phụ, không tranh với nút mua ở thanh dưới.
 * Có `refill` thì dưới dòng là liên kết "Đổi sang túi Refill 10L · Rẻ hơn 34%/100ml" (khách đã nhận chai này nên không cần mua chai nữa).
 */
export function PdpRebuyRow({
  dateLabel,
  variationName,
  busy,
  blocked,
  onRebuy,
  refill,
  onRefill,
}: PdpRebuyRowProps) {
  return (
    <>
      <div
        data-pdp-block="rebuy"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-inline-sm)',
          padding: '0 var(--space-inset-page) var(--space-inset-card)',
          background: 'var(--color-bg-surface)',
        }}
      >
        <Text variant="body-sm" tone="secondary" numeric style={{ minWidth: 0 }}>
          {fillCopy('pdp.rebuyLine', { date: dateLabel })}
        </Text>
        <Button
          variant="secondary"
          loading={busy}
          aria-disabled={blocked || undefined}
          aria-label={fillCopy('pdp.rebuySpoken', { name: variationName, date: dateLabel })}
          onPress={onRebuy}
          style={{ flex: '0 0 auto', minWidth: 0 }}
        >
          {fillCopy('pdp.rebuyCta')}
        </Button>
      </div>
      {refill && (
        <button
          type="button"
          data-testid="pdp-refill"
          className="tubu-hit-44"
          aria-label={refill.spoken}
          onClick={() => onRefill?.(refill.slug)}
          style={REFILL_LINK}
        >
          <Text
            variant="body-sm"
            tone="brand"
            style={{ fontWeight: 600, textDecoration: 'underline' }}
          >
            {refill.label}
          </Text>
          {refill.badge && (
            <Badge tone="success" size="sm">
              {refill.badge}
            </Badge>
          )}
        </button>
      )}
    </>
  );
}
