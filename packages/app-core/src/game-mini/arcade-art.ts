import type { MiniConveyorArt } from '@tubutree/shared-types';

/**
 * Hình vector của hai game thao tác (ô cây 8 bậc, món trên băng, giọt vàng), viết dạng dữ liệu để Mini App và web vẽ cùng một bộ hình mà
 * không có emoji của hệ điều hành. Khung 48×48. Màu là tên tông; CSS của app ánh tông sang token ngữ nghĩa (`.tubu-ar-f-<tông>` tô nền,
 * `.tubu-ar-s-<tông>` tô nét) nên không có mã màu ở đây.
 */
export const ARCADE_TONES = ['soil', 'seed', 'leaf', 'deep', 'lime', 'petal', 'sky', 'bark', 'fruit', 'gold', 'ink', 'paper', 'mist', 'stone'] as const;
export type ArcadeTone = (typeof ARCADE_TONES)[number];

export type ArcadeShape =
  | { d: string; fill: ArcadeTone }
  | { d: string; stroke: ArcadeTone; width: number }
  | { cx: number; cy: number; r: number; fill: ArcadeTone };

const SOIL: ArcadeShape = { d: 'M5 42c3-6 11-9 19-9s16 3 19 9z', fill: 'soil' };

/** Ô cây theo bậc 1..8. */
export const MERGE_TIER_ART: Record<number, readonly ArcadeShape[]> = {
  1: [SOIL, { d: 'M24 12c7 4 9 12 4 18-2 3-6 3-8 0-5-6-3-14 4-18z', fill: 'seed' }, { d: 'M24 16v12', stroke: 'bark', width: 2 }],
  2: [
    SOIL,
    { d: 'M24 38V22', stroke: 'leaf', width: 3 },
    { d: 'M24 27c-7 1-12-3-13-10 8-1 12 3 13 10z', fill: 'leaf' },
    { d: 'M24 24c7-1 11-6 11-13-8 0-11 6-11 13z', fill: 'lime' },
  ],
  3: [
    SOIL,
    { d: 'M24 38V14', stroke: 'deep', width: 3 },
    { d: 'M24 31c-8 0-12-4-13-10 8-1 13 3 13 10z', fill: 'leaf' },
    { d: 'M24 26c8-1 12-5 13-11-8-1-13 4-13 11z', fill: 'lime' },
    { d: 'M24 18c-5-1-7-5-7-10 5 0 8 4 7 10z', fill: 'leaf' },
  ],
  4: [
    SOIL,
    { d: 'M22 38h4l-1-14h-2z', fill: 'bark' },
    { cx: 24, cy: 18, r: 11, fill: 'leaf' },
    { cx: 19, cy: 15, r: 4, fill: 'lime' },
  ],
  5: [
    SOIL,
    { d: 'M24 38V24', stroke: 'deep', width: 3 },
    { d: 'M24 32c-6 0-9-3-10-7 6-1 9 2 10 7z', fill: 'leaf' },
    { cx: 24, cy: 10, r: 6, fill: 'petal' },
    { cx: 32, cy: 16, r: 6, fill: 'petal' },
    { cx: 29, cy: 25, r: 6, fill: 'petal' },
    { cx: 19, cy: 25, r: 6, fill: 'petal' },
    { cx: 16, cy: 16, r: 6, fill: 'petal' },
    { cx: 24, cy: 18, r: 5, fill: 'gold' },
  ],
  6: [
    SOIL,
    { cx: 24, cy: 24, r: 12, fill: 'fruit' },
    { d: 'M24 12c0-3 1-5 3-6', stroke: 'bark', width: 2 },
    { d: 'M26 11c4-4 9-4 12-1-4 4-9 4-12 1z', fill: 'leaf' },
    { cx: 19, cy: 20, r: 3, fill: 'paper' },
  ],
  7: [
    SOIL,
    { d: 'M21 40h6l-1-14h-4z', fill: 'bark' },
    { cx: 24, cy: 20, r: 13, fill: 'deep' },
    { cx: 15, cy: 24, r: 7, fill: 'leaf' },
    { cx: 33, cy: 24, r: 7, fill: 'leaf' },
    { cx: 24, cy: 12, r: 7, fill: 'lime' },
  ],
  8: [
    { cx: 37, cy: 11, r: 5, fill: 'gold' },
    SOIL,
    { d: 'M12 40V30', stroke: 'bark', width: 3 },
    { d: 'M12 12l8 18H4z', fill: 'leaf' },
    { d: 'M36 40V31', stroke: 'bark', width: 3 },
    { d: 'M36 16l7 16H29z', fill: 'lime' },
    { d: 'M24 40V28', stroke: 'bark', width: 3 },
    { d: 'M24 6l10 23H14z', fill: 'deep' },
  ],
};

/** Món trên Băng Chuyền Xanh. */
export const CONVEYOR_ART: Record<MiniConveyorArt, readonly ArcadeShape[]> = {
  pet_bottle: [
    { d: 'M20 6h8v5h-8z', fill: 'sky' },
    { d: 'M19 12h10c2 3 4 5 4 9v19a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3V21c0-4 2-6 4-9z', fill: 'mist' },
    { d: 'M15 24h18v7H15z', fill: 'sky' },
  ],
  can: [
    { d: 'M14 9h20v31a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3z', fill: 'stone' },
    { d: 'M14 18h20v12H14z', fill: 'petal' },
    { d: 'M15 6h18l1 3H14z', fill: 'ink' },
  ],
  carton: [
    { d: 'M7 17l17-8 17 8v20l-17 8-17-8z', fill: 'soil' },
    { d: 'M7 17l17 8 17-8', stroke: 'bark', width: 2 },
    { d: 'M24 25v20', stroke: 'bark', width: 2 },
  ],
  newspaper: [
    { d: 'M8 10h28v28a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z', fill: 'paper' },
    { d: 'M36 16h4v22a3 3 0 0 1-3 3', fill: 'stone' },
    { d: 'M12 15h20v6H12z', fill: 'ink' },
    { d: 'M12 26h20M12 31h20M12 36h13', stroke: 'stone', width: 2 },
  ],
  glass_jar: [
    { d: 'M16 7h16v6H16z', fill: 'bark' },
    { d: 'M14 14h20a3 3 0 0 1 3 3v22a4 4 0 0 1-4 4H15a4 4 0 0 1-4-4V17a3 3 0 0 1 3-3z', fill: 'mist' },
    { d: 'M17 20v16', stroke: 'paper', width: 3 },
  ],
  banana_peel: [
    { d: 'M24 8c2 6 2 12 0 18-4 6-11 9-15 15 6-1 11-4 15-8 4 4 9 7 15 8-4-6-11-9-15-15', fill: 'gold' },
    { d: 'M22 6h4v4h-4z', fill: 'bark' },
  ],
  coffee_grounds: [
    { d: 'M10 18h24l-3 21a4 4 0 0 1-4 3H17a4 4 0 0 1-4-3z', fill: 'paper' },
    { d: 'M34 22h3a4 4 0 0 1 0 8h-4', stroke: 'stone', width: 3 },
    { d: 'M12 18c2-5 18-5 20 0z', fill: 'bark' },
    { cx: 17, cy: 15, r: 2, fill: 'bark' },
    { cx: 25, cy: 13, r: 2, fill: 'bark' },
  ],
  eggshell: [
    { d: 'M8 26h32c0 9-7 16-16 16S8 35 8 26z', fill: 'paper' },
    { d: 'M8 26l5-5 5 5 6-6 5 6 5-5 6 5', stroke: 'stone', width: 2 },
    { d: 'M15 6c5 0 9 6 9 11l-4 3-4-3-5 3c0-6 0-14 4-14z', fill: 'paper' },
  ],
  leaf: [
    { d: 'M10 38C8 22 18 10 38 8c1 19-9 30-28 30z', fill: 'seed' },
    { d: 'M10 38L32 14', stroke: 'bark', width: 2 },
  ],
  apple_core: [
    { d: 'M15 10c6 2 12 2 18 0-2 5-5 7-5 14s3 9 5 14c-6-2-12-2-18 0 2-5 5-7 5-14s-3-9-5-14z', fill: 'paper' },
    { d: 'M15 10c3 0 5 1 5 3M33 10c-3 0-5 1-5 3M15 38c3 0 5-1 5-3M33 38c-3 0-5-1-5-3', stroke: 'petal', width: 3 },
    { d: 'M24 9V4', stroke: 'bark', width: 2 },
    { cx: 22, cy: 22, r: 1.5, fill: 'ink' },
    { cx: 26, cy: 26, r: 1.5, fill: 'ink' },
  ],
  refill_pump: [
    { d: 'M21 4h9v3h-5v5h-4z', fill: 'deep' },
    { d: 'M17 13h14a3 3 0 0 1 3 3v24a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3V16a3 3 0 0 1 3-3z', fill: 'leaf' },
    { d: 'M18 22h12v11H18z', fill: 'paper' },
    { d: 'M22 25l2 5 2-5', stroke: 'leaf', width: 2 },
  ],
  refill_jug: [
    { d: 'M14 8h10v5H14z', fill: 'deep' },
    { d: 'M11 14h18l6 6v19a4 4 0 0 1-4 4H13a4 4 0 0 1-4-4V18a4 4 0 0 1 2-4z', fill: 'leaf' },
    { d: 'M29 18h5v9', stroke: 'deep', width: 3 },
    { d: 'M13 24h14v11H13z', fill: 'paper' },
  ],
  refill_spray: [
    { d: 'M16 5h14l4 4-4 3H16z', fill: 'deep' },
    { d: 'M19 12h8v4h-8z', fill: 'deep' },
    { d: 'M17 17h12l3 5v18a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3V22z', fill: 'sky' },
    { d: 'M17 26h12v9H17z', fill: 'paper' },
  ],
};

/** Giọt vàng của món vàng (+5 điểm ván). */
export const GOLDEN_DROP_ART: readonly ArcadeShape[] = [
  { d: 'M24 6c7 10 12 17 12 24a12 12 0 0 1-24 0c0-7 5-14 12-24z', fill: 'gold' },
  { d: 'M19 30a5 5 0 0 0 5 5', stroke: 'paper', width: 3 },
];
