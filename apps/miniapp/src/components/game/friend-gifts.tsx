import { Gift, Sprout } from 'lucide-react';
import type { Friend } from '../../services/game-api';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';
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
          <div
            key={f.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '6px 0',
              borderBottom: '1px solid var(--color-border-subtle)',
            }}
          >
            <Text variant="body-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <Icon icon={Sprout} size="sm" tone="brand" />
              {f.nickname}
            </Text>
            <Button variant="secondary" disabled={f.giftedToday || sending} loading={sending} onPress={() => onGift(f.id)}>
              {f.giftedToday ? 'Đã tặng hôm nay' : 'Tặng 💧'}
            </Button>
          </div>
        );
      })}
      <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 8 }}>
        Tặng nước cho bạn bè (người bạn mời hoặc người mời bạn) — mỗi người 1 lần/ngày 🌿
      </Text>
    </GameCard>
  );
}
