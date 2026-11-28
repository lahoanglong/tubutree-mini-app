'use client';

import { Volume2, VolumeX } from 'lucide-react';
import { arcadeCopy } from '@tubutree/app-core/game-mini/arcade-copy';
import type { ArcadeShape } from '@tubutree/app-core/game-mini/arcade-art';
import { Icon } from '@/components/mini';

/** Vẽ một hình vector của game thao tác (dữ liệu ở `arcade-art.ts`); màu theo lớp tông của `mini-arcade.css`. */
export function ArcadeArt({ shapes, className }: { shapes: readonly ArcadeShape[]; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className ?? 'tubu-ar-art'} aria-hidden focusable="false">
      {shapes.map((s, i) =>
        'cx' in s ? (
          <circle key={i} cx={s.cx} cy={s.cy} r={s.r} className={`tubu-ar-f-${s.fill}`} />
        ) : 'stroke' in s ? (
          <path key={i} d={s.d} className={`tubu-ar-s-${s.stroke}`} strokeWidth={s.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path key={i} d={s.d} className={`tubu-ar-f-${s.fill}`} />
        ),
      )}
    </svg>
  );
}

/** Nút bật/tắt âm thanh (một chạm, nhớ trên máy). */
export function SoundToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="tubu-ar-sound"
      aria-label={arcadeCopy(on ? 'sound.off' : 'sound.on')}
      data-testid="arcade-sound"
      onClick={onToggle}
    >
      <Icon icon={on ? Volume2 : VolumeX} size="sm" tone={on ? 'brand' : 'muted'} />
    </button>
  );
}
