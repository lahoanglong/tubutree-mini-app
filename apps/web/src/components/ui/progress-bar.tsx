export interface ProgressBarProps {
  value: number;
  max: number;
  tone?: 'brand' | 'flash';
  label?: string;
  /** Tên truy cập khi không muốn in `label` ra màn hình (nhãn đã có ở chỗ khác). */
  ariaLabel?: string;
}

/** Thanh tiến độ, cùng API với `ProgressBar` của Mini App. `max` ≤ 0 coi như 0%. */
export function ProgressBar({ value, max, tone = 'brand', label, ariaLabel }: ProgressBarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div>
      {label && <div className="mb-1 text-xs text-stone-600">{label}</div>}
      <div
        role="progressbar"
        aria-label={label ?? ariaLabel}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.max(0, Math.min(max, value))}
        className="h-1.5 overflow-hidden rounded-full bg-stone-200"
      >
        <div
          data-testid="progress-fill"
          className={`h-full rounded-full transition-[width] ${tone === 'flash' ? 'bg-promo-solid' : 'bg-forest-600'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export const Meter = ProgressBar;
