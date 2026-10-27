import { Check, Target } from 'lucide-react';
import { gameNewbieCopy, missionTarget, type MissionTarget } from '@tubutree/app-core/game-newbie';
import type { MissionItem } from '../../services/game-api';
import { vi } from '../../i18n/vi';
import { formatNumber } from '../../utils/format';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { ProgressBar } from '../ui/progress-bar';
import { SR_ONLY } from '../ui/sr-only';
import { Text } from '../ui/text';
import { GameCard } from './game-card';

export function MissionsCard({
  missions,
  streakDays,
  claimPending,
  claimVariables,
  onClaim,
  onGo,
}: {
  missions: MissionItem[] | undefined;
  streakDays: number | undefined;
  claimPending: boolean;
  claimVariables: string | undefined;
  onClaim: (code: string) => void;
  /** Bấm "Làm ngay" trên nhiệm vụ chưa xong; thiếu thì không hiện nút. */
  onGo?: (target: MissionTarget) => void;
}) {
  return (
    <GameCard title="Nhiệm vụ" icon={Target}>
      {missions && missions.length > 0 ? (
        missions.map((m: MissionItem, idx) => {
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
          const claiming = claimPending && claimVariables === m.code;
          const target = !isDone && onGo ? missionTarget(m.code, m.kind) : null;

          return (
            <div
              key={m.code}
              style={{ padding: '12px 0', borderTop: idx > 0 ? '1px solid var(--color-border-subtle)' : 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text
                  variant="body-sm"
                  tone={m.claimed ? 'tertiary' : 'primary'}
                  style={{ fontWeight: m.claimed ? 400 : 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  {m.claimed && <Icon icon={Check} size="sm" tone="brand" />}
                  {m.title}
                  {m.claimed && <span style={SR_ONLY}> (đã nhận thưởng)</span>}
                </Text>
                <Text variant="caption" tone="brand" style={{ whiteSpace: 'nowrap' }}>
                  +{formatNumber(m.rewardPoints)} Điểm Xanh
                </Text>
              </div>
              {m.description && (
                <Text variant="caption" tone="tertiary" as="div">
                  {m.description}
                </Text>
              )}
              <div style={{ marginTop: 8 }}>
                <ProgressBar
                  value={Math.round((progress / Math.max(1, goal)) * 100)}
                  max={100}
                  ariaLabel={gameNewbieCopy.missions.progressLabel(m.title, progress, goal)}
                />
              </div>
              <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>
                {progress}/{goal}
              </Text>
              {target && (
                <Button
                  fullWidth
                  variant="secondary"
                  aria-label={gameNewbieCopy.missions.doNowFor(m.title)}
                  onPress={() => onGo?.(target)}
                  style={{ marginTop: 8 }}
                >
                  {gameNewbieCopy.missions.doNow}
                </Button>
              )}
              {canClaim && (
                <Button fullWidth loading={claiming} disabled={claiming} onPress={() => onClaim(m.code)} style={{ marginTop: 8 }}>
                  {vi.game.missions.claim}
                </Button>
              )}
            </div>
          );
        })
      ) : (
        <Text variant="body-sm" tone="tertiary" as="div">
          Chưa có nhiệm vụ.
        </Text>
      )}
    </GameCard>
  );
}
