import type { ArcadeShape } from '../game-mini/arcade-art';

/**
 * Lớp áo Noel của hai game thao tác (Ghép Mầm Xanh, Băng Chuyền Xanh), nạp lười chỉ khi `theme.seasonal` là "christmas": 8 bậc ô Giáng sinh và
 * ngôi sao vàng thay giọt vàng. Cùng khung 48 × 48 và cùng tên tông với `arcade-art.ts` nên app vẽ bằng `ArcadeArt` sẵn có. Luật ghép, điểm, thưởng
 * giữ nguyên.
 */
export const XMAS_MERGE_ART: Record<number, readonly ArcadeShape[]> = {
  1: [
    { d: 'M24 8v32M10 16l28 16M10 32l28-16', stroke: 'sky', width: 3 },
    { d: 'M20 10l4 4 4-4M20 38l4-4 4 4', stroke: 'sky', width: 2 },
    { cx: 24, cy: 24, r: 3, fill: 'mist' },
  ],
  2: [
    { d: 'M14 40l20-32', stroke: 'bark', width: 2 },
    { d: 'M19 32l-7-3m10-2l-7-3m10-2l-7-3m10-2l-7-3m-7 18l6 4m-3-9l6 4m-3-9l6 4m-3-9l6 4', stroke: 'deep', width: 2.5 },
  ],
  3: [
    { d: 'M24 10V5', stroke: 'bark', width: 2 },
    { d: 'M20 10h8v5h-8z', fill: 'gold' },
    { cx: 24, cy: 28, r: 13, fill: 'fruit' },
    { d: 'M12 26q12 6 24 0', stroke: 'gold', width: 2 },
    { cx: 19, cy: 22, r: 2.5, fill: 'paper' },
  ],
  4: [
    { d: 'M24 8c-8 0-11 7-11 15v7l-4 5h30l-4-5v-7c0-8-3-15-11-15z', fill: 'gold' },
    { cx: 24, cy: 38, r: 3.5, fill: 'bark' },
    { d: 'M24 8l-6-4v6zm0 0l6-4v6z', fill: 'fruit' },
  ],
  5: [
    { d: 'M10 24a14 14 0 1 0 28 0a14 14 0 1 0-28 0', stroke: 'leaf', width: 7 },
    { cx: 15, cy: 15, r: 2.5, fill: 'fruit' },
    { cx: 34, cy: 15, r: 2.5, fill: 'fruit' },
    { cx: 37, cy: 30, r: 2.5, fill: 'fruit' },
    { d: 'M24 37l-7 6h5l2-3 2 3h5z', fill: 'fruit' },
  ],
  6: [
    { cx: 24, cy: 33, r: 10, fill: 'mist' },
    { cx: 24, cy: 17, r: 7, fill: 'mist' },
    { d: 'M17 10h14V8h-3V3h-8v5h-3z', fill: 'ink' },
    { d: 'M17 22h14v4h-4v6h-4v-6h-6z', fill: 'fruit' },
    { cx: 22, cy: 16, r: 1.2, fill: 'ink' },
    { cx: 26, cy: 16, r: 1.2, fill: 'ink' },
  ],
  7: [
    { d: 'M14 35v9m5-9v9m10-9v9m5-9v9', stroke: 'bark', width: 2.5 },
    { d: 'M10 30q0-6 8-6h12q7 0 7 6t-7 6H18q-8 0-8-6z', fill: 'bark' },
    { d: 'M33 27l4-9', stroke: 'bark', width: 4 },
    { cx: 38, cy: 16, r: 4.5, fill: 'bark' },
    { d: 'M36 12l-3-7m1 3l-4-2m10 6l3-7m-1 3l4-2', stroke: 'soil', width: 2 },
    { cx: 42, cy: 17, r: 1.8, fill: 'fruit' },
  ],
  8: [
    { d: 'M21 42h6v5h-6z', fill: 'bark' },
    { d: 'M24 7l13 16h-6l9 11h-7l8 9H7l8-9H8l9-11h-6z', fill: 'deep' },
    { d: 'M24 0l2 4 4 1-3 3 1 4-4-2-4 2 1-4-3-3 4-1z', fill: 'gold' },
    { cx: 20, cy: 24, r: 2, fill: 'fruit' },
    { cx: 29, cy: 31, r: 2, fill: 'gold' },
    { cx: 18, cy: 37, r: 2, fill: 'fruit' },
    { cx: 31, cy: 39, r: 2, fill: 'paper' },
  ],
};

export { xmasTierName } from './xmas-tier-names';

/** Ngôi sao vàng thay giọt vàng của món vàng (+5 điểm ván như cũ). */
export const XMAS_GOLDEN_ART: readonly ArcadeShape[] = [{ d: 'M24 5l5 11 12 2-9 8 2 12-10-6-10 6 2-12-9-8 12-2z', fill: 'gold' }];

/** Chữ cuối ván Ghép khi tới bậc 8 (thay "Rừng Tubu!"). */
export const XMAS_MERGE_WIN = 'Cây Thông Tubu!';
