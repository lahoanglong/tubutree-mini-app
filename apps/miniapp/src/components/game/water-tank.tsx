import { useEffect, useRef, useState } from 'react';
import { vi } from '../../i18n/vi';
import { formatNumber } from '../../utils/format';
import { Text } from '../ui/text';

const t = vi.game.newbie.hero;

/**
 * Số giọt nước hiện to ở đầu trang. Khi số đổi (tưới trừ, điểm danh cộng) nó nảy lên và hiện số chênh bay lên một nhịp ngắn;
 * giảm chuyển động thì chỉ còn dòng chữ chênh, không có nảy/bay.
 */
export function WaterTank({ seeds }: { seeds: number | undefined }) {
  const prev = useRef(seeds);
  const [pop, setPop] = useState<{ key: number; delta: number } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = seeds;
    if (seeds == null || before == null || before === seeds) return;
    setPop({ key: Date.now(), delta: seeds - before });
    const id = setTimeout(() => setPop(null), 1300);
    return () => clearTimeout(id);
  }, [seeds]);
  return (
    <div
      data-testid="water-tank"
      role="status"
      aria-label={`${formatNumber(seeds)} ${t.tankLabel}`}
      style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', padding: '6px 20px 4px', borderRadius: 'var(--radius-pill)', background: 'color-mix(in srgb, var(--forest-50) 14%, transparent)' }}
    >
      <span key={pop?.key ?? 'idle'} className={pop ? 'tubu-bump' : undefined} style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1, color: 'var(--color-text-inverse)' }}>
        💧 {formatNumber(seeds)}
      </span>
      <Text variant="caption" tone="inverse">
        {t.tankLabel}
      </Text>
      {pop && (
        <span
          key={`d${pop.key}`}
          data-testid="water-delta"
          className="tubu-float"
          style={{ position: 'absolute', right: -6, top: -6, fontWeight: 700, fontSize: 'var(--type-body-sm-size)', color: 'var(--color-text-inverse)', background: pop.delta > 0 ? 'var(--forest-500)' : 'var(--clay-500)', borderRadius: 'var(--radius-pill)', padding: '2px 8px' }}
        >
          {pop.delta > 0 ? t.gain(pop.delta) : t.pour(-pop.delta)}
        </span>
      )}
    </div>
  );
}
