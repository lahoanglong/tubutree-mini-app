'use client';

// Nguồn: apps/miniapp/src/components/ui/empty-state.tsx (EmptyState; ErrorState dùng ui/error-state.tsx của web)
import type { ReactNode } from 'react';
import { Button } from './button';

/**
 * Trạng thái rỗng: minh hoạ + tiêu đề + mô tả + nút. SVG inline theo palette brand — 0 request, đổi theme qua CSS vars.
 */
type Art = 'basket' | 'box' | 'search' | 'sprout' | 'leaf';

const ART: Record<Art, ReactNode> = {
  /* Rổ tre + chiếc lá — empty cart */
  basket: (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
      <ellipse cx="60" cy="86" rx="38" ry="6" fill="var(--stone-100)" />
      <path d="M28 44h64l-7 36a6 6 0 0 1-5.9 5H40.9a6 6 0 0 1-5.9-5l-7-36z" fill="var(--color-promo-bg)" />
      <path d="M28 44h64l-2 10H30l-2-10z" fill="var(--color-promo-solid-bg)" opacity="0.4" />
      <path d="M34 44c0-15 11-26 26-26s26 11 26 26" stroke="var(--color-promo-fg)" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <path d="M40 54v22M52 54v26M68 54v26M80 54v22" stroke="var(--color-promo-fg)" strokeWidth="2" opacity="0.25" strokeLinecap="round" />
      <path d="M74 30c8-9 18-10 24-8-1 7-7 15-16 16-4 .5-7-1-8-3" fill="var(--color-action-primary-bg)" />
      <path d="M76 32c6-5 13-7 19-7" stroke="var(--color-text-brand)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  ),
  /* Hộp giấy + sticky note — empty orders */
  box: (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
      <ellipse cx="60" cy="88" rx="36" ry="5" fill="var(--stone-100)" />
      <path d="M30 38l30-14 30 14v34a4 4 0 0 1-2.3 3.6L60 88 32.3 75.6A4 4 0 0 1 30 72V38z" fill="var(--color-action-secondary-bg)" />
      <path d="M30 38l30 13 30-13M60 51v37" stroke="var(--color-action-secondary-fg)" strokeWidth="2" opacity="0.5" />
      <path d="M45 31l30 13" stroke="var(--color-action-secondary-fg)" strokeWidth="2" opacity="0.3" />
      <rect x="68" y="56" width="22" height="18" rx="2" fill="var(--color-flash-bg)" transform="rotate(6 79 65)" />
      <path d="M72 62l14 1M72 67l10 1" stroke="var(--color-text-primary)" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
    </svg>
  ),
  /* Kính lúp + lá — search no result */
  search: (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
      <circle cx="54" cy="42" r="24" stroke="var(--color-text-tertiary)" strokeWidth="5" fill="var(--color-bg-canvas)" />
      <path d="M72 60l16 16" stroke="var(--color-text-tertiary)" strokeWidth="6" strokeLinecap="round" />
      <path d="M46 44c2-8 9-13 16-13-1 8-6 14-13 15-1.5.2-2.7-.6-3-2z" fill="var(--color-action-primary-bg)" />
      <path d="M48 44c4-6 9-9 13-10" stroke="var(--color-text-brand)" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  ),
  /* Mầm non — wishlist/garden trống */
  sprout: (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
      <ellipse cx="60" cy="84" rx="30" ry="6" fill="var(--stone-100)" />
      <path d="M48 84c0-10 4-18 12-22" stroke="var(--color-text-brand)" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <path d="M60 62c-2-10 3-19 12-22 2 10-2 19-12 22z" fill="var(--color-action-primary-bg)" />
      <path d="M60 62c-8-2-16-9-17-18 9 0 16 7 17 18z" fill="var(--color-text-brand)" />
    </svg>
  ),
  /* Lá đơn — generic */
  leaf: (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
      <path d="M38 70c-2-24 14-44 44-46 2 28-12 46-36 48-4 .3-7-1-8-2z" fill="var(--color-action-primary-bg)" />
      <path d="M42 68c8-18 22-32 36-40" stroke="var(--color-text-brand)" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  ),
};

interface EmptyStateProps {
  art: Art;
  heading: string;
  body?: string;
  ctaLabel?: string;
  onCta?: () => void;
  /** true khi hành động của CTA đang chạy — Button tự chặn bấm lại, spinner vẫn hiện. */
  ctaLoading?: boolean;
  /** 'page' (mặc định, đệm rộng cho trang trống toàn màn hình) hay 'inline' (đệm hẹp khi nhúng trong một mục). */
  variant?: 'page' | 'inline';
}

// Chữ khớp zmp Text của bản Mini App: tiêu đề weight 500 cỡ 17 (dòng 20), mô tả cỡ 14/18.
export function EmptyState({ art, heading, body, ctaLabel, onCta, ctaLoading, variant = 'page' }: EmptyStateProps) {
  return (
    <div
      className="tubu-rise"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: variant === 'inline' ? '16px' : '40px 32px',
        gap: 6,
      }}
    >
      {ART[art]}
      <span style={{ display: 'block', fontWeight: 500, fontSize: 17, lineHeight: '20px', marginTop: 10 }}>{heading}</span>
      {body && (
        <span style={{ display: 'block', fontSize: 14, lineHeight: '18px', color: 'var(--color-text-secondary)', maxWidth: 260 }}>
          {body}
        </span>
      )}
      {ctaLabel && onCta && (
        <Button loading={ctaLoading} onPress={onCta} style={{ marginTop: 14 }}>
          {ctaLabel}
        </Button>
      )}
    </div>
  );
}
