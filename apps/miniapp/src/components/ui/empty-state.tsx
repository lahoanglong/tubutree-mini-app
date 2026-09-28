import { Button as ZmpButton, Text } from 'zmp-ui';
import { Button } from './button';

/**
 * Empty state theo spec §7.7: illustration + heading + body + CTA.
 * SVG inline theo palette brand — 0 network request, đổi theme tự động qua CSS vars.
 */
type Art = 'basket' | 'box' | 'search' | 'sprout' | 'leaf';

const ART: Record<Art, React.ReactNode> = {
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
  /** true khi hành động của CTA đang chạy — disable nút để chặn double-tap (vd. tạo trùng gian hàng). */
  ctaLoading?: boolean;
  /** 'page' (mặc định, padding rộng cho trang trống toàn màn hình) hay 'inline' (padding hẹp khi nhúng trong 1 section). */
  variant?: 'page' | 'inline';
}

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
      <Text bold style={{ fontSize: 17, marginTop: 10 }}>
        {heading}
      </Text>
      {body && (
        <Text size="small" style={{ color: 'var(--color-text-secondary)', maxWidth: 260 }}>
          {body}
        </Text>
      )}
      {ctaLabel && onCta && (
        // Button (DS v2, ./button) — tự chặn double-tap khi loading NGAY BÊN TRONG, nên không
        // cần (và không được) truyền disabled={ctaLoading} nữa: đó chính là bug cũ (loading &&
        // !disabled của zmp-ui khiến spinner không bao giờ hiện khi disabled cũng bật cùng lúc).
        <Button loading={ctaLoading} onPress={onCta} style={{ marginTop: 14 }}>
          {ctaLabel}
        </Button>
      )}
    </div>
  );
}

/** Error state với nút thử lại — dùng khi query fail. */
export function ErrorState({
  message,
  onRetry,
  variant = 'page',
}: {
  message: string;
  onRetry: () => void;
  /** 'page' (mặc định, padding rộng) hay 'inline' (padding hẹp khi nhúng trong 1 section). */
  variant?: 'page' | 'inline';
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: variant === 'inline' ? '16px' : '40px 32px',
        gap: 10,
      }}
    >
      {ART.leaf}
      <Text size="small" style={{ color: 'var(--color-text-secondary)', maxWidth: 260 }}>
        {message}
      </Text>
      <ZmpButton
        variant="secondary"
        onClick={onRetry}
        style={{
          minHeight: 44,
          color: 'var(--color-action-secondary-fg)',
          borderColor: 'var(--color-action-secondary-border)',
        }}
      >
        Thử lại
      </ZmpButton>
    </div>
  );
}
