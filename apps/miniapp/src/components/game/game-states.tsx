import { Skeleton } from '../ui/skeleton';
import { EmptyState } from '../ui/empty-state';
import { vi } from '../../i18n/vi';

export function GameSkeleton() {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Skeleton height={160} radius="var(--radius-card)" />
      <Skeleton height={44} radius="var(--radius-control)" />
      <Skeleton height={56} radius="var(--radius-card)" />
      <Skeleton height={140} radius="var(--radius-card)" />
    </div>
  );
}

export function GameLoginGate({ onLogin }: { onLogin: () => void }) {
  return <EmptyState art="sprout" heading={vi.game.newbie.loginToView} ctaLabel={vi.auth.loginCta} onCta={onLogin} />;
}
