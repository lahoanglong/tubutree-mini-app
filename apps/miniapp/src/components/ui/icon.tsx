import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';

const SIZE_PX = { sm: 16, md: 20, lg: 24 } as const;

export interface IconProps {
  icon: LucideIcon;
  size?: keyof typeof SIZE_PX;
  tone?: 'default' | 'muted' | 'brand' | 'danger' | 'inverse';
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
};

/** Wrapper cố định strokeWidth 1,75 + 3 cỡ chuẩn (sm16/md20/lg24) — thay 8 giá trị strokeWidth
 * và 18 cỡ rải rác hiện tại (audit A4-16). */
export function Icon({ icon: LucideIconCmp, size = 'md', tone = 'default', className, style, ...rest }: IconProps) {
  return (
    <LucideIconCmp
      size={SIZE_PX[size]}
      strokeWidth={1.75}
      color={TONE_VAR[tone]}
      className={className}
      style={style}
      {...rest}
    />
  );
}
