// Nguồn: apps/miniapp/src/components/game/hub-art.tsx (giữ giống hệt).
import type { ReactNode } from 'react';
import type { HubArt } from '@tubutree/app-core/game-hub/cards';

// Hình minh hoạ vector của thẻ Sảnh Game (khung 64×64, đứng trên nền chuyển màu của thẻ). Màu qua token: trắng cố định cho mảng chính để nổi trên
// mọi tông nền, các bậc forest/honey/clay/blue làm điểm nhấn. Bản Mini là nguồn.
const W = 'var(--stone-0)';
const LEAF = 'var(--forest-400)';
const DEEP = 'var(--forest-700)';
const SUN = 'var(--honey-500)';
const CLAY = 'var(--clay-500)';
const SKY = 'var(--blue-600)';
const MIST = 'var(--blue-50)';

const ART: Record<HubArt, ReactNode> = {
  dew: (
    <>
      <path d="M12 44c6-20 26-30 40-30-2 16-14 34-34 34-2 0-4 0-6-4z" fill={W} />
      <path d="M18 44c8-8 18-16 28-22" stroke={LEAF} strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M44 6c4 6 6 9 6 12a6 6 0 0 1-12 0c0-3 2-6 6-12z" fill={MIST} stroke={SKY} strokeWidth="2" />
      <path d="M26 20c2 3 3 5 3 6a3 3 0 0 1-6 0c0-1 1-3 3-6z" fill={MIST} stroke={SKY} strokeWidth="1.5" />
    </>
  ),
  rush: (
    <>
      <rect x="20" y="18" width="20" height="36" rx="6" fill={W} />
      <rect x="25" y="10" width="10" height="9" rx="2" fill={W} />
      <rect x="20" y="34" width="20" height="14" fill={LEAF} />
      <path d="M46 22h10m0 0-4-4m4 4-4 4M8 42h10m-10 0 4-4m-4 4 4 4" stroke={W} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  quiz: (
    <>
      <path d="M10 14h44a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H28l-10 8v-8h-8a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z" fill={W} />
      <path d="M26 26a6 6 0 1 1 9 5c-2 1-3 2-3 4" stroke={DEEP} strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <circle cx="32" cy="40" r="2.2" fill={DEEP} />
    </>
  ),
  sort: (
    <>
      <path d="M16 22h32l-4 32H20z" fill={W} />
      <rect x="12" y="16" width="40" height="6" rx="3" fill={W} />
      <path d="M26 34l6-6 6 6m-6-6v16" stroke={LEAF} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  match: (
    <>
      <rect x="8" y="14" width="26" height="34" rx="5" fill={W} transform="rotate(-8 21 31)" />
      <rect x="30" y="16" width="26" height="34" rx="5" fill={MIST} transform="rotate(8 43 33)" />
      <circle cx="21" cy="31" r="6" fill={LEAF} />
      <path d="M38 34l4 4 8-9" stroke={DEEP} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  origin: (
    <>
      <path d="M4 54l16-18 10 10 12-16 18 24z" fill={W} />
      <path d="M32 6a11 11 0 0 1 11 11c0 9-11 19-11 19S21 26 21 17A11 11 0 0 1 32 6z" fill={CLAY} />
      <circle cx="32" cy="17" r="4.5" fill={W} />
    </>
  ),
  basket: (
    <>
      <path d="M20 26a12 12 0 0 1 24 0" stroke={W} strokeWidth="4" fill="none" />
      <path d="M8 28h48l-6 24H14z" fill={W} />
      <circle cx="24" cy="22" r="6" fill={SUN} />
      <path d="M36 14c8 0 10 6 10 10-6 0-10-4-10-10z" fill={LEAF} />
      <path d="M20 36v10m8-10v10m8-10v10m8-10v10" stroke={LEAF} strokeWidth="2.5" strokeLinecap="round" />
    </>
  ),
  kitchen: (
    <>
      <rect x="20" y="24" width="18" height="30" rx="5" fill={W} />
      <path d="M24 24v-8h12l8 4-2 4H36" fill={W} />
      <path d="M48 14l6-3m-6 9 7 1m-7 5 6 4" stroke={W} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M24 42c4-6 10-8 10-8 0 6-4 10-10 8z" fill={LEAF} />
    </>
  ),
  merge: (
    <>
      <rect x="8" y="8" width="22" height="22" rx="5" fill={W} />
      <rect x="34" y="8" width="22" height="22" rx="5" fill={MIST} />
      <rect x="8" y="34" width="22" height="22" rx="5" fill={MIST} />
      <rect x="34" y="34" width="22" height="22" rx="5" fill={W} />
      <path d="M19 24c0-6 4-9 7-9 0 5-3 9-7 9zm0 0c0-4-3-6-6-6 0 4 3 6 6 6z" fill={LEAF} />
      <path d="M45 52V40m0 0c0-4 4-6 7-6 0 4-3 6-7 6zm0 4c0-3-3-5-6-5 0 3 3 5 6 5z" fill={DEEP} />
    </>
  ),
  conveyor: (
    <>
      <rect x="4" y="40" width="56" height="10" rx="5" fill={W} />
      <circle cx="12" cy="45" r="3" fill={DEEP} />
      <circle cx="32" cy="45" r="3" fill={DEEP} />
      <circle cx="52" cy="45" r="3" fill={DEEP} />
      <rect x="10" y="24" width="12" height="14" rx="3" fill={SUN} />
      <path d="M32 38c0-10 6-14 12-14 0 8-5 14-12 14z" fill={LEAF} />
    </>
  ),
  matcher: (
    <>
      <circle cx="30" cy="34" r="20" fill={W} />
      <path d="M20 34l7 7 14-15" stroke={LEAF} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M50 6l2.5 6 6 2.5-6 2.5L50 23l-2.5-6-6-2.5 6-2.5z" fill={SUN} />
    </>
  ),
  wheel: (
    <>
      <circle cx="32" cy="34" r="24" fill={W} />
      <path d="M32 34V10a24 24 0 0 1 20.8 12z" fill={SUN} />
      <path d="M32 34l20.8 12A24 24 0 0 1 32 58z" fill={LEAF} />
      <path d="M32 34L11.2 46A24 24 0 0 1 11.2 22z" fill={CLAY} />
      <circle cx="32" cy="34" r="5" fill={DEEP} />
      <path d="M26 4h12l-6 9z" fill={DEEP} />
    </>
  ),
  leaf: (
    <>
      <path d="M10 50C14 24 32 12 54 10c-2 24-16 42-40 42-2 0-3-1-4-2z" fill={W} />
      <path d="M14 48c10-12 22-22 34-30" stroke={LEAF} strokeWidth="3.5" strokeLinecap="round" fill="none" />
    </>
  ),
};

export function HubArtIcon({ art }: { art: HubArt }) {
  return (
    <svg viewBox="0 0 64 64" className="tubu-hub-art-svg" aria-hidden focusable="false">
      {ART[art]}
    </svg>
  );
}
