import { fillCopy } from '@tubutree/app-core/shop-copy';
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
}

/** "Bạn đã mua ngày dd/mm · Mua lại": một chạm thêm đúng phân loại lần trước, số lượng 1. Nút phụ, không tranh với nút mua ở thanh dưới. */
export function PdpRebuyRow({ dateLabel, variationName, busy, blocked, onRebuy }: PdpRebuyRowProps) {
  return (
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
  );
}
