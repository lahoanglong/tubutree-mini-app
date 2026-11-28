'use client';

import '@tubutree/design-tokens/src/seasonal-christmas.css';
import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ICON_VIEWBOX, SNOWFLAKES, XMAS_ICONS, type Flake } from '@tubutree/app-core/seasonal/christmas-art';
import { christmasCopy as c } from '@tubutree/app-core/seasonal/christmas-copy';
import { readSnowOff, writeSnowOff } from '@tubutree/app-core/seasonal/christmas-hero';
import { browserStorage } from '@/lib/recently-viewed';

/**
 * Bản web của Mini `components/season/snowfall.tsx`: lớp tuyết toàn màn và nút ❄️ nổi ở góc phải dưới cho các trang `showsSiteSnow` (Trang chủ có
 * lớp tuyết và nút ❄️ riêng trên thẻ Noel). Chunk riêng, chỉ tải khi `theme.seasonal` là Noel (site-snow-gate.tsx, gắn ở app/layout-shell.tsx).
 * Máy bật giảm chuyển động thì không vẽ gì; bật/tắt ❄️ nhớ chung một khoá với nút trên thẻ Noel. Trang có thanh mua dính đáy thì nút ẩn.
 */
export default function SiteSnow({ overNav }: { overNav: boolean }) {
  const reduced = useReducedMotion();
  const [on, setOn] = useState(() => !readSnowOff(browserStorage()));
  if (reduced) return null;
  const toggle = () => {
    const next = !on;
    setOn(next);
    writeSnowOff(browserStorage(), !next);
  };
  return (
    <>
      {on && <SnowfallLayer />}
      <button
        type="button"
        className="tubu-xmas-snow-pill"
        data-season="christmas"
        data-over-nav={overNav || undefined}
        aria-label={c.snow}
        aria-pressed={on}
        onClick={toggle}
        data-testid="site-snow-toggle"
      >
        <span>
          <XmasIcon d={XMAS_ICONS.snowflake} />
        </span>
      </button>
    </>
  );
}

export function XmasIcon({ d }: { d: string }) {
  return (
    <svg className="tubu-xmas-icon" viewBox={ICON_VIEWBOX} aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

export const flakeVars = (f: Flake): CSSProperties => ({ '--x': f.x, '--s': f.size, '--d': f.dur, '--delay': f.delay, '--drift': f.drift, '--o': f.opacity }) as CSSProperties;

/** Lớp tuyết toàn màn (gắn vào body, không chặn chạm): tạm dừng khi tab ẩn; không gắn khi khách tắt ❄️ hay máy bật giảm chuyển động. */
export function SnowfallLayer() {
  const hidden = usePageHidden();
  return createPortal(
    <div className={hidden ? 'tubu-xmas-snow is-paused' : 'tubu-xmas-snow'} data-season="christmas" aria-hidden="true" data-testid="christmas-snow">
      {SNOWFLAKES.map((f, i) => (
        <span key={i} className={f.needle ? 'tubu-xmas-flake is-needle' : 'tubu-xmas-flake'} style={flakeVars(f)} />
      ))}
    </div>,
    document.body,
  );
}

function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return hidden;
}

const REDUCED = '(prefers-reduced-motion: reduce)';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(REDUCED).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(REDUCED);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}
