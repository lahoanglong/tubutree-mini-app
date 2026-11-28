'use client';

import { useSyncExternalStore } from 'react';
import { createSfx, unlockSfxOnGesture, type SfxAudio, type SfxStorage } from '@tubutree/app-core/game-hub/sfx';

type AudioCtor = new () => SfxAudio;

/** Safari cũ chỉ có `webkitAudioContext`; không có cả hai thì im lặng. */
function makeAudio(): SfxAudio | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

/** Chế độ riêng tư chặn localStorage thì vẫn chơi được, chỉ không nhớ lựa chọn tắt tiếng. */
function storage(): SfxStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Một bộ phát cho cả trang (bản web của apps/miniapp/src/utils/sfx.ts): AudioContext tạo ở cú chạm đầu tiên. */
export const sfx = createSfx({ audio: makeAudio, storage, reducedMotion });

if (typeof window !== 'undefined') unlockSfxOnGesture(window, sfx);

const serverMuted = () => false;

/** Trạng thái tắt tiếng; máy chủ dựng HTML coi như đang bật, máy khách đọc lại lựa chọn đã lưu sau khi hydrate. */
export function useSfxMuted(): boolean {
  return useSyncExternalStore(sfx.subscribe, sfx.isMuted, serverMuted);
}
