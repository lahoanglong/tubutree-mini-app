import { Box, Text, Button } from 'zmp-ui';
import type { Friend } from '../../services/game-api';
import { GameCard } from './game-card';

// Tặng nước bạn bè (social)
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
    <GameCard title="🎁 Tặng nước cho bạn bè">
      {friends.map((f) => (
        <Box key={f.id} flex alignItems="center" justifyContent="space-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--neutral-100)' }}>
          <Text size="small">🌿 {f.nickname}</Text>
          <Button
            size="small"
            variant="secondary"
            disabled={f.giftedToday || (giftPending && giftVariables === f.id)}
            loading={giftPending && giftVariables === f.id}
            onClick={() => onGift(f.id)}
          >
            {f.giftedToday ? 'Đã tặng hôm nay' : 'Tặng 💧'}
          </Button>
        </Box>
      ))}
      <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 8 }}>
        Tặng nước cho bạn bè (người bạn mời hoặc người mời bạn) — mỗi người 1 lần/ngày 🌿
      </Text>
    </GameCard>
  );
}
