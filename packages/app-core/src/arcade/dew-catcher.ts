import { ARCADE_NOMINAL_MS } from './arcade-config';

export type DewKind = 'dew' | 'berry' | 'oil' | 'chem' | 'dust';
export const DEW_ITEMS: Record<DewKind, { emoji: string; label: string; points: number; hazard: boolean }> = {
  dew: { emoji: '💧', label: 'Giọt Sương Mai', points: 10, hazard: false },
  berry: { emoji: '🌰', label: 'Quả Bồ Hòn Hữu Cơ', points: 25, hazard: false },
  oil: { emoji: '🌿', label: 'Tinh Dầu Tràm Trà', points: 30, hazard: false },
  chem: { emoji: '🧪', label: 'Giọt Hoá Chất Tẩy Mạnh (SLS/Paraben)', points: 0, hazard: true },
  dust: { emoji: '💨', label: 'Bụi Mịn', points: 0, hazard: true },
};
export const DEW_DURATION_MS = ARCADE_NOMINAL_MS.dew_catcher;
export const DEW_HEARTS = 3;
export const DEW_MAGNET_MS = 4_000;
export const DEW_PADDLE_W = 0.22;
export const DEW_CATCH_Y = 0.86;
export const DEW_MIN_SPAWN_MS = 400;
export const DEW_MIN_DX = 0.14;
const REACH = DEW_PADDLE_W / 2 + 0.04;

export const dewMultiplier = (combo: number): number => (combo >= 25 ? 5 : combo >= 12 ? 3 : combo >= 5 ? 2 : 1);

export interface DewItem { id: number; kind: DewKind; x: number; y: number }
export interface DewEvent { type: 'catch' | 'hit' | 'dodge'; x: number; points: number; mult: number }
export interface DewCatcherStats { score: number; maxCombo: number; dewCaught: number; dodgedHazards: number; heartsLeft: number; endedBy: 'time' | 'hearts'; durationMs: number }
export interface DewCatcherState { timeLeftMs: number; score: number; hearts: number; combo: number; multiplier: number; maxCombo: number; magnetMs: number; paddleX: number; paddleW: number; items: DewItem[]; events: DewEvent[]; over: boolean }

// Combo gãy khi chạm vật độc hoặc để rơi vật tốt.
export function createDewCatcher({ rng = Math.random, durationMs = DEW_DURATION_MS }: { rng?: () => number; durationMs?: number } = {}) {
  let id = 0, elapsed = 0, spawnIn = 500, paddleX = 0.5, lastX = 0.5, magnetMs = 0, combo = 0, maxCombo = 0, spawned = 0, hazards = 0, run = 0, score = 0, hearts = DEW_HEARTS, caught = 0, dodged = 0, value = 0;
  let endedBy: 'time' | 'hearts' | null = null;
  let items: DewItem[] = [];
  let events: DewEvent[] = [];

  const spawn = () => {
    // Vật độc tối đa 25% số vật đã rơi, không quá 2 liền.
    const hazard = rng() < 0.25 && run < 2 && (hazards + 1) * 4 <= spawned + 1;
    const r = rng();
    let kind: DewKind = hazard ? (r < 0.5 ? 'chem' : 'dust') : r < 0.7 ? 'dew' : r < 0.9 ? 'berry' : 'oil';
    // Điểm gốc trung bình mỗi vật tối đa 15 (dư 30 cho vài vật đầu): điểm lý thuyết dưới trần của máy chủ dù rng đòi toàn tinh dầu.
    if (value + DEW_ITEMS[kind].points > 15 * spawned + 45) kind = 'dew';
    value += DEW_ITEMS[kind].points;
    let x = 0.08 + rng() * 0.84;
    if (Math.abs(x - lastX) < DEW_MIN_DX) {
      x = x >= lastX ? lastX + DEW_MIN_DX : lastX - DEW_MIN_DX;
      if (x > 0.92 || x < 0.08) x = 2 * lastX - x;
    }
    lastX = x;
    spawned++;
    hazards += hazard ? 1 : 0;
    run = hazard ? run + 1 : 0;
    items.push({ id: id++, kind, x, y: -0.05 });
  };

  const resolve = (it: DewItem): boolean => {
    const def = DEW_ITEMS[it.kind];
    const inReach = Math.abs(it.x - paddleX) <= REACH;
    if (def.hazard) {
      events.push({ type: inReach ? 'hit' : 'dodge', x: it.x, points: 0, mult: 1 });
      if (inReach) {
        hearts--;
        combo = 0;
      } else dodged++;
      return inReach;
    }
    if (!inReach) {
      combo = 0;
      return false;
    }
    const mult = dewMultiplier(combo);
    const points = def.points * mult;
    score += points;
    maxCombo = Math.max(maxCombo, ++combo);
    caught++;
    if (it.kind === 'oil') magnetMs = DEW_MAGNET_MS;
    events.push({ type: 'catch', x: it.x, points, mult });
    return true;
  };

  const tick = (dt: number) => {
    const p = Math.min(1, elapsed / DEW_DURATION_MS);
    const left = durationMs - elapsed;
    const d = Math.min(dt, left);
    elapsed = d === left ? durationMs : elapsed + d;
    magnetMs = Math.max(0, magnetMs - d);
    if ((spawnIn -= d) <= 0) {
      spawn();
      spawnIn += Math.max(DEW_MIN_SPAWN_MS, 800 - 400 * p);
    }
    items = items.filter((it) => {
      const prev = it.y;
      it.y += ((0.5 + 0.55 * p) * d) / 1000;
      if (magnetMs > 0 && it.kind === 'dew') it.x += (paddleX - it.x) * Math.min(1, (6 * d) / 1000);
      return !(prev < DEW_CATCH_Y && it.y >= DEW_CATCH_Y && resolve(it)) && it.y < 1.08;
    });
    endedBy = hearts <= 0 ? 'hearts' : elapsed >= durationMs ? 'time' : null;
  };

  return {
    step(dtMs: number) {
      events = [];
      for (let left = dtMs > 0 ? dtMs : 0; left > 0 && !endedBy; left -= 25) tick(Math.min(25, left));
    },
    setPaddleX(x01: number) {
      if (Number.isFinite(x01)) paddleX = Math.min(1 - DEW_PADDLE_W / 2, Math.max(DEW_PADDLE_W / 2, x01));
    },
    state(): DewCatcherState {
      return { timeLeftMs: durationMs - elapsed, score, hearts, combo, multiplier: dewMultiplier(combo), maxCombo, magnetMs, paddleX, paddleW: DEW_PADDLE_W, items: items.map((i) => ({ ...i })), events: events.slice(), over: endedBy !== null };
    },
    stats(): DewCatcherStats | null {
      return endedBy && { score, maxCombo, dewCaught: caught, dodgedHazards: dodged, heartsLeft: hearts, endedBy, durationMs: Math.round(elapsed) };
    },
  };
}
