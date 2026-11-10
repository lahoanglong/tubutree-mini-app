import { CircleHelp, Droplets, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ui } from '@/lib/guest-ui';
import { usePressLock } from '@/lib/use-press-lock';
import { miniBtnSecondary } from '@/components/loyalty/mini-surface';

export type EarnQuizState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; left: number };

const t = gameNewbieCopy.earn;

function Row({ title, hint, gain, children }: { title: string; hint?: string; gain?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-control bg-stone-50 p-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-stone-900">{title}</div>
        {(gain || hint) && <div className="text-caption text-stone-700">{[gain, hint].filter(Boolean).join(' · ')}</div>}
      </div>
      <div className="flex-none">{children}</div>
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
  hasFriends,
  onGoFriends,
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
  onRetryQuiz: () => void | PromiseLike<unknown>;
  onGoQuiz: () => void;
  hasFriends: boolean;
  onGoFriends: () => void;
  /** Lỗi của lần điểm danh/hứng sương vừa rồi. */
  error: string | null;
}) {
  const retryQuiz = usePressLock(onRetryQuiz);
  const quizLeft = quiz.status === 'ready' ? quiz.left : 0;
  const allDone = checkedInToday && dewToday && quiz.status === 'ready' && quizLeft === 0;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t.title}
      description={missing != null && missing > 0 ? `${t.have(totalSeeds)} · ${t.need(missing)}` : t.have(totalSeeds)}
      footer={
        <button type="button" onClick={onClose} className={`${miniBtnSecondary} w-full`}>
          {t.close}
        </button>
      }
    >
      <div className="flex flex-col gap-2 tabular-nums">
        {error && (
          <p role="alert" className="text-caption text-danger-fg">
            {error}
          </p>
        )}
        {!checkedInToday && (
          <Row title={t.checkin} gain={checkInGain != null ? t.gain(checkInGain) : undefined}>
            <button
              type="button"
              aria-busy={checkInPending || undefined}
              aria-disabled={checkInPending || undefined}
              onClick={() => {
                if (checkInPending) return;
                onCheckIn();
              }}
              className={`${ui.btnPrimary} gap-1.5`}
            >
              <Droplets className="h-4 w-4" aria-hidden="true" />
              {t.checkinCta}
            </button>
          </Row>
        )}
        {!dewToday && (
          <Row title={t.dew} gain={dewGain != null ? t.gain(dewGain) : undefined}>
            <button
              type="button"
              aria-busy={dewPending || undefined}
              aria-disabled={dewPending || undefined}
              onClick={() => {
                if (dewPending) return;
                onDew();
              }}
              className={`${miniBtnSecondary} gap-1.5`}
            >
              <Droplets className="h-4 w-4" aria-hidden="true" />
              {t.dewCta}
            </button>
          </Row>
        )}
        {quiz.status === 'loading' && (
          <div role="status" aria-busy="true" aria-label={t.loading}>
            <Skeleton height={64} />
          </div>
        )}
        {quiz.status === 'error' && (
          <Row title={t.error}>
            <button
              type="button"
              aria-busy={retryQuiz.busy || undefined}
              aria-disabled={retryQuiz.busy || undefined}
              onClick={retryQuiz.press}
              className={miniBtnSecondary}
            >
              {t.retry}
            </button>
          </Row>
        )}
        {quiz.status === 'ready' && quizLeft > 0 && (
          <Row title={t.quiz(quizLeft)} hint={t.quizHint}>
            <button type="button" onClick={onGoQuiz} className={`${miniBtnSecondary} gap-1.5`}>
              <CircleHelp className="h-4 w-4" aria-hidden="true" />
              {t.quizCta}
            </button>
          </Row>
        )}
        {hasFriends && (
          <Row title={t.friends} hint={t.friendsHint}>
            <button type="button" onClick={onGoFriends} className={`${miniBtnSecondary} gap-1.5`}>
              <Users className="h-4 w-4" aria-hidden="true" />
              {t.friendsCta}
            </button>
          </Row>
        )}
        {allDone && <p className="text-sm text-stone-700">{t.allDone}</p>}
        <p className="text-caption text-stone-700">{t.tomorrow}</p>
      </div>
    </Sheet>
  );
}
