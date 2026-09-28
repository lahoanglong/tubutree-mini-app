import type { LucideIcon } from 'lucide-react';
import { Icon } from './icon';
import { Text, Heading } from './text';

export function StatTile({ label, value, delta, icon: IconCmp, onPress }: { label: string; value: string; delta?: string; icon?: LucideIcon; onPress?: () => void }) {
  return (
    <div role={onPress ? 'button' : undefined} onClick={onPress} className={onPress ? 'tubu-press' : undefined}
      style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--elevation-1)', padding: 12 }}>
      {IconCmp && <Icon icon={IconCmp} size="sm" tone="brand" />}
      <Heading variant="title-lg" as="div" style={{ marginTop: 4 }}>{value}</Heading>
      <Text variant="caption" tone="tertiary">{label}</Text>
      {delta && <Text variant="caption" tone="success">{delta}</Text>}
    </div>
  );
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
      {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Heading variant="title-sm" as="span" tone="inverse">{fallback.charAt(0).toUpperCase()}</Heading>}
    </div>
  );
}
