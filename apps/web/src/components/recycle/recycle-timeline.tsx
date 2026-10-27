import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

type StepState = 'done' | 'current' | 'upcoming';

const STATE_TEXT: Record<StepState, string> = {
  done: ', đã xong',
  current: ', đang diễn ra',
  upcoming: ', chưa tới',
};

/**
 * Tiến độ yêu cầu, cùng ý với `Timeline` của Mini App. `current` chạy 0..steps.length; bằng steps.length nghĩa là mọi bước
 * đã xong. Bản gọn chỉ vẽ chấm (tên bước dành cho trình đọc màn hình), bản đầy đủ xếp dọc kèm tên bước.
 */
export function RecycleTimeline({
  steps,
  current,
  label = 'Tiến độ yêu cầu',
  compact = false,
  hints,
  caption: captionText,
}: {
  steps: readonly string[];
  current: number;
  label?: string;
  compact?: boolean;
  /** Dòng phụ dưới tên bước, theo chỉ số bước; chỉ hiện ở bản đầy đủ. */
  hints?: Readonly<Record<number, ReactNode>>;
  /** Chữ thay cho tên bước hiện tại ở bản gọn, ví dụ "Bước 2/4: Mang tới điểm". */
  caption?: string;
}) {
  const size = compact ? 'h-4 w-4' : 'h-6 w-6';
  const list = (
    <ol aria-label={label} className={`flex ${compact ? 'flex-row gap-2' : 'flex-col gap-3'}`}>
      {steps.map((s, i) => {
        const state: StepState = i < current ? 'done' : i === current ? 'current' : 'upcoming';
        const active = state !== 'upcoming';
        return (
          <li
            key={s}
            data-step={s}
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
            className={`flex min-w-0 ${!compact && hints?.[i] ? 'items-start' : 'items-center'} gap-2.5 ${compact ? 'flex-1' : ''}`}
          >
            <span
              aria-hidden="true"
              className={`grid flex-none place-items-center rounded-full border-2 ${size} ${active ? 'border-forest-600' : 'border-stone-300'} ${
                state === 'done' ? 'bg-forest-600 text-stone-0' : ''
              }`}
            >
              {state === 'done' && <Check className="h-3 w-3" strokeWidth={3} />}
              {state === 'current' && <span className={`rounded-full bg-forest-600 ${compact ? 'h-2 w-2' : 'h-3 w-3'}`} />}
            </span>
            {compact ? (
              <span className="sr-only">{`${s}${STATE_TEXT[state]}`}</span>
            ) : (
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className={`text-sm text-stone-900 ${state === 'current' ? 'font-semibold' : ''}`}>
                  {s}
                  <span className="sr-only">{STATE_TEXT[state]}</span>
                </span>
                {hints?.[i]}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
  if (!compact) return list;
  const caption = captionText ?? steps[Math.min(current, steps.length - 1)];
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {list}
      {caption && (
        <div aria-hidden="true" className="truncate text-xs text-stone-600">
          {caption}
        </div>
      )}
    </div>
  );
}
