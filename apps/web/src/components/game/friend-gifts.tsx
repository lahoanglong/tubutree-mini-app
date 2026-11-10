'use client';

import { useMutationState } from '@tanstack/react-query';
import { Gift, Sprout } from 'lucide-react';
import type { Friend } from '@tubutree/app-core/api/game';
import { miniBtnSecondary } from '@/components/loyalty/mini-surface';
import { GameCard } from './game-card';
import { GIFT_MUTATION_KEY } from './use-game-actions';

// Tặng nước bạn bè (social). 💧 trên nút và 🌿 ở lời nhắn là nội dung game.
export function FriendGifts({ friends, onGift }: { friends: Friend[]; onGift: (recipientId: string) => void }) {
  // Khoá của lệnh theo từng bạn, nên nhiều bạn cùng đang bay: nút của MỌI bạn đó phải báo bận (không chỉ bạn bấm sau cùng) vì chạm lại vào họ bị khoá nuốt.
  const sendingIds = useMutationState({ filters: { mutationKey: GIFT_MUTATION_KEY, status: 'pending' }, select: (m) => m.state.variables as string });
  return (
    <GameCard title="Tặng nước cho bạn bè" icon={Gift}>
      {friends.map((f) => {
        const sending = sendingIds.includes(f.id);
        // Không `disabled`: nút đang giữ focus mà bị disabled (đang gửi, hay danh sách về với "đã tặng hôm nay") thì trình duyệt thả focus về body.
        const locked = sending || f.giftedToday;
        return (
          <div key={f.id} className="flex items-center justify-between gap-2 border-b border-stone-200 py-1.5">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-stone-900">
              <Sprout className="h-4 w-4 flex-none text-forest-600" aria-hidden="true" />
              <span className="truncate">{f.nickname}</span>
            </span>
            <button
              type="button"
              aria-busy={sending || undefined}
              aria-disabled={locked || undefined}
              onClick={() => {
                if (locked) return;
                onGift(f.id);
              }}
              className={`${miniBtnSecondary} flex-none`}
            >
              {f.giftedToday ? 'Đã tặng hôm nay' : 'Tặng 💧'}
            </button>
          </div>
        );
      })}
      <p className="mt-2 text-caption text-stone-600">Tặng nước cho bạn bè (người bạn mời hoặc người mời bạn) — mỗi người 1 lần/ngày 🌿</p>
    </GameCard>
  );
}
