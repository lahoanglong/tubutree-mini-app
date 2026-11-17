import { useState } from 'react';
import { Check, Target } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'zmp-ui';
import type { DailyMissionId, DailyMissionsResponse } from '@tubutree/shared-types';
import { gameNewbieCopy, missionTarget, type MissionTarget } from '@tubutree/app-core/game-newbie';
import { collapseMissions, gameMoreCopy } from '@tubutree/app-core/game-more-copy';
import { DAILY_MISSIONS_KEY, claimDailyMission, classifyDailyClaimError, dailyClaimErrorCopy, dailyMissionsQuery } from '@tubutree/app-core/engagement/api';
import { dailyBonusLine, dailyClaimToast, dailyProgress, dailyRows } from '@tubutree/app-core/engagement/view';
import { miniDeviceId } from '@tubutree/app-core/game-mini/api';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { MissionItem } from '../../services/game-api';
import { coreHttp } from '../../services/core-http';
import { useAuthStore } from '../../store/auth';
import { vi } from '../../i18n/vi';
import { formatNumber } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import { browserStorage } from '../../utils/recently-viewed';
import { settleWithin } from '../../utils/settle-within';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { ProgressBar } from '../ui/progress-bar';
import { SR_ONLY } from '../ui/sr-only';
import { Text } from '../ui/text';
import { GuestPointsNote } from '../loyalty/guest-points-note';
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
  const [showAll, setShowAll] = useState(false);
  const [showOneTime, setShowOneTime] = useState(false);
  const { items, collapsible } = collapseMissions(missions ?? [], showAll);
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const dailyQ = useQuery({ ...dailyMissionsQuery(coreHttp), enabled: authed });
  const daily = dailyQ.data?.enabled ? dailyQ.data : undefined;
  // Khách vãng lai: tiến độ vẫn tính nhưng không hứa điểm và không có nút nhận thưởng; một câu mời đăng nhập cho cả thẻ.
  const guest = (missions ?? []).some((m) => m.pointsBlocked) || daily?.pointsBlocked === true;
  // Nhiệm vụ hằng ngày bật: phần Hôm nay đứng đầu, nhiệm vụ một lần thu lại sau một nút để thẻ không dài thêm; có thưởng đang chờ nhận thì
  // để mở sẵn, không giấu nút Nhận thưởng sau nút gập.
  const oneTimeClaimable = (missions ?? []).some((m) => m.completed && !m.claimed && !m.pointsBlocked);
  const oneTimeOpen = !daily || showOneTime || oneTimeClaimable;
  return (
    <GameCard title="Nhiệm vụ" icon={Target}>
      {guest && <GuestPointsNote margin="0 0 4px" />}
      {daily && <DailySection data={daily} onGo={onGo} />}
      {daily && missions && missions.length > 0 && !oneTimeClaimable && (
        <Button fullWidth variant="ghost" aria-expanded={showOneTime} onPress={() => setShowOneTime((v) => !v)} style={{ marginTop: 'var(--space-stack-xs)' }}>
          {showOneTime ? fillCopy('daily.oneTimeHide') : fillCopy('daily.oneTimeShow', { n: missions.length })}
        </Button>
      )}
      {!oneTimeOpen ? null : missions && missions.length > 0 ? (
        items.map((m: MissionItem, idx) => {
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
          const canClaim = isDone && !m.claimed && !m.pointsBlocked;
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
                  numeric
                  style={{ fontWeight: m.claimed ? 400 : 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  {m.claimed && <Icon icon={Check} size="sm" tone="brand" />}
                  {m.title}
                  {m.claimed && <span style={SR_ONLY}> (đã nhận thưởng)</span>}
                </Text>
                {!m.pointsBlocked && (
                  <Text variant="caption" tone="brand" numeric style={{ whiteSpace: 'nowrap' }}>
                    +{formatNumber(m.rewardPoints)} Điểm Xanh
                  </Text>
                )}
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
      ) : daily ? null : (
        <Text variant="body-sm" tone="tertiary" as="div">
          Chưa có nhiệm vụ.
        </Text>
      )}
      {oneTimeOpen && (collapsible || showAll) && missions && missions.length > 0 && (
        <Button fullWidth variant="ghost" onPress={() => setShowAll((v) => !v)} style={{ marginTop: 4 }}>
          {showAll ? gameMoreCopy.missionsShowLess : gameMoreCopy.missionsShowAll(missions.length)}
        </Button>
      )}
    </GameCard>
  );
}

/**
 * Phần "Hôm nay" của thẻ Nhiệm vụ (cờ engagement.daily_missions_enabled): 3 dòng gọn, mỗi dòng một nút (Làm hoặc Nhận), dòng thưởng ngày
 * bên dưới. Nhận thưởng gửi mã thiết bị game; thưởng thật sau trần chung của game mini báo bằng snackbar.
 */
function DailySection({ data, onGo }: { data: DailyMissionsResponse; onGo?: (target: MissionTarget) => void }) {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const rows = dailyRows(data);
  const bonus = dailyBonusLine(data);
  const claim = useMutation({
    mutationFn: (id: DailyMissionId) =>
      claimDailyMission(coreHttp, id, miniDeviceId(browserStorage(), (n) => crypto.getRandomValues(new Uint8Array(n)))),
    onSuccess: (res) => {
      haptic('medium');
      openSnackbar({ text: dailyClaimToast(res), type: res.water > 0 || res.points > 0 ? 'success' : 'warning' });
      void qc.invalidateQueries({ queryKey: ['loyalty'] });
      void qc.invalidateQueries({ queryKey: ['points-txn'] });
      // Khoá nút giữ tới khi phần Hôm nay tải lại (dòng thành "đã nhận"), có trần chờ: bấm lại lúc dòng còn cũ chỉ ra 409.
      return settleWithin(qc.invalidateQueries({ queryKey: ['game'] }));
    },
    onError: (err) => {
      const kind = classifyDailyClaimError(err);
      openSnackbar({ text: fillCopy(dailyClaimErrorCopy(kind)), type: kind === 'stale' ? 'warning' : 'error' });
      return settleWithin(qc.invalidateQueries({ queryKey: DAILY_MISSIONS_KEY }));
    },
  });
  return (
    <section aria-label={fillCopy('daily.today')} data-testid="daily-missions" style={{ marginBottom: 'var(--space-stack-xs)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="label" tone="tertiary" as="h3">
          {fillCopy('daily.today')}
        </Text>
        <Text variant="caption" tone="secondary" numeric>
          {dailyProgress(data)}
        </Text>
      </div>
      {rows.map((r) => (
        <div key={r.id} data-testid={`daily-row-${r.id}`} className="tubu-daily-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text
              variant="body-sm"
              tone={r.state === 'claimed' ? 'tertiary' : 'primary'}
              as="div"
              style={{ fontWeight: r.state === 'claimed' ? 400 : 600, display: 'flex', alignItems: 'center', gap: 'var(--space-stack-xs)' }}
            >
              {(r.state === 'claimed' || r.state === 'done') && <Icon icon={Check} size="sm" tone="brand" />}
              {r.title}
            </Text>
            {r.reward && (
              <Text variant="caption" tone="brand" numeric as="div">
                {r.reward}
              </Text>
            )}
          </div>
          {r.state === 'claimable' && (
            <Button
              aria-label={r.aria}
              loading={claim.isPending && claim.variables === r.id}
              disabled={claim.isPending}
              onPress={() => claim.mutate(r.id)}
            >
              {fillCopy('daily.claim')}
            </Button>
          )}
          {r.state === 'todo' && onGo && (
            <Button variant="secondary" aria-label={r.aria} onPress={() => onGo(r.target)}>
              {fillCopy('daily.go')}
            </Button>
          )}
          {(r.state === 'claimed' || r.state === 'done') && <span style={SR_ONLY}>{r.aria}</span>}
        </div>
      ))}
      {bonus && (
        <Text variant="caption" tone={data.bonusClaimed ? 'tertiary' : 'brand'} as="p" style={{ marginTop: 'var(--space-stack-xs)' }}>
          {bonus}
        </Text>
      )}
    </section>
  );
}
