'use client';

import { useEffect, useRef, useState } from 'react';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { formatNumber } from './format';

const t = gameNewbieCopy.hero;

/**
 * Số giọt nước hiện to ở đầu trang, cùng dáng với Mini App. Khi số đổi (tưới trừ, điểm danh cộng) nó nảy lên và hiện số
 * chênh bay lên một nhịp ngắn; giảm chuyển động thì chỉ còn dòng chữ chênh (CSS .tubu-bump/.tubu-float).
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
      role="img"
      aria-label={`${formatNumber(seeds)} ${t.tankLabel}`}
      className="relative inline-flex flex-col items-center rounded-full bg-forest-50/15 px-5 pb-1 pt-1.5"
    >
      <span key={pop?.key ?? 'idle'} className={`text-[32px] font-bold leading-[1.1] text-stone-0 ${pop ? 'tubu-bump' : ''}`}>
        💧 {formatNumber(seeds)}
      </span>
      <span className="text-xs text-stone-0">{t.tankLabel}</span>
      {pop && (
        <span
          key={`d${pop.key}`}
          data-testid="water-delta"
          className={`tubu-float absolute -right-1.5 -top-1.5 rounded-full px-2 py-0.5 text-sm font-bold text-stone-0 ${pop.delta > 0 ? 'bg-forest-500' : 'bg-promo-solid'}`}
        >
          {pop.delta > 0 ? t.gain(pop.delta) : t.pour(-pop.delta)}
        </span>
      )}
    </div>
  );
}
