import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Icon } from './icon';
import { Text } from './text';

export interface ListRowProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** 'switch' is a placeholder slot (renders nothing) until Task 19 adds the themed `Switch`
   * wrapper — rendering the literal string here instead would be worse than rendering nothing. */
  trailing?: 'chevron' | 'switch' | ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Dòng trong danh sách cài đặt/menu: icon + tiêu đề + mô tả + phần bên phải.
 *
 * `onClick` giờ nằm trên NGUYÊN HÀNG (`role="button"`), không chỉ vùng chữ như bản cũ ở
 * primitives.tsx — bản cũ áp hiệu ứng nhấn `tubu-press` cho cả hàng nhưng chỉ gắn `onClick` vào
 * `Box` bọc tiêu đề, nên chạm vào icon/khoảng trống/chevron bên phải không có phản hồi gì
 * (audit A4-07). */
export function ListRow({ icon, title, subtitle, trailing, onPress, destructive, className, style }: ListRowProps) {
  const interactive = typeof onPress === 'function';
  const trailingNode = trailing === 'chevron' ? <Icon icon={ChevronRight} size="sm" tone="muted" /> : trailing === 'switch' ? null : trailing;

  // Hàng là div role=button → tự làm bàn phím: Tab + Enter/Space. Chỉ khi phím bấm TRÊN hàng (không phải
  // nút/liên kết lồng trong `trailing`) để không bắn đôi. Hàng không tương tác: không role, không tabIndex.
  const onKeyDown = interactive
    ? (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget || e.repeat) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPress();
        }
      }
    : undefined;

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onPress}
      onKeyDown={onKeyDown}
      className={[interactive ? 'tubu-press' : '', className].filter(Boolean).join(' ') || undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '12px 0',
        minHeight: 44,
        boxSizing: 'border-box',
        cursor: interactive ? 'pointer' : undefined,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        {icon}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body-sm" tone={destructive ? 'danger' : 'primary'} as="div" style={{ fontWeight: 600 }}>
            {title}
          </Text>
          {subtitle && (
            <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>
              {subtitle}
            </Text>
          )}
        </div>
      </div>
      {trailingNode}
    </div>
  );
}
