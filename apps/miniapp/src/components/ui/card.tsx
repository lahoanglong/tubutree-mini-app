import type { CSSProperties, ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  variant?: 'raised' | 'outline' | 'flat';
  padding?: 0 | 8 | 12 | 16;
  onPress?: () => void;
  className?: string;
  style?: CSSProperties;
}

const VARIANT_STYLE: Record<NonNullable<CardProps['variant']>, CSSProperties> = {
  raised: { background: 'var(--color-bg-surface)', boxShadow: 'var(--elevation-1)' },
  outline: { background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' },
  flat: { background: 'var(--color-bg-subtle)' },
};

/** Mặt phẳng nội dung tiêu chuẩn — thay 47 thẻ tự vẽ (audit A4-19). */
export function Card({ children, variant = 'raised', padding = 12, onPress, className, style }: CardProps) {
  const interactive = typeof onPress === 'function';
  return (
    <div
      role={interactive ? 'button' : undefined}
      onClick={onPress}
      className={[interactive ? 'tubu-press' : '', className].filter(Boolean).join(' ')}
      style={{ borderRadius: 'var(--radius-card)', ...VARIANT_STYLE[variant], ...style }}
    >
      <div style={{ padding }}>{children}</div>
    </div>
  );
}
