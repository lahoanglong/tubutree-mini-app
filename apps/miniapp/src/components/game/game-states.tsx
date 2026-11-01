import { Skeleton } from '../ui/skeleton';
import { EmptyState } from '../ui/empty-state';
import { useBlockedMessage } from '../ui/auth-gate';
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
  // Tài khoản bị khoá: nói lý do ngay trên cổng như feed/cộng đồng, không chỉ trong thanh báo sau khi bấm.
  const blocked = useBlockedMessage();
  return <EmptyState art="sprout" heading={gameNewbieCopy.loginToView} body={blocked ?? undefined} ctaLabel={vi.auth.loginCta} onCta={onLogin} />;
}
