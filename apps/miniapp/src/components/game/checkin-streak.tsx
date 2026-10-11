import { Box, Text, Button } from 'zmp-ui';
import type { GameProfile } from '../../services/game-api';
import { formatDrops } from '../../utils/format';
import { isSameVNDay } from './game-utils';

export function CheckInStreak({
  profile,
  onCheckIn,
  checkInPending,
  onBuyFreeze,
  freezePending,
  onCollectDew,
  dewPending,
}: {
  profile: GameProfile | undefined;
  onCheckIn: () => void;
  checkInPending: boolean;
  onBuyFreeze: () => void;
  freezePending: boolean;
  onCollectDew: () => void;
  dewPending: boolean;
}) {
  const streakDays = profile?.streakDays;
  const dewCollectedToday = isSameVNDay(profile?.lastDewAt ?? null);
  const checkedInToday = isSameVNDay(profile?.lastCheckInAt ?? null);
  return (
    <Box p={3} style={{ background: 'var(--neutral-0)' }}>
      <Box flex alignItems="center" justifyContent="space-between" mb={2}>
        <Text size="small" bold>
          🔥 Điểm danh chuỗi {streakDays ?? 0} ngày
        </Text>
        <Button
          size="small"
          disabled={checkedInToday || checkInPending}
          loading={checkInPending}
          onClick={() => onCheckIn()}
          style={{ background: 'var(--leaf-600)' }}
        >
          {checkedInToday ? '✅ Đã điểm danh' : 'Điểm danh'}
        </Button>
      </Box>
      <Box flex style={{ gap: 6 }}>
        {Array.from({ length: 7 }, (_, i) => {
          const day = i + 1;
          const done = (streakDays ?? 0) % 7 === 0 && (streakDays ?? 0) > 0 ? true : day <= ((streakDays ?? 0) % 7);
          const bonus = day === 3 || day === 7;
          return (
            <Box key={i} style={{ flex: 1, textAlign: 'center' }}>
              <Box
                style={{
                  height: 32,
                  borderRadius: 'var(--radius-md)',
                  background: done ? 'var(--leaf-600)' : 'var(--neutral-100)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: done ? 'var(--neutral-0)' : 'var(--neutral-400)',
                  fontSize: 13,
                }}
              >
                {done ? '💧' : bonus ? '🎁' : day}
              </Box>
              <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                N{day}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Vé giữ lửa (streak-freeze) + giọt sương sáng (dew) */}
      <Box flex alignItems="center" justifyContent="space-between" style={{ gap: 8, marginTop: 12 }}>
        <Box flex alignItems="center" style={{ gap: 6 }}>
          <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
            🧊 Vé giữ lửa: <b>{profile?.streakFreezes ?? 0}</b>
          </Text>
          <Button
            size="small"
            variant="tertiary"
            disabled={freezePending}
            loading={freezePending}
            onClick={() => onBuyFreeze()}
            style={{ color: 'var(--leaf-700)' }}
          >
            Mua ({formatDrops(profile?.streakFreezeCost ?? 80)})
          </Button>
        </Box>
        <Button
          size="small"
          variant="secondary"
          disabled={dewCollectedToday || dewPending}
          loading={dewPending}
          onClick={() => onCollectDew()}
        >
          {dewCollectedToday ? '💦 Đã hứng sương' : '💦 Hứng giọt sương'}
        </Button>
      </Box>
      <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
        Vé giữ lửa giúp chuỗi không đứt khi bạn lỡ 1 ngày. Giọt sương sáng tặng 💧 mỗi ngày.
      </Text>
    </Box>
  );
}
