'use client';

// Nguồn: apps/miniapp/src/components/orders/order-action-bar.tsx (web: dính đáy ở điện thoại, nằm trong thẻ từ md)
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { CreditCard, MoreHorizontal, Phone, RotateCcw, ShoppingBag, Star, XCircle, type LucideIcon } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { orderActionLabel, type OrderActionKind, type OrderActionPlan } from '@tubutree/app-core/commerce/order-tracking';
import { BottomSheet } from '@/components/mini/bottom-sheet';
import { Button } from '@/components/mini/button';
import { Icon } from '@/components/mini/icon';
import { IconButton } from '@/components/mini/icon-button';
import { ListRow } from '@/components/mini/list-row';
import { Text } from '@/components/mini/text';
import { safeAreaPadX } from '@/lib/safe-area';

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
  /** Cha gọi `focusRef.current()` để trả focus về nút chính sau khi đóng hộp xác nhận mở từ thanh (Safari không focus nút khi bấm). */
  focusRef?: MutableRefObject<(() => void) | null>;
}

/**
 * Thanh nút của đơn: đúng một nút chính theo trạng thái, các việc còn lại vào "Thêm thao tác".
 * Dưới md dính đáy toàn chiều ngang như StickyActionBar của Mini App (báo qua `has-sticky-bar` + `--sticky-bar-h` để trang chừa chỗ,
 * thanh tab ẩn đi); từ md nằm trong luồng trang, bề rộng theo cột chứa.
 */
export function OrderActionBar({ plan, returnMore, note, busy, onAction, focusRef }: OrderActionBarProps) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const primaryWrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusRef) return;
    focusRef.current = () => primaryWrap.current?.querySelector('button')?.focus();
    return () => {
      focusRef.current = null;
    };
  }, [focusRef]);
  useEffect(() => {
    const root = document.documentElement;
    const bar = ref.current;
    const measure = () => {
      const fixed = !!bar && getComputedStyle(bar).position === 'fixed';
      document.body.classList.toggle('has-sticky-bar', fixed);
      if (fixed && bar) root.style.setProperty('--sticky-bar-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
      else root.style.removeProperty('--sticky-bar-h');
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' || !bar ? null : new ResizeObserver(measure);
    if (bar) observer?.observe(bar);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty('--sticky-bar-h');
      document.body.classList.remove('has-sticky-bar');
    };
  }, []);
  const { primary, more } = plan;
  if (!primary) return null;
  const labelOf = (k: OrderActionKind) => orderActionLabel(k, { returnMore });
  return (
    <>
      <div
        ref={ref}
        data-testid="order-action-bar"
        data-sticky-bar
        className="fixed inset-x-0 bottom-0 z-30 flex flex-col gap-2 bg-[var(--color-bg-surface)] pt-4 [box-shadow:var(--elevation-3)] md:static md:z-auto md:bg-transparent md:p-0 md:[box-shadow:none]"
        style={{ ...safeAreaPadX('1rem'), paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
      >
        {note && (
          <Text variant="caption" tone="secondary" as="div" data-testid="order-action-note">
            {note}
          </Text>
        )}
        <div className="flex gap-2.5">
          {more.length > 0 && <IconButton icon={MoreHorizontal} label={fillCopy('order.action.more')} onPress={() => setMenu(true)} />}
          <div ref={primaryWrap} className="min-w-0 flex-1">
            <Button
              fullWidth
              disabled={busy}
              variant={primary === 'cancel' ? 'secondary' : 'primary'}
              onPress={() => onAction(primary)}
              style={primary === 'cancel' ? { color: 'var(--color-text-danger)' } : { fontWeight: 700 }}
            >
              {labelOf(primary)}
            </Button>
          </div>
        </div>
      </div>
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
