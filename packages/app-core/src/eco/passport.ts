import type { HttpClient } from '../http';
import { ecoGrams } from './facts';
import { passportCopy, type PassportCopyKey } from './passport-copy';

export type EcoStampId = 'first_order' | 'plastic_1kg' | 'refill_5' | 'waste_3' | 'tree_1';
const STAMP_IDS: readonly EcoStampId[] = ['first_order', 'plastic_1kg', 'refill_5', 'waste_3', 'tree_1'];

/** `GET /me/eco-passport` (cùng dạng với `EcoPassport` ở `apps/api/src/modules/eco-impact/eco-passport.compute.ts`). Cờ tắt: 404. */
export interface EcoPassport {
  firstOrderAt: string | null;
  plasticAvoidedGrams: number;
  refillPacks: number;
  wasteReturned: { requests: number; grams: number; unitsWithoutWeight: number };
  trees: { pledged: number; planted: number };
  co2Grams: number | null;
  monthly: { month: string; actions: number }[];
  stamps: { id: EcoStampId; reached: boolean }[];
}

export const ECO_PASSPORT_QUERY_KEY = ['eco-passport'] as const;

const count = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const bad = (): never => {
  throw new Error('Phản hồi /me/eco-passport không đúng dạng');
};

/** Body lạ thì ném lỗi (màn hiện lỗi, lối vào ẩn), không đoán số. */
export function parseEcoPassport(body: unknown): EcoPassport {
  const b = body as Partial<EcoPassport> | null | undefined;
  if (!b || typeof b !== 'object') return bad();
  const w = b.wasteReturned;
  const t = b.trees;
  if (
    !(b.firstOrderAt === null || typeof b.firstOrderAt === 'string') ||
    !count(b.plasticAvoidedGrams) ||
    !count(b.refillPacks) ||
    !w || !count(w.requests) || !count(w.grams) || !count(w.unitsWithoutWeight) ||
    !t || !count(t.pledged) || !count(t.planted) ||
    !(b.co2Grams === null || count(b.co2Grams)) ||
    !Array.isArray(b.monthly) || !b.monthly.every((m) => m && typeof m.month === 'string' && /^\d{4}-\d{2}$/.test(m.month) && count(m.actions)) ||
    !Array.isArray(b.stamps)
  ) {
    return bad();
  }
  return {
    firstOrderAt: b.firstOrderAt ?? null,
    plasticAvoidedGrams: b.plasticAvoidedGrams,
    refillPacks: b.refillPacks,
    wasteReturned: { requests: w.requests, grams: w.grams, unitsWithoutWeight: w.unitsWithoutWeight },
    trees: { pledged: t.pledged, planted: t.planted },
    co2Grams: b.co2Grams ?? null,
    monthly: b.monthly.map((m) => ({ month: m.month, actions: m.actions })),
    stamps: STAMP_IDS.map((id) => ({ id, reached: b.stamps!.some((s) => s && s.id === id && s.reached === true) })),
  };
}

export const getEcoPassport = async (http: HttpClient): Promise<EcoPassport> => parseEcoPassport(await http.get<unknown>('/me/eco-passport'));

/** Đệm máy chủ 5 phút theo khách, nên app không hỏi lại trong 5 phút; lỗi (gồm 404 khi cờ tắt) không thử lại. */
export const ecoPassportQuery = (http: HttpClient) => ({
  queryKey: ECO_PASSPORT_QUERY_KEY,
  queryFn: () => getEcoPassport(http),
  staleTime: 5 * 60_000,
  retry: false,
});

export type PassportMetric = 'plastic' | 'refill' | 'waste' | 'trees' | 'co2';

export interface PassportTile {
  metric: PassportMetric;
  value: string;
  label: string;
  sub: string | null;
}

export interface PassportBar {
  month: string;
  label: string;
  value: number;
  /** Chiều cao cột theo phần trăm của tháng cao nhất (0–100). */
  pct: number;
}

export interface PassportView {
  /** Khách chưa có đơn giao và chưa có số nào: màn hiện câu rỗng + nút "Xem món refill". */
  empty: boolean;
  since: string | null;
  tiles: PassportTile[];
  /** "Chưa có: can refill, cây" — các chỉ số bằng 0 gộp một dòng; null khi không có chỉ số nào bằng 0. */
  none: string | null;
  /** null khi cả 6 tháng đều 0 (không vẽ biểu đồ trống). */
  bars: PassportBar[] | null;
  stamps: { id: EcoStampId; label: string; reached: boolean }[];
  /** Dòng "Cách tính": chỉ các nguồn của số đang hiện, cộng câu ghi chú. */
  how: string[];
}

const VN_OFFSET_MS = 7 * 3_600_000;
const vnDate = (iso: string): string | null => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + VN_OFFSET_MS);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};
const num = (n: number): string => n.toLocaleString('vi-VN');

export function passportView(p: EcoPassport): PassportView {
  const tiles: PassportTile[] = [];
  const none: string[] = [];
  const how: string[] = [];
  const add = (metric: PassportMetric, on: boolean, value: () => string, label: PassportCopyKey, sub: string | null = null) => {
    if (!on) {
      if (metric !== 'co2') none.push(passportCopy(`none.${metric}` as PassportCopyKey));
      return;
    }
    tiles.push({ metric, value: value(), label: passportCopy(label), sub });
    how.push(passportCopy(`how.${metric}` as PassportCopyKey));
  };
  const plastic = ecoGrams(p.plasticAvoidedGrams);
  add('plastic', plastic !== null, () => plastic!, 'tile.plastic');
  add('refill', p.refillPacks > 0, () => num(p.refillPacks), 'tile.refill');
  const wasteW = ecoGrams(p.wasteReturned.grams);
  add('waste', p.wasteReturned.requests > 0, () => num(p.wasteReturned.requests), 'tile.waste', wasteW ? passportCopy('tile.wasteSub', { w: wasteW }) : null);
  add('trees', p.trees.pledged > 0, () => num(p.trees.pledged), 'tile.trees', p.trees.planted > 0 ? passportCopy('tile.treesSub', { n: num(p.trees.planted) }) : null);
  const co2 = p.co2Grams === null ? null : ecoGrams(p.co2Grams);
  add('co2', co2 !== null, () => co2!, 'tile.co2');
  how.push(passportCopy('how.note'));

  const max = Math.max(0, ...p.monthly.map((m) => m.actions));
  const bars =
    max > 0
      ? p.monthly.map((m) => ({ month: m.month, label: passportCopy('chartMonth', { m: Number(m.month.slice(5)) }), value: m.actions, pct: Math.round((m.actions / max) * 100) }))
      : null;

  const since = p.firstOrderAt ? vnDate(p.firstOrderAt) : null;
  return {
    empty: p.firstOrderAt === null && tiles.length === 0,
    since: since ? passportCopy('since', { d: since }) : null,
    tiles,
    none: none.length > 0 && tiles.length > 0 ? passportCopy('none', { list: none.join(', ') }) : null,
    bars,
    stamps: p.stamps.map((s) => ({ id: s.id, label: passportCopy(`stamp.${s.id}` as PassportCopyKey), reached: s.reached })),
    how,
  };
}

/** Câu chia sẻ chỉ từ số thật (không tên, không số điện thoại); null khi chưa có số nào để kể. */
export function passportShareText(p: EcoPassport): string | null {
  const parts: string[] = [];
  const g = ecoGrams(p.plasticAvoidedGrams);
  if (g) parts.push(passportCopy('part.plastic', { g }));
  if (p.refillPacks > 0) parts.push(passportCopy('part.refill', { n: num(p.refillPacks) }));
  if (p.wasteReturned.requests > 0) parts.push(passportCopy('part.waste', { n: num(p.wasteReturned.requests) }));
  if (p.trees.pledged > 0) parts.push(passportCopy('part.trees', { n: num(p.trees.pledged) }));
  return parts.length > 0 ? passportCopy('shareText', { parts: parts.join(', ') }) : null;
}
