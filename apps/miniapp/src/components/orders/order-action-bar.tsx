import { useState } from 'react';
import { CreditCard, MoreHorizontal, Phone, RotateCcw, ShoppingBag, Star, XCircle, type LucideIcon } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { orderActionLabel, type OrderActionKind, type OrderActionPlan } from '@tubutree/app-core/commerce/order-tracking';
import { StickyActionBar } from '../ui/sticky-action-bar';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { IconButton } from '../ui/icon-button';
import { ListRow } from '../ui/list-row';
import { Text } from '../ui/text';

const ACTION_ICON: Record<OrderActionKind, LucideIcon> = {
  pay: CreditCard,
  cancel: XCircle,
  contact: Phone,
  review: Star,
  reorder: ShoppingBag,
  return: RotateCcw,
};

export interface OrderActionBarProps {
  plan: OrderActionPlan;
  /** Đã có yêu cầu được duyệt: nút đổi/trả đọc "Trả thêm sản phẩm". */
  returnMore?: boolean;
  /** Dòng nhỏ trên nút chính, ví dụ "Còn 2 giờ 05 phút để thanh toán". */
  note?: string | null;
  /** Đang gửi một việc (huỷ đơn): khoá nút chính để không gửi hai lần. */
  busy?: boolean;
  onAction: (kind: OrderActionKind) => void;
}

/** Thanh nút dính đáy của đơn: đúng một nút chính theo trạng thái, các việc còn lại vào "Thêm thao tác". */
export function OrderActionBar({ plan, returnMore, note, busy, onAction }: OrderActionBarProps) {
  const [menu, setMenu] = useState(false);
  const { primary, more } = plan;
  if (!primary) return null;
  const labelOf = (k: OrderActionKind) => orderActionLabel(k, { returnMore });
  return (
    <>
      <StickyActionBar
        summary={
          note ? (
            <Text variant="caption" tone="secondary" as="div" data-testid="order-action-note">
              {note}
            </Text>
          ) : undefined
        }
        secondary={
          more.length > 0 ? (
            <IconButton icon={MoreHorizontal} label={fillCopy('order.action.more')} onPress={() => setMenu(true)} />
          ) : undefined
        }
        primary={
          <Button
            fullWidth
            disabled={busy}
            variant={primary === 'cancel' ? 'secondary' : 'primary'}
            onPress={() => onAction(primary)}
            style={primary === 'cancel' ? { color: 'var(--color-text-danger)' } : { fontWeight: 700 }}
          >
            {labelOf(primary)}
          </Button>
        }
      />
      <BottomSheet open={menu} onClose={() => setMenu(false)} title={fillCopy('order.action.moreTitle')}>
        <div role="group" aria-label={fillCopy('order.action.moreTitle')}>
          {more.map((k) => (
            <ListRow
              key={k}
              icon={<Icon icon={ACTION_ICON[k]} tone={k === 'cancel' ? 'danger' : 'muted'} />}
              title={labelOf(k)}
              destructive={k === 'cancel'}
              onPress={() => {
                setMenu(false);
                onAction(k);
              }}
            />
          ))}
        </div>
      </BottomSheet>
    </>
  );
}
