import { Skeleton } from '../ui/skeleton';
import { EmptyState } from '../ui/empty-state';
import { vi } from '../../i18n/vi';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';

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
  return <EmptyState art="sprout" heading={gameNewbieCopy.loginToView} ctaLabel={vi.auth.loginCta} onCta={onLogin} />;
}
