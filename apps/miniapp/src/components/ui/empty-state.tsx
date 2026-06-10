import { Button, Text } from 'zmp-ui';

/**
 * Empty state theo spec §7.7: illustration + heading + body + CTA.
 * SVG inline theo palette brand — 0 network request, đổi theme tự động qua CSS vars.
 */
type Art = 'basket' | 'box' | 'search' | 'sprout' | 'leaf';

const ART: Record<Art, React.ReactNode> = {
  /* Rổ tre + chiếc lá — empty cart */
  basket: (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
      <ellipse cx="60" cy="86" rx="38" ry="6" fill="var(--neutral-100)" />
      <path d="M28 44h64l-7 36a6 6 0 0 1-5.9 5H40.9a6 6 0 0 1-5.9-5l-7-36z" fill="var(--clay-200)" />
      <path d="M28 44h64l-2 10H30l-2-10z" fill="var(--clay-500)" opacity="0.4" />
      <path d="M34 44c0-15 11-26 26-26s26 11 26 26" stroke="var(--clay-700)" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <path d="M40 54v22M52 54v26M68 54v26M80 54v22" stroke="var(--clay-700)" strokeWidth="2" opacity="0.25" strokeLinecap="round" />
      <path d="M74 30c8-9 18-10 24-8-1 7-7 15-16 16-4 .5-7-1-8-3" fill="var(--leaf-400)" />
      <path d="M76 32c6-5 13-7 19-7" stroke="var(--leaf-700)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  ),
  /* Hộp giấy + sticky note — empty orders */
  box: (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
      <ellipse cx="60" cy="88" rx="36" ry="5" fill="var(--neutral-100)" />
      <path d="M30 38l30-14 30 14v34a4 4 0 0 1-2.3 3.6L60 88 32.3 75.6A4 4 0 0 1 30 72V38z" fill="var(--primary-100)" />
      <path d="M30 38l30 13 30-13M60 51v37" stroke="var(--primary-700)" strokeWidth="2" opacity="0.5" />
      <path d="M45 31l30 13" stroke="var(--primary-700)" strokeWidth="2" opacity="0.3" />
      <rect x="68" y="56" width="22" height="18" rx="2" fill="var(--sun-300)" transform="rotate(6 79 65)" />
      <path d="M72 62l14 1M72 67l10 1" stroke="var(--primary-900)" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
    </svg>
  ),
  /* Kính lúp + lá — search no result */
  search: (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
      <circle cx="54" cy="42" r="24" stroke="var(--neutral-400)" strokeWidth="5" fill="var(--neutral-50)" />
      <path d="M72 60l16 16" stroke="var(--neutral-400)" strokeWidth="6" strokeLinecap="round" />
      <path d="M46 44c2-8 9-13 16-13-1 8-6 14-13 15-1.5.2-2.7-.6-3-2z" fill="var(--leaf-400)" />
      <path d="M48 44c4-6 9-9 13-10" stroke="var(--leaf-700)" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  ),
  /* Mầm non — wishlist/garden trống */
  sprout: (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
      <ellipse cx="60" cy="84" rx="30" ry="6" fill="var(--neutral-100)" />
      <path d="M48 84c0-10 4-18 12-22" stroke="var(--leaf-600)" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <path d="M60 62c-2-10 3-19 12-22 2 10-2 19-12 22z" fill="var(--leaf-400)" />
      <path d="M60 62c-8-2-16-9-17-18 9 0 16 7 17 18z" fill="var(--leaf-600)" />
    </svg>
  ),
  /* Lá đơn — generic */
  leaf: (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
      <path d="M38 70c-2-24 14-44 44-46 2 28-12 46-36 48-4 .3-7-1-8-2z" fill="var(--leaf-400)" />
      <path d="M42 68c8-18 22-32 36-40" stroke="var(--leaf-700)" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  ),
};

interface EmptyStateProps {
  art: Art;
  heading: string;
  body?: string;
  ctaLabel?: string;
  onCta?: () => void;
}

export function EmptyState({ art, heading, body, ctaLabel, onCta }: EmptyStateProps) {
  return (
    <div
      className="tubu-rise"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: '40px 32px',
        gap: 6,
      }}
    >
      {ART[art]}
      <Text bold style={{ fontSize: 17, marginTop: 10 }}>
        {heading}
      </Text>
      {body && (
        <Text size="small" style={{ color: 'var(--neutral-600)', maxWidth: 260 }}>
          {body}
        </Text>
      )}
      {ctaLabel && onCta && (
        <Button
          onClick={onCta}
          style={{ background: 'var(--primary-600)', marginTop: 14, minHeight: 44 }}
        >
          {ctaLabel}
        </Button>
      )}
    </div>
  );
}

/** Error state với nút thử lại — dùng khi query fail. */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: '40px 32px',
        gap: 10,
      }}
    >
      {ART.leaf}
      <Text size="small" style={{ color: 'var(--neutral-600)', maxWidth: 260 }}>
        {message}
      </Text>
      <Button
        variant="secondary"
        onClick={onRetry}
        style={{ minHeight: 44, color: 'var(--primary-700)', borderColor: 'var(--primary-200)' }}
      >
        Thử lại
      </Button>
    </div>
  );
}
