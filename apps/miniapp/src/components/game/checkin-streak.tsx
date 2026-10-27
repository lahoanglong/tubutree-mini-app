import { Check, Droplets, Flame, Snowflake } from 'lucide-react';
import { STREAK_3_SEEDS, missingDrops } from '@tubutree/app-core/game-newbie';
import type { GameProfile } from '../../services/game-api';
import { vi } from '../../i18n/vi';
import { formatDrops } from '../../utils/format';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { Heading, Text } from '../ui/text';
import { isSameVNDay } from './game-utils';

// 💧 và 🎁 trong ô ngày là phần thưởng của chuỗi (nội dung game), còn lại là icon Lucide.
export function CheckInStreak({
  profile,
  allDone,
  onCheckIn,
  checkInPending,
  onBuyFreeze,
  freezePending,
  onCollectDew,
  dewPending,
  onNeedWater,
}: {
  profile: GameProfile | undefined;
  /** Cả Điểm Xanh và giọt nước đã xong hôm nay (trạng thái gộp); quyết định nút. Dòng giọt nước vẫn theo `lastCheckInAt`. */
  allDone: boolean;
  onCheckIn: () => void;
  checkInPending: boolean;
  onBuyFreeze: () => void;
  freezePending: boolean;
  onCollectDew: () => void;
  dewPending: boolean;
  /** Thiếu nước cho vé giữ lửa: mở sheet "Kiếm nước" với số giọt còn thiếu. */
  onNeedWater: (missing: number) => void;
}) {
  const streakDays = profile?.streakDays;
  const dewCollectedToday = isSameVNDay(profile?.lastDewAt ?? null);
  const checkedInToday = isSameVNDay(profile?.lastCheckInAt ?? null);
  const t = vi.game.newbie.checkin;
  const freezeCost = profile?.streakFreezeCost ?? 80;
  const freezeShort = profile ? missingDrops(profile.totalSeeds, freezeCost) : 0;
  const dayReward = (day: number): number | null =>
    day === 7 ? (profile?.streak7Seeds ?? null) : day === 3 ? STREAK_3_SEEDS : null;
  return (
    <Card padding={16}>
      {/* flexWrap: màn hẹp (320/375) thì nút xuống hàng riêng thay vì ép tiêu đề gãy hai dòng cạnh nút. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <Heading variant="title-sm" as="h2" style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <Icon icon={Flame} tone="brand" />
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title(streakDays ?? 0)}</span>
          </Heading>
          <Text variant="caption" tone="tertiary" as="div">
            {t.sub(profile?.dailyLoginSeeds ?? null, checkedInToday ? 0 : (profile?.firstCheckinBonus ?? 0))}
          </Text>
        </div>
        {/* flexShrink 0: cạnh tiêu đề dài, nhãn nút bị rút gọn thành "Điểm d…" nếu để nút co lại. */}
        {/* Nút phụ: nút chính của tab Hôm nay là nút trên cây, nút này chỉ lặp lại việc điểm danh. */}
        <Button
          variant="secondary"
          icon={allDone ? Check : undefined}
          disabled={allDone || checkInPending}
          loading={checkInPending}
          onPress={() => onCheckIn()}
          style={{ flexShrink: 0 }}
        >
          {allDone ? 'Đã điểm danh' : 'Điểm danh'}
        </Button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        {Array.from({ length: 7 }, (_, i) => {
          const day = i + 1;
          const done = (streakDays ?? 0) % 7 === 0 && (streakDays ?? 0) > 0 ? true : day <= ((streakDays ?? 0) % 7);
          const bonus = day === 3 || day === 7;
          const reward = dayReward(day);
          return (
            <div key={i} style={{ flex: 1, textAlign: 'center' }}>
              <div
                style={{
                  height: 40,
                  borderRadius: 'var(--radius-control)',
                  background: done ? 'var(--color-action-primary-bg)' : 'var(--stone-100)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: done ? 'var(--color-action-primary-fg)' : 'var(--color-text-tertiary)',
                  fontSize: 'var(--type-body-sm-size)',
                }}
              >
                {done ? '💧' : bonus ? '🎁' : day}
              </div>
              {bonus && reward != null && (
                <Text variant="label" tone="secondary" as="div" style={{ fontWeight: 700, marginTop: 2 }}>
                  {t.dayReward(reward)}💧
                </Text>
              )}
            </div>
          );
        })}
      </div>

      <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 8 }}>
        {t.bonusNote(STREAK_3_SEEDS, profile?.streak7Seeds ?? null)}
      </Text>

      {/* Vé giữ lửa (streak-freeze) + giọt sương sáng (dew) */}
      <div style={{ marginTop: 12, paddingTop: 4, borderTop: '1px solid var(--color-border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
          <Text variant="body-sm" tone="secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon icon={Snowflake} size="sm" tone="muted" />
            Vé giữ lửa: <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>{profile?.streakFreezes ?? 0}</span>
          </Text>
          <Button
            variant="secondary"
            disabled={freezePending}
            loading={freezePending}
            onPress={() => (freezeShort > 0 ? onNeedWater(freezeShort) : onBuyFreeze())}
            style={{ flexShrink: 0 }}
          >
            {freezeShort > 0 ? vi.game.newbie.short(freezeShort) : `Mua (${formatDrops(freezeCost)})`}
          </Button>
        </div>
        <Button
          fullWidth
          variant="secondary"
          icon={Droplets}
          disabled={dewCollectedToday || dewPending}
          loading={dewPending}
          onPress={() => onCollectDew()}
          style={{ marginTop: 8 }}
        >
          {dewCollectedToday ? 'Đã hứng sương' : t.dew(profile?.dewSeeds ?? null)}
        </Button>
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 8 }}>
          Vé giữ lửa giúp chuỗi không đứt khi bạn lỡ 1 ngày. Giọt sương sáng tặng 💧 mỗi ngày.
        </Text>
      </div>
    </Card>
  );
}
