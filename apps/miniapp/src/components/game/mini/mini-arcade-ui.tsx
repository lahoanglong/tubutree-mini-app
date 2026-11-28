import { Volume2, VolumeX } from 'lucide-react';
import type { MiniArcadeGameId } from '@tubutree/shared-types';
import { arcadeCopy } from '@tubutree/app-core/game-mini/arcade-copy';
import { CONVEYOR_ART, MERGE_TIER_ART, type ArcadeShape } from '@tubutree/app-core/game-mini/arcade-art';
import { Icon } from '../../ui/icon';
import './mini-arcade.css';

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

/**
 * Hình thẻ của game thao tác ở lưới "Chơi hôm nay". Thẻ nạp lười module này: nhập tĩnh thì chunk Vườn Xanh kéo theo chunk hình của bàn chơi
 * và bản đồ preload của entry thêm hai tên tệp.
 */
export function ArcadeCardArt({ game }: { game: MiniArcadeGameId }) {
  return <ArcadeArt shapes={game === 'eco_merge' ? MERGE_TIER_ART[3]! : CONVEYOR_ART.refill_pump} className="tubu-mg-gcard-svg" />;
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
