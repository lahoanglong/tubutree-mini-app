import {
  MERGE_GOAL,
  MERGE_MAX_MOVES,
  MERGE_SIZE,
  mergeCanMove,
  mergeMaxTile,
  mergeSlide,
  mergeSpawn,
  mergeStart,
  mergeTier,
  type MergeDir,
} from '@tubutree/shared-types';
import { arcadeCopy, type ArcadeMiniCopyKey } from './arcade-copy';

/**
 * Bàn Ghép Mầm Xanh cho giao diện (Mini App và web cùng dùng): giữ mã từng ô để dời mượt bằng CSS, ô vừa ghép (nảy), ô mới (mọc lên), ô
 * nguồn đã ghép (trượt vào rồi biến mất). Luật dồn, ghép, thêm ô là động cơ chung `game-arcade.ts` của shared-types, đúng thứ tự gọi số
 * ngẫu nhiên mà máy chủ dùng để chơi lại, nên chuỗi `path` nộp lên luôn ra cùng điểm ở hai phía.
 */
export type MergeTileState = 'idle' | 'new' | 'merged' | 'gone';

export interface MergeTileView {
  id: number;
  value: number;
  /** Ô theo hàng: `hàng * 4 + cột`. */
  cell: number;
  state: MergeTileState;
}

export interface MergeGame {
  grid: number[];
  tiles: MergeTileView[];
  score: number;
  /** Chuỗi hướng đã vuốt có làm bàn đổi: đây là bài nộp. */
  path: string;
  won: boolean;
  over: boolean;
  /** Số cặp ghép và điểm của nước vừa đi (chuông chuỗi ghép, rung). */
  lastMerges: number;
  lastGain: number;
  /** Bậc cao nhất vừa đạt ở nước này (0 nếu không lên bậc mới). */
  newTier: number;
  goal: number;
  nextId: number;
  rng: () => number;
}

export function mergeGameStart(seed: number, goal: number = MERGE_GOAL, size: number = MERGE_SIZE): MergeGame {
  const start = mergeStart(seed, size);
  const tiles = start.spawned.map((s, i) => ({ id: i + 1, value: s.value, cell: s.cell, state: 'new' as const }));
  return {
    grid: start.grid,
    tiles,
    score: 0,
    path: '',
    won: mergeMaxTile(start.grid) >= goal,
    over: !mergeCanMove(start.grid),
    lastMerges: 0,
    lastGain: 0,
    newTier: 0,
    goal,
    nextId: tiles.length + 1,
    rng: start.rng,
  };
}

/**
 * Một nước vuốt. Không đổi gì (vuốt vào tường, ván đã xong, chạm trần nước đi) thì trả lại đúng đối tượng cũ để nơi gọi bỏ qua. `rng` của
 * ván được gọi tiếp (có trạng thái): chỉ gọi một lần cho mỗi nước thật.
 */
export function mergeGameMove(g: MergeGame, dir: MergeDir): MergeGame {
  if (g.won || g.over || g.path.length >= MERGE_MAX_MOVES) return g;
  const slide = mergeSlide(g.grid, dir);
  if (!slide.moved) return g;
  const live = g.tiles.filter((t) => t.state !== 'gone');
  const byCell = new Map(live.map((t) => [t.cell, t]));
  let nextId = g.nextId;
  const tiles: MergeTileView[] = [];
  let merges = 0;
  for (const m of slide.moves) {
    const sources = m.from.map((c) => byCell.get(c)).filter((t): t is MergeTileView => t !== undefined);
    if (sources.length === 2) {
      merges += 1;
      for (const s of sources) tiles.push({ ...s, cell: m.to, state: 'gone' });
      tiles.push({ id: nextId++, value: sources[0]!.value * 2, cell: m.to, state: 'merged' });
    } else if (sources[0]) {
      tiles.push({ ...sources[0], cell: m.to, state: 'idle' });
    }
  }
  const spawned = mergeSpawn(slide.grid, g.rng);
  const grid = spawned?.grid ?? slide.grid;
  if (spawned) tiles.push({ id: nextId++, value: spawned.value, cell: spawned.cell, state: 'new' });
  const before = mergeTier(mergeMaxTile(g.grid));
  const after = mergeTier(mergeMaxTile(grid));
  return {
    ...g,
    grid,
    tiles,
    score: g.score + slide.gained,
    path: g.path + dir,
    won: mergeMaxTile(grid) >= g.goal,
    over: !mergeCanMove(grid),
    lastMerges: merges,
    lastGain: slide.gained,
    newTier: after > before ? after : 0,
    nextId,
  };
}

/** Bỏ các ô nguồn đã trượt vào chỗ ghép (gọi sau khi hoạt ảnh trượt xong) và hạ cờ nảy/mọc của ô còn lại. */
export function mergeGameSettle(g: MergeGame): MergeGame {
  if (!g.tiles.some((t) => t.state !== 'idle')) return g;
  return { ...g, tiles: g.tiles.filter((t) => t.state !== 'gone').map((t) => (t.state === 'idle' ? t : { ...t, state: 'idle' })) };
}

export const mergeGameTier = (g: MergeGame): number => mergeTier(mergeMaxTile(g.grid));

/** Tên bậc của một giá trị ô: 2 Hạt giống … 256 trở lên Rừng Tubu. */
export function mergeTierName(value: number): string {
  const tier = Math.max(1, mergeTier(value));
  return arcadeCopy(`merge.tier.${tier}` as ArcadeMiniCopyKey);
}

/** Phím mũi tên (và WASD) sang hướng vuốt; phím khác thì null. */
export function mergeKeyDir(key: string): MergeDir | null {
  switch (key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      return 'u';
    case 'ArrowDown':
    case 's':
    case 'S':
      return 'd';
    case 'ArrowLeft':
    case 'a':
    case 'A':
      return 'l';
    case 'ArrowRight':
    case 'd':
    case 'D':
      return 'r';
    default:
      return null;
  }
}
