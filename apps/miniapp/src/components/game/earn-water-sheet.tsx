import { Droplets, HelpCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { vi } from '../../i18n/vi';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { Text } from '../ui/text';

export type EarnQuizState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; left: number };

const t = vi.game.newbie.earn;

function Row({ title, hint, gain, children }: { title: string; hint?: string; gain?: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: 12,
        background: 'var(--color-bg-subtle)',
        borderRadius: 'var(--radius-control)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
          {title}
        </Text>
        {(gain || hint) && (
          <Text variant="caption" tone="secondary" as="div">
            {[gain, hint].filter(Boolean).join(' · ')}
          </Text>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

/**
 * Sheet "Kiếm nước": đích chung của mọi nút thiếu nước. Liệt kê việc còn làm được hôm nay kèm nút bấm ngay,
 * để khách không bao giờ gặp lỗi "không đủ giọt nước" mà không biết đi đâu tiếp.
 */
export function EarnWaterSheet({
  open,
  onClose,
  totalSeeds,
  missing,
  checkedInToday,
  dewToday,
  checkInGain,
  dewGain,
  checkInPending,
  dewPending,
  onCheckIn,
  onDew,
  quiz,
  onRetryQuiz,
  onGoQuiz,
  error,
}: {
  open: boolean;
  onClose: () => void;
  totalSeeds: number;
  /** Số giọt còn thiếu cho nút đã mở sheet; null khi mở từ nút chính. */
  missing: number | null;
  checkedInToday: boolean;
  dewToday: boolean;
  checkInGain: number | null;
  dewGain: number | null;
  checkInPending: boolean;
  dewPending: boolean;
  onCheckIn: () => void;
  onDew: () => void;
  quiz: EarnQuizState;
  onRetryQuiz: () => void;
  onGoQuiz: () => void;
  /** Lỗi của lần điểm danh/hứng sương vừa rồi. */
  error: string | null;
}) {
  const quizLeft = quiz.status === 'ready' ? quiz.left : 0;
  const allDone = checkedInToday && dewToday && quiz.status === 'ready' && quizLeft === 0;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t.title}
      description={missing != null && missing > 0 ? `${t.have(totalSeeds)} · ${t.need(missing)}` : t.have(totalSeeds)}
      footer={
        <Button fullWidth variant="secondary" onPress={onClose}>
          {t.close}
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {error && (
          <div role="alert">
            <Text variant="caption" tone="danger" as="div">
              {error}
            </Text>
          </div>
        )}
        {!checkedInToday && (
          <Row title={t.checkin} gain={checkInGain != null ? t.gain(checkInGain) : undefined}>
            <Button icon={Droplets} loading={checkInPending} disabled={checkInPending} onPress={onCheckIn}>
              {t.checkinCta}
            </Button>
          </Row>
        )}
        {!dewToday && (
          <Row title={t.dew} gain={dewGain != null ? t.gain(dewGain) : undefined}>
            <Button variant="secondary" icon={Droplets} loading={dewPending} disabled={dewPending} onPress={onDew}>
              {t.dewCta}
            </Button>
          </Row>
        )}
        {quiz.status === 'loading' && (
          <div role="status" aria-busy="true" aria-label={t.loading}>
            <Skeleton height={64} radius="var(--radius-control)" />
          </div>
        )}
        {quiz.status === 'error' && (
          <Row title={t.error}>
            <Button variant="secondary" onPress={onRetryQuiz}>
              {t.retry}
            </Button>
          </Row>
        )}
        {quiz.status === 'ready' && quizLeft > 0 && (
          <Row title={t.quiz(quizLeft)} hint={t.quizHint}>
            <Button variant="secondary" icon={HelpCircle} onPress={onGoQuiz}>
              {t.quizCta}
            </Button>
          </Row>
        )}
        {allDone && (
          <Text variant="body-sm" tone="secondary" as="div">
            {t.allDone}
          </Text>
        )}
        <Text variant="caption" tone="secondary" as="div">
          {t.tomorrow}
        </Text>
      </div>
    </BottomSheet>
  );
}
