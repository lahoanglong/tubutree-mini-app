import { Box, Text, Button } from 'zmp-ui';
import type { MissionItem } from '../../services/game-api';
import { vi } from '../../i18n/vi';
import { formatNumber } from '../../utils/format';
import { GameCard } from './game-card';

export function MissionsCard({
  missions,
  streakDays,
  claimPending,
  claimVariables,
  onClaim,
}: {
  missions: MissionItem[] | undefined;
  streakDays: number | undefined;
  claimPending: boolean;
  claimVariables: string | undefined;
  onClaim: (code: string) => void;
}) {
  return (
    <GameCard title="🎯 Nhiệm vụ">
      {missions && missions.length > 0 ? (
        missions.map((m: MissionItem) => {
          const defaultGoal = { CHECKIN_7: 7, REVIEW_3: 3, INVITE_3: 3, FIRST_ORDER: 1 }[m.code] ?? 1;
          // BE Mission.goal mặc định = 1 (schema @default(1)) — "> 1" từng loại bỏ nhầm mọi
          // mission cấu hình goal=1 hợp lệ và âm thầm thay bằng default cứng của FE.
          const goal = m.goal && m.goal > 0 ? m.goal : defaultGoal;
          const rawProgress = m.code === 'CHECKIN_7'
            ? Math.min(goal, streakDays ?? m.progress ?? 0)
            : (m.progress ?? 0);
          const progress = Math.min(goal, rawProgress);
          const isDone = m.completed || progress >= goal;
          // A1-02: trước đây "đạt điều kiện" (isDone) và "đã nhận thưởng" bị coi là một — thẻ
          // hiện ✓ và +Nđ ngay khi đạt điều kiện nhưng KHÔNG có đường cộng thưởng nào. Giờ tách
          // rõ: ✓ chỉ khi đã claimed (thưởng THẬT đã vào Điểm Xanh); đạt điều kiện nhưng chưa
          // nhận thì hiện nút "Nhận thưởng" (mirror pattern claim của Season Pass).
          const canClaim = isDone && !m.claimed;

          return (
            <Box key={m.code} style={{ padding: '8px 0', borderBottom: '1px solid var(--neutral-100)' }}>
              <Box flex alignItems="center" justifyContent="space-between">
                <Text size="small" bold={!m.claimed} style={{ color: m.claimed ? 'var(--neutral-400)' : 'var(--neutral-900)' }}>
                  {m.claimed ? '✓ ' : ''}{m.title}
                </Text>
                <Text size="xSmall" style={{ color: 'var(--leaf-700)' }}>
                  +{formatNumber(m.rewardPoints)} Điểm Xanh
                </Text>
              </Box>
              {m.description && (
                <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                  {m.description}
                </Text>
              )}
              <Box style={{ height: 6, background: 'var(--neutral-100)', borderRadius: 99, marginTop: 4, overflow: 'hidden' }}>
                <Box
                  style={{
                    width: `${Math.min(100, Math.round((progress / Math.max(1, goal)) * 100))}%`,
                    height: '100%',
                    background: isDone ? 'var(--leaf-600)' : 'var(--primary-600)',
                  }}
                />
              </Box>
              <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 2 }}>
                {progress}/{goal}
              </Text>
              {canClaim && (
                <Button
                  fullWidth
                  size="small"
                  loading={claimPending && claimVariables === m.code}
                  disabled={claimPending && claimVariables === m.code}
                  onClick={() => onClaim(m.code)}
                  style={{ marginTop: 6, background: 'var(--leaf-600)' }}
                >
                  {vi.game.missions.claim}
                </Button>
              )}
            </Box>
          );
        })
      ) : (
        <Text size="small" style={{ color: 'var(--neutral-400)' }}>
          Chưa có nhiệm vụ.
        </Text>
      )}
    </GameCard>
  );
}
