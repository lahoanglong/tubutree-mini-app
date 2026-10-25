import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { Skeleton } from '@/components/ui/skeleton';
import { LoginRequired } from '@/components/login-required';

export function GameSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton height={160} rounded="rounded-card" />
      <Skeleton height={44} />
      <Skeleton height={56} rounded="rounded-card" />
      <Skeleton height={140} rounded="rounded-card" />
    </div>
  );
}

export function GameLoginGate({ returnTo }: { returnTo: string }) {
  return <LoginRequired message={gameNewbieCopy.loginToView} returnTo={returnTo} />;
}
