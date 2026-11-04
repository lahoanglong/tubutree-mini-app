'use client';

// Nguồn: apps/miniapp/src/components/ui/card.tsx
import type { CSSProperties, ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  variant?: 'raised' | 'outline' | 'flat';
  padding?: 0 | 8 | 12 | 16;
  onPress?: () => void;
  className?: string;
  style?: CSSProperties;
}

/** Đưa <button> về hình của <div>: không viền/đệm/nền riêng của trình duyệt, chữ và căn lề thừa hưởng, rộng đủ khung cha. */
const BUTTON_RESET: CSSProperties = { display: 'block', width: '100%', margin: 0, padding: 0, border: 'none', font: 'inherit', color: 'inherit', textAlign: 'inherit' };

const VARIANT_STYLE: Record<NonNullable<CardProps['variant']>, CSSProperties> = {
  raised: { background: 'var(--color-bg-surface)', boxShadow: 'var(--elevation-1)' },
  outline: { background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' },
  flat: { background: 'var(--color-bg-subtle)' },
};

/** Mặt phẳng nội dung tiêu chuẩn — thay 47 thẻ tự vẽ (audit A4-19). */
export function Card({ children, variant = 'raised', padding = 12, onPress, className, style }: CardProps) {
  const interactive = typeof onPress === 'function';
  const cardStyle: CSSProperties = { borderRadius: 'var(--radius-card)', ...VARIANT_STYLE[variant], ...style };
  // Có onPress thì là <button> thật (Tab/Enter/Space); div role="button" không tabindex, không phím thì bàn phím không tới được.
  if (interactive) {
    return (
      <button type="button" onClick={onPress} className={['tubu-press', className].filter(Boolean).join(' ')} style={{ ...BUTTON_RESET, ...cardStyle }}>
        <span style={{ display: 'block', padding }}>{children}</span>
      </button>
    );
  }
  return (
    <div className={className || undefined} style={cardStyle}>
      <div style={{ padding }}>{children}</div>
    </div>
  );
}
