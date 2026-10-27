interface ProgressBarBase {
  value: number;
  max: number;
  tone?: 'brand' | 'flash';
}

/** Thanh tiến độ luôn phải có tên đọc được: `label` (in ra màn hình, cũng là tên truy cập) hoặc `ariaLabel` khi nhãn đã nằm ở chỗ khác. */
export type ProgressBarProps = ProgressBarBase & ({ label: string; ariaLabel?: string } | { label?: undefined; ariaLabel: string });

/** Thay 12 thanh tự vẽ (audit A4-19). */
export function ProgressBar({ value, max, tone = 'brand', label, ariaLabel }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      {label && <div style={{ fontSize: 'var(--type-caption-size)', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>{label}</div>}
      <div
        role="progressbar"
        aria-label={label ?? ariaLabel}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.max(0, Math.min(max, value))}
        style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--stone-200)', overflow: 'hidden' }}
      >
        <div
          data-testid="progress-fill"
          style={{ height: '100%', width: `${pct}%`, borderRadius: 'var(--radius-pill)', background: tone === 'flash' ? 'var(--color-flash-solid-bg)' : 'var(--color-action-primary-bg)', transition: 'width var(--motion-emphasize)' }}
        />
      </div>
    </div>
  );
}

export const Meter = ProgressBar;
