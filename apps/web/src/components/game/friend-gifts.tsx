import { Gift, Sprout } from 'lucide-react';
import type { Friend } from '@tubutree/app-core/api/game';
import { miniBtnSecondary } from '@/components/loyalty/mini-surface';
import { GameCard } from './game-card';

// Tặng nước bạn bè (social). 💧 trên nút và 🌿 ở lời nhắn là nội dung game.
export function FriendGifts({
  friends,
  giftPending,
  giftVariables,
  onGift,
}: {
  friends: Friend[];
  giftPending: boolean;
  giftVariables: string | undefined;
  onGift: (recipientId: string) => void;
}) {
  return (
    <GameCard title="Tặng nước cho bạn bè" icon={Gift}>
      {friends.map((f) => {
        const sending = giftPending && giftVariables === f.id;
        return (
          <div key={f.id} className="flex items-center justify-between gap-2 border-b border-stone-200 py-1.5">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-stone-900">
              <Sprout className="h-4 w-4 flex-none text-forest-600" aria-hidden="true" />
              <span className="truncate">{f.nickname}</span>
            </span>
            <button type="button" disabled={f.giftedToday || sending} onClick={() => onGift(f.id)} className={`${miniBtnSecondary} flex-none`}>
              {f.giftedToday ? 'Đã tặng hôm nay' : 'Tặng 💧'}
            </button>
          </div>
        );
      })}
      <p className="mt-2 text-xs text-stone-600">Tặng nước cho bạn bè (người bạn mời hoặc người mời bạn) — mỗi người 1 lần/ngày 🌿</p>
    </GameCard>
  );
}
