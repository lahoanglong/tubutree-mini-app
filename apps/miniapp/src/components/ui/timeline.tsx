import { Check } from 'lucide-react';
import { Icon } from './icon';
import { SR_ONLY } from './sr-only';
import { Text } from './text';

export interface TimelineProps {
  steps: readonly string[];
  /** 0..steps.length; bằng steps.length nghĩa là mọi bước đã xong. */
  current: number;
  label?: string;
  compact?: boolean;
}

type StepState = 'done' | 'current' | 'upcoming';

const STATE_TEXT: Record<StepState, string> = {
  done: ', đã xong',
  current: ', đang diễn ra',
  upcoming: ', chưa tới',
};

export function Timeline({ steps, current, label = 'Tiến độ yêu cầu', compact = false }: TimelineProps) {
  const size = compact ? 16 : 24;
  return (
    <ol
      aria-label={label}
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: compact ? 'row' : 'column', gap: compact ? 8 : 12 }}
    >
      {steps.map((s, i) => {
        const state: StepState = i < current ? 'done' : i === current ? 'current' : 'upcoming';
        const active = state !== 'upcoming';
        return (
          <li
            key={s}
            data-step={s}
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 10, flex: compact ? 1 : undefined, minWidth: 0 }}
          >
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                width: size,
                height: size,
                boxSizing: 'border-box',
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                border: `2px solid ${active ? 'var(--color-action-primary-bg)' : 'var(--color-border-default)'}`,
                background: state === 'done' ? 'var(--color-action-primary-bg)' : 'transparent',
              }}
            >
              {state === 'done' && <Icon icon={Check} size="sm" tone="inverse" />}
              {state === 'current' && (
                <span style={{ width: size / 2, height: size / 2, borderRadius: '50%', background: 'var(--color-action-primary-bg)' }} />
              )}
            </span>
            {compact ? (
              <span style={SR_ONLY}>{`${s}${STATE_TEXT[state]}`}</span>
            ) : (
              <Text variant="body-sm" as="span" style={{ fontWeight: state === 'current' ? 600 : 400 }}>
                {s}
                <span style={SR_ONLY}>{STATE_TEXT[state]}</span>
              </Text>
            )}
          </li>
        );
      })}
    </ol>
  );
}
