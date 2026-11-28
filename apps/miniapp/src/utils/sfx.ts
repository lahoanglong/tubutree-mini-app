import { useSyncExternalStore } from 'react';
import { createSfx, unlockSfxOnGesture, type SfxAudio } from '@tubutree/app-core/game-hub/sfx';
import { browserStorage } from './recently-viewed';

type AudioCtor = new () => SfxAudio;

/** WebView cũ của iOS chỉ có `webkitAudioContext`; không có cả hai thì im lặng. */
function makeAudio(): SfxAudio | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Một bộ phát cho cả app: AudioContext tạo một lần, lựa chọn tắt tiếng chung cho mọi màn Vườn Xanh. */
export const sfx = createSfx({ audio: makeAudio, storage: browserStorage, reducedMotion });

if (typeof window !== 'undefined') unlockSfxOnGesture(window, sfx);

/** Trạng thái tắt tiếng, vẽ lại khi khách bấm nút âm thanh ở bất kỳ đâu. */
export function useSfxMuted(): boolean {
  return useSyncExternalStore(sfx.subscribe, sfx.isMuted, sfx.isMuted);
}
