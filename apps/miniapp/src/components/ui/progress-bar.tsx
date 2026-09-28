export interface ProgressBarProps {
  value: number;
  max: number;
  tone?: 'brand' | 'flash';
  label?: string;
}

/** Thay 12 thanh tự vẽ (audit A4-19). */
export function ProgressBar({ value, max, tone = 'brand', label }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      {label && <div style={{ fontSize: 'var(--type-caption-size)', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>{label}</div>}
      <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--stone-200)', overflow: 'hidden' }}>
        <div
          data-testid="progress-fill"
          style={{ height: '100%', width: `${pct}%`, borderRadius: 'var(--radius-pill)', background: tone === 'flash' ? 'var(--color-flash-solid-bg)' : 'var(--color-action-primary-bg)', transition: 'width var(--motion-emphasize)' }}
        />
      </div>
    </div>
  );
}

export const Meter = ProgressBar;
