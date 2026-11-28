// Nguồn: apps/miniapp/src/components/loyalty/tier-medallion.tsx (giữ giống hệt).
import type { ReactNode } from 'react';
import { tierMedalAt, type TierMedal } from '@tubutree/app-core/loyalty-medal';

const TRUNK = 'var(--clay-700)';
const SHINE = 'var(--stone-0)';

// Hình giữa mặt huy chương, tâm (32, 30) trong khung 64×72. Bản Mini là nguồn.
function glyph(m: TierMedal): ReactNode {
  switch (m.kind) {
    case 'sprout':
      return (
        <>
          <path d="M32 44V30" stroke={m.leaf} strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M32 33c-7 0-11-4-11-10 6 0 11 4 11 10z" fill={m.leaf} />
          <path d="M32 30c0-7 5-11 12-11 0 6-5 11-12 11z" fill={m.accent} />
          <path d="M23 44h18" stroke={m.ring} strokeWidth="2.5" strokeLinecap="round" />
        </>
      );
    case 'sapling':
      return (
        <>
          <path d="M32 46V16" stroke={m.leaf} strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M32 40c-8 0-12-4-12-10 7 0 12 4 12 10z" fill={m.leaf} />
          <path d="M32 32c0-7 5-11 12-11 0 7-5 11-12 11z" fill={m.leaf} />
          <path d="M32 22c-5-1-8-5-7-10 5 1 8 5 7 10z" fill={m.accent} />
          <path d="M23 46h18" stroke={m.ring} strokeWidth="2.5" strokeLinecap="round" />
        </>
      );
    case 'tree':
      return (
        <>
          <path d="M30 47V34h4v13z" fill={TRUNK} />
          <circle cx="24" cy="29" r="8" fill={m.leaf} />
          <circle cx="40" cy="29" r="8" fill={m.leaf} />
          <circle cx="32" cy="21" r="10" fill={m.leaf} />
          <circle cx="26" cy="27" r="2" fill={m.accent} />
          <circle cx="38" cy="31" r="2" fill={m.accent} />
          <circle cx="34" cy="17" r="2" fill={m.accent} />
        </>
      );
    case 'crown':
      return (
        <>
          <path d="M32 14l9 12h-5l7 10h-6l7 10H20l7-10h-6l7-10h-5z" fill={m.leaf} />
          <path d="M30 46h4v4h-4z" fill={TRUNK} />
          <path d="M32 6l1.6 3.3 3.6.5-2.6 2.5.6 3.6L32 14.2l-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill={m.accent} />
        </>
      );
  }
}

/**
 * Huy chương hạng thành viên (thay emoji 🌱🌿🌳🌲 của hệ điều hành): viền, mặt, hình cây lớn dần theo hạng, hai dải ruy băng; hạng cao nhất viền
 * mật ong và có sao. Tra theo THỨ HẠNG (`tierMedalAt`). Cỡ đặt ở member-polish.css: `lg` thẻ hạng, `xl` hộp chúc mừng, `md` bậc thang hạng,
 * `sm` trong huy hiệu một dòng. Không có `label` thì chỉ trang trí (`aria-hidden`), vì tên hạng luôn đứng cạnh.
 */
export function TierMedallion({ rank, size = 'lg', label }: { rank: number; size?: 'sm' | 'md' | 'lg' | 'xl'; label?: string }) {
  const m = tierMedalAt(rank);
  return (
    <svg
      className="tubu-tier-medal"
      data-size={size}
      data-kind={m.kind}
      viewBox="0 0 64 72"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-testid="tier-medallion"
    >
      <path d="M21 48l-6 21 8-4 5 6 5-19z" fill={m.ring} opacity="0.85" />
      <path d="M43 48l6 21-8-4-5 6-5-19z" fill={m.ring} opacity="0.85" />
      <circle cx="32" cy="30" r="28" fill={m.ring} />
      <circle cx="32" cy="30" r="23" fill={m.face} />
      <path d="M14 23a20 20 0 0 1 13-13" stroke={SHINE} strokeOpacity="0.55" strokeWidth="3" strokeLinecap="round" fill="none" />
      {glyph(m)}
    </svg>
  );
}
