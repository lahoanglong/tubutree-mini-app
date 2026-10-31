'use client';

// Nguồn: apps/miniapp/src/components/ui/icon.tsx
import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';

const SIZE_PX = { sm: 16, md: 20, lg: 24 } as const;

export interface IconProps {
  icon: LucideIcon;
  size?: keyof typeof SIZE_PX;
  tone?: 'default' | 'muted' | 'brand' | 'danger' | 'inverse' | 'current';
  /** Tô đặc nhẹ 16% cùng màu nét + nét 2: tab đang chọn của thanh dưới (tín hiệu ngoài màu, WCAG 1.4.1). */
  filled?: boolean;
  className?: string;
  style?: CSSProperties;
  'data-testid'?: string;
}

const TONE_VAR: Record<NonNullable<IconProps['tone']>, string> = {
  default: 'var(--color-text-primary)',
  muted: 'var(--color-text-tertiary)',
  brand: 'var(--color-text-brand)',
  danger: 'var(--color-text-danger)',
  inverse: 'var(--color-text-inverse)',
  /** Ăn màu chữ của phần tử cha: icon trong huy hiệu/tiêu đề đã có màu riêng (khuyến mãi, cảnh báo). */
  current: 'currentColor',
};

/** Wrapper cố định strokeWidth 1,75 + 3 cỡ chuẩn (sm16/md20/lg24) — thay 8 giá trị strokeWidth
 * và 18 cỡ rải rác hiện tại (audit A4-16). */
export function Icon({ icon: LucideIconCmp, size = 'md', tone = 'default', filled, className, style, ...rest }: IconProps) {
  return (
    <LucideIconCmp
      size={SIZE_PX[size]}
      strokeWidth={filled ? 2 : 1.75}
      color={TONE_VAR[tone]}
      // `color` của lucide chỉ đặt stroke, nên fill phải lấy cùng giá trị tông chứ không dùng currentColor (màu chữ cha).
      {...(filled ? { fill: TONE_VAR[tone], fillOpacity: 0.16 } : null)}
      className={className}
      style={style}
      {...rest}
    />
  );
}
