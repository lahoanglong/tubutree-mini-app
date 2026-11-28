'use client';

import { Volume2, VolumeX } from 'lucide-react';
import { hubCopy } from '@tubutree/app-core/game-hub/copy';
import { sfx, useSfxMuted } from '@/lib/sfx';
import { Icon } from '@/components/mini';

/** Một chạm bật/tắt âm thanh của Vườn Xanh (bản web của Mini `SoundToggle`). Nút bật tắt (`aria-pressed`), tên không đổi theo trạng thái. */
export function SoundToggle() {
  const muted = useSfxMuted();
  return (
    <button
      type="button"
      className="tubu-press tubu-sound-toggle"
      aria-label={hubCopy('sound.label')}
      aria-pressed={!muted}
      data-testid="sound-toggle"
      onClick={() => {
        sfx.setMuted(!muted);
        if (muted) sfx.play('pop');
      }}
    >
      <Icon icon={muted ? VolumeX : Volume2} tone={muted ? 'muted' : 'brand'} />
    </button>
  );
}
