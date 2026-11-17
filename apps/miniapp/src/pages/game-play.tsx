import { lazy, Suspense } from 'react';
import { Page, useParams } from 'zmp-ui';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { isPlayableMiniGame } from '@tubutree/app-core/game-mini/format';
import { EmptyState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';
import { useSmartNavigate } from '../lib/smart-nav';

const MiniRoundShell = lazy(() => import('../components/game/mini/mini-round-shell'));

/** Màn chơi một game mini (`/game/play/:game`, cặp web `/vuon-xanh/choi/:game`). Khung ván và bàn chơi là chunk lười riêng. */
export default function GamePlayPage() {
  const { game } = useParams<{ game?: string }>();
  const goSmart = useSmartNavigate();
  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      {isPlayableMiniGame(game) ? (
        <Suspense fallback={<PageHeader title={gameCopy('entry.title')} />}>
          <MiniRoundShell game={game} />
        </Suspense>
      ) : (
        <>
          <PageHeader title={gameCopy('entry.title')} />
          <EmptyState art="sprout" heading={gameCopy('notFound')} ctaLabel={gameCopy('result.done')} onCta={() => goSmart('/game')} />
        </>
      )}
    </Page>
  );
}
