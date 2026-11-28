import { MINI_GAME_RULES, conveyorStep, CONVEYOR_EMPTY_TALLY, type ConveyorRunning, type MiniConveyorBin, type MiniConveyorItem } from '@tubutree/shared-types';

/**
 * Băng Chuyền Xanh cho giao diện (Mini App và web cùng dùng): lịch ra băng tăng tốc dần, món đầu băng, phân loại, món trôi mất. Thời gian
 * tính bằng mili giây kể từ lúc bàn chơi dựng (`now`); app cho món trôi bằng hoạt ảnh CSS theo `spawnAt`/`travelMs` của lịch. Điểm và
 * chuỗi nhân điểm đi qua `conveyorStep` của shared-types, đúng hàm máy chủ dùng để đếm lại bài nộp.
 */
export const CONVEYOR_ROUND_MS = MINI_GAME_RULES.green_conveyor.timeLimitMs;
/** Món đầu ra băng sau chừng này (khách kịp nhìn thấy băng và thùng). */
export const CONVEYOR_LEAD_MS = 500;
/** Khoảng giữa hai món: 1,5 giây lúc đầu, rút dần về 0,8 giây ở cuối ván. */
export const CONVEYOR_INTERVAL_MS = { from: 1_500, to: 800 } as const;
/** Thời gian một món trôi hết băng: 3,2 giây lúc đầu, nhanh dần về 1,7 giây. */
export const CONVEYOR_TRAVEL_MS = { from: 3_200, to: 1_700 } as const;

export interface BeltSlot {
  spawnAt: number;
  travelMs: number;
}

const lerp = (a: number, b: number, p: number) => a + (b - a) * Math.min(1, Math.max(0, p));

/** Lịch của `n` món theo đường tăng tốc. Với 24 món, món cuối ra băng ở khoảng giây 27 và tới thùng trước giây 29,6. */
export function conveyorSchedule(n: number): BeltSlot[] {
  const out: BeltSlot[] = [];
  let t = CONVEYOR_LEAD_MS;
  for (let i = 0; i < n; i++) {
    const p = t / CONVEYOR_ROUND_MS;
    out.push({ spawnAt: Math.round(t), travelMs: Math.round(lerp(CONVEYOR_TRAVEL_MS.from, CONVEYOR_TRAVEL_MS.to, p)) });
    t += lerp(CONVEYOR_INTERVAL_MS.from, CONVEYOR_INTERVAL_MS.to, p);
  }
  return out;
}

export type BeltEventKind = 'right' | 'wrong' | 'miss';

export interface BeltEvent {
  index: number;
  kind: BeltEventKind;
  bin: MiniConveyorBin | null;
  gained: number;
  golden: boolean;
  combo: number;
  at: number;
}

export interface BeltState {
  /** `undefined`: món chưa xử lý; `null`: trôi mất. */
  picks: (MiniConveyorBin | null | undefined)[];
  tally: ConveyorRunning;
  events: BeltEvent[];
}

export function beltStart(n: number): BeltState {
  return { picks: Array.from({ length: n }, () => undefined), tally: CONVEYOR_EMPTY_TALLY, events: [] };
}

/** Món đầu băng: món ra sớm nhất chưa xử lý. */
export function beltFront(s: BeltState, schedule: readonly BeltSlot[], now: number): number | null {
  for (let i = 0; i < s.picks.length; i++) {
    if (s.picks[i] !== undefined) continue;
    return schedule[i] && schedule[i]!.spawnAt <= now ? i : null;
  }
  return null;
}

function resolve(s: BeltState, items: readonly MiniConveyorItem[], index: number, pick: MiniConveyorBin | null, now: number): BeltState {
  const item = items[index]!;
  const step = conveyorStep(s.tally, item, pick);
  const picks = s.picks.slice();
  picks[index] = pick;
  const kind: BeltEventKind = pick === null ? 'miss' : pick === item.bin ? 'right' : 'wrong';
  const { gained, ...tally } = step;
  const event: BeltEvent = { index, kind, bin: pick, gained, golden: item.golden, combo: tally.combo, at: now };
  return { picks, tally, events: [...s.events.slice(-7), event] };
}

/** Bỏ món đầu băng vào `bin`. Chưa có món nào trên băng thì trả lại đúng đối tượng cũ. */
export function beltSort(s: BeltState, items: readonly MiniConveyorItem[], schedule: readonly BeltSlot[], bin: MiniConveyorBin, now: number): BeltState {
  const front = beltFront(s, schedule, now);
  return front === null ? s : resolve(s, items, front, bin, now);
}

/** Món đã chạm thùng mà chưa phân thì tính là trôi mất (theo thứ tự ra băng). Không có gì đổi thì trả lại đúng đối tượng cũ. */
export function beltTick(s: BeltState, items: readonly MiniConveyorItem[], schedule: readonly BeltSlot[], now: number): BeltState {
  let next = s;
  for (let i = 0; i < next.picks.length; i++) {
    if (next.picks[i] !== undefined) continue;
    const slot = schedule[i];
    if (!slot || now < slot.spawnAt + slot.travelMs) break;
    next = resolve(next, items, i, null, slot.spawnAt + slot.travelMs);
  }
  return next;
}

export const beltResolved = (s: BeltState): number => s.picks.filter((p) => p !== undefined).length;

/** Ván xong khi mọi món đã xử lý hoặc hết 30 giây. */
export function beltDone(s: BeltState, now: number): boolean {
  return now >= CONVEYOR_ROUND_MS || s.picks.every((p) => p !== undefined);
}

/** Bài nộp theo thứ tự ra băng; món chưa xử lý lúc hết giờ là trôi mất. */
export function beltAnswers(s: BeltState): (MiniConveyorBin | null)[] {
  return s.picks.map((p) => (p === undefined ? null : p));
}

/** Hướng vuốt sang thùng: trái Tái chế, xuống Hữu cơ, phải Refill (vuốt lên không làm gì). */
export function conveyorSwipeBin(dir: 'u' | 'd' | 'l' | 'r'): MiniConveyorBin | null {
  if (dir === 'l') return 'recycle';
  if (dir === 'd') return 'organic';
  if (dir === 'r') return 'refill';
  return null;
}
