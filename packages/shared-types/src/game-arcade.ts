import { MINI_CONVEYOR_BINS, type MiniConveyorBin } from './game-mini';

/**
 * Động cơ tất định của hai game thao tác (Ghép Mầm Xanh, Băng Chuyền Xanh). Máy khách dùng để chơi, máy chủ dùng để chơi lại bài nộp và tự
 * tính kết quả: cùng `seed`, cùng chuỗi nước đi thì cùng bàn, cùng điểm. Toàn hàm thuần, không đồng hồ, không `Math.random`.
 */

/** Bộ sinh số mulberry32: [0, 1), cùng dãy ở mọi máy với cùng `seed` (số nguyên 32 bit). */
export function arcadeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// ── Ghép Mầm Xanh (2048) ──

export const MERGE_SIZE = 4;
/** Ô 256 là Rừng Tubu: tới đó là thắng, ván kết thúc. */
export const MERGE_GOAL = 256;
/** Trần số nước đi của một bài nộp (3 phút, dư cho người vuốt rất nhanh). */
export const MERGE_MAX_MOVES = 2_000;
/** 8 bậc cây: 2 Hạt giống, 4 Mầm non, 8 Chồi lá, 16 Cây con, 32 Hoa xanh, 64 Quả lành, 128 Cổ thụ, 256 Rừng Tubu. */
export const MERGE_TIERS = 8;

export const MERGE_DIRS = ['u', 'd', 'l', 'r'] as const;
export type MergeDir = (typeof MERGE_DIRS)[number];

export function isMergeDir(v: unknown): v is MergeDir {
  return typeof v === 'string' && (MERGE_DIRS as readonly string[]).includes(v);
}

/** Bậc của một ô (1..8); ô trống là 0, từ 256 trở lên đều là bậc 8. */
export function mergeTier(value: number): number {
  if (!Number.isFinite(value) || value < 2) return 0;
  return Math.min(MERGE_TIERS, Math.round(Math.log2(value)));
}

export interface MergeLineResult {
  out: number[];
  gained: number;
  /** `sources[k]`: chỉ số trong đường vào của (các) ô dồn về vị trí `k` của đường ra; hai chỉ số là một lần ghép. */
  sources: number[][];
}

/** Dồn một đường về đầu (chỉ số 0), mỗi ô chỉ ghép một lần mỗi nước như 2048 gốc. */
export function mergeLine(line: readonly number[]): MergeLineResult {
  const tiles = line.flatMap((v, i) => (v > 0 ? [{ v, i }] : []));
  const out: number[] = [];
  const sources: number[][] = [];
  let gained = 0;
  for (let k = 0; k < tiles.length; k++) {
    const a = tiles[k]!;
    const b = tiles[k + 1];
    if (b && a.v === b.v) {
      out.push(a.v * 2);
      sources.push([a.i, b.i]);
      gained += a.v * 2;
      k++;
    } else {
      out.push(a.v);
      sources.push([a.i]);
    }
  }
  while (out.length < line.length) out.push(0);
  return { out, gained, sources };
}

/** Chỉ số ô (theo hàng, `hàng * size + cột`) của từng đường, đọc từ mép mà các ô trượt tới. */
export function mergeLines(dir: MergeDir, size: number = MERGE_SIZE): number[][] {
  const lines: number[][] = [];
  for (let a = 0; a < size; a++) {
    const line: number[] = [];
    for (let b = 0; b < size; b++) {
      if (dir === 'l') line.push(a * size + b);
      else if (dir === 'r') line.push(a * size + (size - 1 - b));
      else if (dir === 'u') line.push(b * size + a);
      else line.push((size - 1 - b) * size + a);
    }
    lines.push(line);
  }
  return lines;
}

export interface MergeSlide {
  grid: number[];
  moved: boolean;
  gained: number;
  /** Ô đích và (các) ô nguồn dồn về đó, để giao diện dời đúng ô cũ. */
  moves: Array<{ to: number; from: number[] }>;
}

export function mergeSlide(grid: readonly number[], dir: MergeDir): MergeSlide {
  const size = Math.round(Math.sqrt(grid.length));
  const next = grid.slice();
  const moves: MergeSlide['moves'] = [];
  let gained = 0;
  let moved = false;
  for (const cells of mergeLines(dir, size)) {
    const r = mergeLine(cells.map((c) => grid[c] ?? 0));
    gained += r.gained;
    r.out.forEach((v, k) => {
      next[cells[k]!] = v;
    });
    r.sources.forEach((src, k) => {
      const to = cells[k]!;
      const from = src.map((i) => cells[i]!);
      moves.push({ to, from });
      if (from.length > 1 || from[0] !== to) moved = true;
    });
  }
  return { grid: next, moved, gained, moves };
}

/** Thêm một ô mới vào một ô trống (90% là 2, 10% là 4). Gọi `rng` đúng hai lần mỗi ô mới. */
export function mergeSpawn(grid: readonly number[], rng: () => number): { grid: number[]; cell: number; value: number } | null {
  const empty = grid.flatMap((v, i) => (v === 0 ? [i] : []));
  if (empty.length === 0) return null;
  const cell = empty[Math.floor(rng() * empty.length)]!;
  const value = rng() < 0.9 ? 2 : 4;
  const next = grid.slice();
  next[cell] = value;
  return { grid: next, cell, value };
}

export function mergeCanMove(grid: readonly number[]): boolean {
  const size = Math.round(Math.sqrt(grid.length));
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i]!;
    if (v === 0) return true;
    const col = i % size;
    if (col < size - 1 && grid[i + 1] === v) return true;
    if (i + size < grid.length && grid[i + size] === v) return true;
  }
  return false;
}

export const mergeMaxTile = (grid: readonly number[]): number => grid.reduce((m, v) => Math.max(m, v), 0);

/** Bàn mở đầu: hai ô mới. Trả cả `rng` đã dùng để nước đi sau lấy tiếp đúng dãy số. */
export function mergeStart(seed: number, size: number = MERGE_SIZE): { grid: number[]; rng: () => number; spawned: Array<{ cell: number; value: number }> } {
  const rng = arcadeRng(seed);
  let grid: number[] = Array.from({ length: size * size }, () => 0);
  const spawned: Array<{ cell: number; value: number }> = [];
  for (let i = 0; i < 2; i++) {
    const s = mergeSpawn(grid, rng);
    if (!s) break;
    grid = s.grid;
    spawned.push({ cell: s.cell, value: s.value });
  }
  return { grid, rng, spawned };
}

export interface MergeReplay {
  grid: number[];
  score: number;
  maxTile: number;
  /** Số nước đi có làm bàn đổi. */
  moves: number;
  won: boolean;
  over: boolean;
}

/**
 * Chơi lại cả ván từ `seed` và chuỗi hướng vuốt. Nước không làm bàn đổi thì bỏ qua (không thêm ô mới). Tới `goal` là thắng: phần chuỗi
 * sau đó không tính. null khi chuỗi sai dạng hoặc dài quá trần.
 */
export function mergeReplay(seed: number, moves: string, goal: number = MERGE_GOAL, size: number = MERGE_SIZE): MergeReplay | null {
  if (typeof moves !== 'string' || moves.length > MERGE_MAX_MOVES || !/^[udlr]*$/.test(moves)) return null;
  const start = mergeStart(seed, size);
  let grid = start.grid;
  let score = 0;
  let count = 0;
  let won = mergeMaxTile(grid) >= goal;
  for (const ch of moves) {
    if (won) break;
    const slide = mergeSlide(grid, ch as MergeDir);
    if (!slide.moved) continue;
    count += 1;
    score += slide.gained;
    grid = mergeSpawn(slide.grid, start.rng)?.grid ?? slide.grid;
    won = mergeMaxTile(grid) >= goal;
  }
  return { grid, score, maxTile: mergeMaxTile(grid), moves: count, won, over: !mergeCanMove(grid) };
}

// ── Băng Chuyền Xanh ──

/** Ký tự của từng thùng trong bài nộp; `-` là món để trôi qua băng. */
export const CONVEYOR_CODE: Record<MiniConveyorBin, string> = { recycle: 'r', organic: 'o', refill: 'f' };
export const CONVEYOR_MISS = '-';
/** Món vàng phân đúng: cộng thêm chừng này điểm ván. */
export const CONVEYOR_GOLDEN_BONUS = 5;
/** Nhân điểm cao nhất của chuỗi đúng liên tiếp. */
export const CONVEYOR_MAX_MULTIPLIER = 5;

/** Nhân điểm theo chuỗi đúng liên tiếp (đã tính món vừa phân): 1–2 món x1, 3–5 x2, 6–8 x3, 9–11 x4, từ 12 x5. */
export function conveyorMultiplier(combo: number): number {
  if (!Number.isFinite(combo) || combo < 1) return 1;
  return Math.min(CONVEYOR_MAX_MULTIPLIER, 1 + Math.floor(combo / 3));
}

export function conveyorEncode(picks: readonly (MiniConveyorBin | null)[]): string {
  return picks.map((p) => (p === null ? CONVEYOR_MISS : CONVEYOR_CODE[p])).join('');
}

/** Đọc bài nộp: đúng `n` ký tự trong `r o f -`; sai dạng thì null. */
export function conveyorDecode(s: unknown, n: number): (MiniConveyorBin | null)[] | null {
  if (typeof s !== 'string' || s.length !== n) return null;
  const out: (MiniConveyorBin | null)[] = [];
  for (const ch of s) {
    if (ch === CONVEYOR_MISS) {
      out.push(null);
      continue;
    }
    const bin = MINI_CONVEYOR_BINS.find((b) => CONVEYOR_CODE[b] === ch);
    if (!bin) return null;
    out.push(bin);
  }
  return out;
}

export interface ConveyorTally {
  correct: number;
  wrong: number;
  missed: number;
  score: number;
  bestCombo: number;
  golden: number;
}

export type ConveyorRunning = ConveyorTally & { combo: number };

export const CONVEYOR_EMPTY_TALLY: ConveyorRunning = { correct: 0, wrong: 0, missed: 0, score: 0, bestCombo: 0, golden: 0, combo: 0 };

/** Bước của một món vào bảng điểm: dùng chung lúc chơi (hiện chuỗi, nhân điểm) và lúc máy chủ đếm lại. */
export function conveyorStep(
  t: ConveyorRunning,
  item: { bin: MiniConveyorBin; golden: boolean },
  pick: MiniConveyorBin | null,
): ConveyorRunning & { gained: number } {
  if (pick === null) return { ...t, missed: t.missed + 1, combo: 0, gained: 0 };
  if (pick !== item.bin) return { ...t, wrong: t.wrong + 1, combo: 0, gained: 0 };
  const combo = t.combo + 1;
  const gained = conveyorMultiplier(combo) + (item.golden ? CONVEYOR_GOLDEN_BONUS : 0);
  return {
    ...t,
    correct: t.correct + 1,
    golden: t.golden + (item.golden ? 1 : 0),
    score: t.score + gained,
    bestCombo: Math.max(t.bestCombo, combo),
    combo,
    gained,
  };
}

export function conveyorTally(items: readonly { bin: MiniConveyorBin; golden: boolean }[], picks: readonly (MiniConveyorBin | null)[]): ConveyorTally {
  let t: ConveyorRunning = CONVEYOR_EMPTY_TALLY;
  items.forEach((item, i) => {
    t = conveyorStep(t, item, picks[i] ?? null);
  });
  return { correct: t.correct, wrong: t.wrong, missed: t.missed, score: t.score, bestCombo: t.bestCombo, golden: t.golden };
}
