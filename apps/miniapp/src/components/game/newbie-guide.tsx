import { Check } from 'lucide-react';
import type { GameProfile } from '../../services/game-api';
import { tutorialState } from '@tubutree/app-core/game-newbie';
import { vi } from '../../i18n/vi';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { SR_ONLY } from '../ui/sr-only';
import { Heading, Text } from '../ui/text';

const t = vi.game.newbie.tutorial;

/** Thẻ 3 bước của phiên đầu, nằm trên nút tưới; tự ẩn khi khách bấm "Đã hiểu" ở bước 3. */
export function NewbieGuide({
  profile,
  dismissed,
  quizTotal,
  tomorrowGain,
  onDismiss,
}: {
  profile: GameProfile | undefined;
  dismissed: boolean;
  /** Tổng 💧 của các câu đố hôm nay nếu đúng hết; null khi chưa có. */
  quizTotal: number | null;
  /** 💧 của điểm danh + sương mỗi ngày; null khi API chưa trả. */
  tomorrowGain: number | null;
  onDismiss: () => void;
}) {
  const state = tutorialState({
    lastCheckInAt: profile?.lastCheckInAt,
    treesPlanted: profile?.ecoImpact?.treesPlanted,
    dismissed,
  });
  if (!state.visible) return null;
  return (
    <Card padding={16}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <Heading variant="title-sm" as="h2">
          {t.title}
        </Heading>
        <Text variant="caption" tone="secondary">
          {t.stepOf(state.current)}
        </Text>
      </div>
      <ol style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {t.steps.map((step, i) => {
          const done = state.done[i];
          const current = state.current === i + 1;
          return (
            <li key={step.title} aria-current={current ? 'step' : undefined} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  background: done ? 'var(--color-action-primary-bg)' : current ? 'var(--color-bg-subtle)' : 'var(--stone-100)',
                  color: done ? 'var(--color-action-primary-fg)' : 'var(--color-text-secondary)',
                  border: current && !done ? '1px solid var(--color-border-selected)' : 'none',
                }}
              >
                {done ? <Icon icon={Check} size="sm" tone="current" /> : i + 1}
              </span>
              <div style={{ minWidth: 0 }}>
                <Text variant="body-sm" as="div" tone={done ? 'secondary' : 'primary'} style={{ fontWeight: 600 }}>
                  {step.title}
                  {done && <span style={SR_ONLY}> (đã xong)</span>}
                </Text>
                {current && (
                  <Text variant="caption" tone="secondary" as="div">
                    {step.hint}
                  </Text>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {state.current === 3 && (
        <div style={{ marginTop: 12 }}>
          {quizTotal != null && quizTotal > 0 && (
            <Text variant="caption" tone="secondary" as="div">
              {t.quizTotal(quizTotal)}
            </Text>
          )}
          <Text variant="caption" tone="secondary" as="div">
            {t.tomorrow(tomorrowGain)}
          </Text>
          <Button fullWidth variant="secondary" onPress={onDismiss} style={{ marginTop: 10 }}>
            {t.gotIt}
          </Button>
        </div>
      )}
    </Card>
  );
}
