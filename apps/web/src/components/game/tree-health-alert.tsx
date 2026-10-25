import { TriangleAlert } from 'lucide-react';
import type { GameProfile } from '@tubutree/app-core/api/game';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';

// Cây quá hạn chỉ héo, không mất tiến độ: DEAD (hồ sơ cũ) cũng hiện như héo.
export function TreeHealthAlert({ health }: { health: GameProfile['treeHealth'] }) {
  if (health !== 'WILTED' && health !== 'DEAD') return null;
  return (
    <div role="status" data-testid="tree-health" className="flex items-start gap-2 rounded-control bg-warning-bg p-3">
      <TriangleAlert className="mt-0.5 h-4 w-4 flex-none text-warning-fg" aria-hidden="true" />
      <p className="text-xs text-warning-fg">{gameNewbieCopy.treeWilted}</p>
    </div>
  );
}
