import {
  MINI_CONVEYOR_BINS,
  MINI_GAME_RULES,
  arcadeRng,
  conveyorDecode,
  conveyorTally,
  type MiniConveyorArt,
  type MiniConveyorBin,
  type MiniConveyorItem,
} from '@tubutree/shared-types';
import type { MiniGameDef } from './game-def';
import { ARCADE_CONTENT_ID, arcadePayloadError } from './arcade';
import { shuffled } from './random';

interface CatalogItem {
  key: string;
  label: string;
  art: MiniConveyorArt;
  bin: MiniConveyorBin;
}

/**
 * Món của Băng Chuyền Xanh. Refill là vỏ chai, can của Tubu đã dùng hết (mang về nạp lại); chai nhựa, lon, giấy thường là Tái chế. Nhãn
 * ngắn để vừa thẻ trên băng ở 360px.
 */
export const CONVEYOR_CATALOG: readonly CatalogItem[] = [
  { key: 'pet', label: 'Chai nước suối', art: 'pet_bottle', bin: 'recycle' },
  { key: 'can', label: 'Lon nhôm', art: 'can', bin: 'recycle' },
  { key: 'carton', label: 'Thùng carton', art: 'carton', bin: 'recycle' },
  { key: 'paper', label: 'Báo cũ', art: 'newspaper', bin: 'recycle' },
  { key: 'glass', label: 'Hũ thuỷ tinh', art: 'glass_jar', bin: 'recycle' },
  { key: 'banana', label: 'Vỏ chuối', art: 'banana_peel', bin: 'organic' },
  { key: 'coffee', label: 'Bã cà phê', art: 'coffee_grounds', bin: 'organic' },
  { key: 'egg', label: 'Vỏ trứng', art: 'eggshell', bin: 'organic' },
  { key: 'leaf', label: 'Lá khô', art: 'leaf', bin: 'organic' },
  { key: 'apple', label: 'Lõi táo', art: 'apple_core', bin: 'organic' },
  { key: 'dish', label: 'Chai rửa chén Tubu rỗng', art: 'refill_pump', bin: 'refill' },
  { key: 'laundry', label: 'Can nước giặt Tubu rỗng', art: 'refill_jug', bin: 'refill' },
  { key: 'glass-spray', label: 'Bình xịt kính Tubu rỗng', art: 'refill_spray', bin: 'refill' },
  { key: 'shower', label: 'Chai sữa tắm Tubu rỗng', art: 'refill_pump', bin: 'refill' },
  { key: 'floor', label: 'Can lau sàn Tubu rỗng', art: 'refill_jug', bin: 'refill' },
];

const ITEMS = MINI_GAME_RULES.green_conveyor.items;
/** Số món vàng mỗi ván, không rơi vào 4 món đầu (khách còn đang làm quen). */
export const CONVEYOR_GOLDEN_COUNT = 3;
const GOLDEN_FROM = 4;
/** Dòng số riêng của băng chuyền: cùng seed với game khác vẫn ra dãy khác. */
const STREAM_SALT = 0x9e3779b9;

/**
 * Dãy món của một ván, dựng lại được từ `seed`: mỗi thùng đúng 8 món xáo đều, mỗi món chọn trong nhóm của thùng và không lặp món ngay
 * trước, 3 món vàng rải sau món thứ 4.
 */
export function conveyorItems(seed: number): MiniConveyorItem[] {
  const rng = arcadeRng((seed ^ STREAM_SALT) >>> 0);
  const perBin = Math.ceil(ITEMS / MINI_CONVEYOR_BINS.length);
  const bag = shuffled(
    MINI_CONVEYOR_BINS.flatMap((b) => Array.from({ length: perBin }, () => b)),
    rng,
  ).slice(0, ITEMS);
  const golden = new Set(shuffled(Array.from({ length: ITEMS - GOLDEN_FROM }, (_, i) => i + GOLDEN_FROM), rng).slice(0, CONVEYOR_GOLDEN_COUNT));
  let prev: string | null = null;
  return bag.map((bin, i) => {
    const group = CONVEYOR_CATALOG.filter((c) => c.bin === bin && c.key !== prev);
    const pick = group[Math.floor(rng() * group.length)]!;
    prev = pick.key;
    return { id: `${pick.key}-${i}`, label: pick.label, art: pick.art, bin, golden: golden.has(i) };
  });
}

/**
 * Băng Chuyền Xanh: 24 món trôi về 3 thùng trong 30 giây. Món kèm thùng đúng để game chấm ngay; máy chủ dựng lại dãy từ `seed` và tự đếm
 * điểm từ bài nộp (một chuỗi `r/o/f/-`), thưởng kẹp bằng cùng công thức và trần với mọi game mini.
 */
export const greenConveyorGame: MiniGameDef = {
  game: 'green_conveyor',
  payloadError: () => arcadePayloadError('Băng Chuyền Xanh'),
  productSlugs: () => [],
  usable: (row) => row.id === ARCADE_CONTENT_ID.green_conveyor,
  pick: (pool) => {
    const row = pool.find((r) => r.id === ARCADE_CONTENT_ID.green_conveyor);
    return row ? [row] : null;
  },
  build: (_rows, ctx) => ({ game: 'green_conveyor', seed: ctx.arcadeSeed, bins: [...MINI_CONVEYOR_BINS], items: conveyorItems(ctx.arcadeSeed) }),
  parseAnswers(raw) {
    if (raw.length !== 1) return null;
    return conveyorDecode(raw[0], ITEMS);
  },
  grade(_rows, answers, ctx) {
    const items = conveyorItems(ctx.arcadeSeed);
    const t = conveyorTally(items, answers as (MiniConveyorBin | null)[]);
    return {
      correct: t.correct,
      total: items.length,
      correctIds: [],
      review: { game: 'green_conveyor', score: t.score, bestCombo: t.bestCombo, golden: t.golden, missed: t.missed },
    };
  },
};
