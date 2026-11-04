'use client';

// Nguồn: apps/miniapp/src/components/ui/tiles.tsx
import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './icon';
import { Text, Heading } from './text';

export function StatTile({ label, value, delta, icon: IconCmp, onPress }: { label: string; value: string; delta?: string; icon?: LucideIcon; onPress?: () => void }) {
  const style: CSSProperties = { background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--elevation-1)', padding: 12 };
  const body = (
    <>
      {IconCmp && <Icon icon={IconCmp} size="sm" tone="brand" />}
      <Heading variant="title-lg" as="div" style={{ marginTop: 4 }}>{value}</Heading>
      <Text variant="caption" tone="tertiary">{label}</Text>
      {delta && <Text variant="caption" tone="success">{delta}</Text>}
    </>
  );
  // Có onPress thì là <button> thật: div role="button" không tabindex, không phím thì bàn phím không tới được.
  if (onPress) {
    return (
      <button type="button" onClick={onPress} className="tubu-press" style={{ ...style, display: 'block', width: '100%', margin: 0, border: 'none', font: 'inherit', color: 'inherit', textAlign: 'inherit' }}>
        {body}
      </button>
    );
  }
  return <div style={style}>{body}</div>;
}

export function FlashBadge({ label }: { label: string }) {
  return <span style={{ background: 'var(--color-flash-solid-bg)', color: 'var(--color-flash-solid-fg)', fontWeight: 700, fontSize: 'var(--type-label-size)', padding: '3px 8px', borderRadius: 'var(--radius-pill)' }}>{label}</span>;
}

export function CountdownChip({ endsAt }: { endsAt: string }) {
  return <span style={{ background: 'var(--color-flash-bg)', color: 'var(--color-flash-fg)', fontWeight: 600, fontSize: 'var(--type-caption-size)', padding: '3px 8px', borderRadius: 'var(--radius-pill)' }} data-ends-at={endsAt} />;
}

export function Avatar({ src, fallback, size = 44 }: { src?: string | null; fallback: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', background: 'var(--color-action-primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Heading variant="title-sm" as="span" tone="inverse">{fallback.charAt(0).toUpperCase()}</Heading>}
    </div>
  );
}
