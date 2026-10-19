import { CircleAlert, TriangleAlert } from 'lucide-react';
import type { GameProfile } from '@tubutree/app-core/api/game';

// Cảnh báo héo/chết (§6.7.3)
export function TreeHealthAlert({ health }: { health: GameProfile['treeHealth'] }) {
  if (health === 'WILTED') {
    return (
      <div role="status" data-testid="tree-health" className="flex items-start gap-2 rounded-control bg-warning-bg p-3">
        <TriangleAlert className="mt-0.5 h-4 w-4 flex-none text-warning-fg" aria-hidden="true" />
        <p className="text-xs text-warning-fg">Cây đang héo vì lâu chưa tưới — tưới ngay để hồi phục nhé!</p>
      </div>
    );
  }
  if (health === 'DEAD') {
    return (
      <div role="status" data-testid="tree-health" className="flex items-start gap-2 rounded-control bg-danger-bg p-3">
        <CircleAlert className="mt-0.5 h-4 w-4 flex-none text-danger-fg" aria-hidden="true" />
        <p className="text-xs text-danger-fg">Cây đã héo úa do quá 7 ngày không tưới. Tưới lại sẽ trồng cây mới từ đầu.</p>
      </div>
    );
  }
  return null;
}
