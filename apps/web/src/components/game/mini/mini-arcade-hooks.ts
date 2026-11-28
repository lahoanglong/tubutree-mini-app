'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { MergeDir } from '@tubutree/shared-types';
import { swipeDir } from '@tubutree/app-core/game-mini/arcade';
import { createArcadeSynth, readSoundOn, saveSoundOn } from '@tubutree/app-core/game-mini/arcade-sfx';
import { usePublicConfig } from '@/lib/use-public-config';
import { arcadeStorage } from './arcade-platform';

type XmasSkin = typeof import('../season/xmas-arcade-skin');
let skinLoad: Promise<XmasSkin> | null = null;

/**
 * Áo Noel của bàn chơi (hình ô, ngôi sao vàng, tiếng chuông): chunk hình chỉ tải khi `theme.seasonal` là "christmas". Chunk chưa về hay tải lỗi
 * thì bàn chơi giữ áo thường; luật ván không đổi. Một promise cho cả trang để hai bàn mở liền nhau không tải hai lần.
 */
export function useXmasSkin(): XmasSkin | null {
  const xmas = usePublicConfig().seasonalTheme === 'christmas';
  const [skin, setSkin] = useState<XmasSkin | null>(null);
  useEffect(() => {
    if (!xmas) return;
    let live = true;
    skinLoad ??= import('../season/xmas-arcade-skin').catch((e: unknown) => {
      skinLoad = null;
      throw e;
    });
    skinLoad.then((m) => live && setSkin(m), () => undefined);
    return () => {
      live = false;
    };
  }, [xmas]);
  return xmas ? skin : null;
}

/** Âm thanh của bàn chơi: bật/tắt nhớ trên máy (mặc định tắt khi máy bật giảm chuyển động), bộ phát tạo lười ở lần phát đầu, đóng khi rời bàn. */
export function useArcadeSound() {
  const [on, setOn] = useState(() => readSoundOn(arcadeStorage(), typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true));
  const onRef = useRef(on);
  onRef.current = on;
  const synth = useMemo(() => createArcadeSynth(() => onRef.current), []);
  useEffect(() => () => synth.close(), [synth]);
  const toggle = () => {
    const next = !onRef.current;
    setOn(next);
    saveSoundOn(arcadeStorage(), next);
  };
  return { on, toggle, synth };
}

/** Vuốt trên một vùng (Pointer Events, giữ con trỏ tới lúc nhả): nhả tay đủ xa thì gọi `onDir`, chạm ngắn bỏ qua. */
export function useSwipe(onDir: (dir: MergeDir) => void) {
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (!e.isPrimary) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      drag.current = null;
      const dir = swipeDir(e.clientX - d.x, e.clientY - d.y);
      if (dir) onDir(dir);
    },
    onPointerCancel: () => {
      drag.current = null;
    },
  };
}

/** Phím gõ vào ô nhập (ô tìm ở đầu trang web) hay đang ghép chữ bằng bộ gõ là chữ, không phải nước đi. */
function typing(e: KeyboardEvent): boolean {
  const t = e.target;
  return e.isComposing || (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)));
}

/**
 * Phím trên cả cửa sổ (chơi bằng bàn phím trên máy tính): `pick` đổi tên phím ra lệnh (null là bỏ qua, phải là hàm cố định), `run` luôn là
 * bản mới nhất. Phím kèm Alt/Ctrl/⌘ và phím đang gõ trong ô nhập để nguyên cho trình duyệt.
 */
export function useWindowKeys<T>(pick: (key: string) => T | null, run: (v: T) => void) {
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || typing(e)) return;
      const v = pick(e.key);
      if (v === null) return;
      e.preventDefault();
      runRef.current(v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick]);
}
