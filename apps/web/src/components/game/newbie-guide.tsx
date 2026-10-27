import { Check } from 'lucide-react';
import type { GameProfile } from '@tubutree/app-core/api/game';
import { gameNewbieCopy, tutorialState } from '@tubutree/app-core/game-newbie';
import { ui } from '@/lib/guest-ui';
import { miniBtnSecondary, miniCard, miniSectionTitle } from '@/components/loyalty/mini-surface';

const t = gameNewbieCopy.tutorial;

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
  const state = tutorialState({ lastCheckInAt: profile?.lastCheckInAt, treesPlanted: profile?.ecoImpact?.treesPlanted, dismissed });
  if (!state.visible) return null;
  return (
    <section className={`p-4 ${miniCard}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={`${ui.sectionTitle} ${miniSectionTitle}`}>{t.title}</h2>
        <span className="text-caption text-stone-700">{t.stepOf(state.current)}</span>
      </div>
      <ol className="mt-3 flex list-none flex-col gap-2.5 p-0">
        {t.steps.map((step, i) => {
          const done = state.done[i];
          const current = state.current === i + 1;
          return (
            <li key={step.title} aria-current={current ? 'step' : undefined} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-caption font-bold ${
                  done ? 'bg-forest-600 text-stone-0' : current ? 'border border-forest-600 bg-stone-50 text-stone-700' : 'bg-stone-100 text-stone-700'
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <div className="min-w-0">
                <div className={`text-sm font-semibold ${done ? 'text-stone-700' : 'text-stone-900'}`}>
                  {step.title}
                  {done && <span className="sr-only"> (đã xong)</span>}
                </div>
                {current && <div className="text-caption text-stone-700">{step.hint}</div>}
              </div>
            </li>
          );
        })}
      </ol>
      {state.current === 3 && (
        <div className="mt-3">
          {quizTotal != null && quizTotal > 0 && <p className="text-caption text-stone-700">{t.quizTotal(quizTotal)}</p>}
          <p className="text-caption text-stone-700">{t.tomorrow(tomorrowGain)}</p>
          <button type="button" onClick={onDismiss} className={`${miniBtnSecondary} mt-2.5 w-full`}>
            {t.gotIt}
          </button>
        </div>
      )}
    </section>
  );
}
