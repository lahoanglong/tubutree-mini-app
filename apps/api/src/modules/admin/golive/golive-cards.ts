import type { CheckResult, CheckStatus } from '../../../config/go-live/types';

/**
 * Bảng kiểm Giờ G (`/admin/gio-g`): gom các dòng của `go-live:check` (src/config/go-live, cùng logic với lệnh chạy trên máy chủ) và các dòng riêng
 * của bảng này vào 6 thẻ. Thứ tự thẻ là thứ tự người vận hành đi qua trước giờ mở bán.
 */
export const COCKPIT_CARD_KEYS = ['infra', 'zalo', 'pancake', 'waste', 'catalog', 'legal'] as const;
export type CockpitCardKey = (typeof COCKPIT_CARD_KEYS)[number];

export const COCKPIT_CARD_TITLES: Record<CockpitCardKey, string> = {
  infra: 'Hạ tầng, DB, Redis và HMAC',
  zalo: 'Zalo Mini App, OA và ZNS',
  pancake: 'Pancake và kho',
  waste: 'Gomdon và Đổi rác',
  catalog: 'Catalog, Refill và câu chuyện',
  legal: 'Pháp lý BCT và tên miền',
};

export interface CockpitMetric {
  label: string;
  value: string;
}

export interface CockpitCard {
  key: CockpitCardKey;
  title: string;
  /** Mức nặng nhất trong các dòng của thẻ. */
  status: CheckStatus;
  counts: Record<CheckStatus, number>;
  metrics: CockpitMetric[];
  /** FAIL trước, rồi WARN, rồi PASS; cùng mức giữ thứ tự của bộ kiểm. */
  rows: CheckResult[];
}

/**
 * Dòng nào vào thẻ nào, theo tiền tố mã dòng (dài nhất thắng). Mã chưa có trong bảng rơi về thẻ hạ tầng, nên một dòng mới của `go-live:check`
 * không bao giờ bị giấu khỏi bảng kiểm.
 */
const PREFIX_TO_CARD: ReadonlyArray<readonly [prefix: string, card: CockpitCardKey]> = [
  ['env.zalo.', 'zalo'],
  ['env.zalopay', 'zalo'],
  ['db.zns_', 'zalo'],
  ['db.miniapp_base_url', 'zalo'],
  ['cockpit.zns.', 'zalo'],
  ['env.pancake.', 'pancake'],
  ['db.shipping_', 'pancake'],
  ['db.cod_cap', 'pancake'],
  ['db.bank_account', 'pancake'],
  ['db.merchant_terms', 'pancake'],
  ['db.settlement_hold', 'pancake'],
  ['db.consignment_from', 'pancake'],
  ['cockpit.pancake.', 'pancake'],
  ['env.gomdon.', 'waste'],
  ['db.gomdon_', 'waste'],
  ['db.waste_', 'waste'],
  ['cockpit.waste.', 'waste'],
  ['db.demo_', 'catalog'],
  ['db.membership_tiers', 'catalog'],
  ['db.dealer_tiers', 'catalog'],
  ['cockpit.catalog.', 'catalog'],
  ['db.legal_', 'legal'],
  ['db.company_', 'legal'],
  ['env.cors', 'legal'],
  ['env.cookie_', 'legal'],
  ['cockpit.legal.', 'legal'],
];

export function cardOf(id: string): CockpitCardKey {
  let best: readonly [string, CockpitCardKey] | undefined;
  for (const entry of PREFIX_TO_CARD) {
    if (id.startsWith(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
  }
  return best?.[1] ?? 'infra';
}

const RANK: Record<CheckStatus, number> = { FAIL: 0, WARN: 1, PASS: 2 };

export function worstStatus(rows: readonly CheckResult[]): CheckStatus {
  return rows.reduce<CheckStatus>((w, r) => (RANK[r.status] < RANK[w] ? r.status : w), 'PASS');
}

export function countStatuses(rows: readonly CheckResult[]): Record<CheckStatus, number> {
  const out: Record<CheckStatus, number> = { PASS: 0, WARN: 0, FAIL: 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}

export function buildCards(results: readonly CheckResult[], metrics: Partial<Record<CockpitCardKey, CockpitMetric[]>> = {}): CockpitCard[] {
  const byCard = new Map<CockpitCardKey, CheckResult[]>(COCKPIT_CARD_KEYS.map((k) => [k, []]));
  for (const r of results) byCard.get(cardOf(r.id))!.push(r);
  return COCKPIT_CARD_KEYS.map((key) => {
    const rows = byCard.get(key)!;
    const sorted = rows.map((r, i) => ({ r, i })).sort((a, b) => RANK[a.r.status] - RANK[b.r.status] || a.i - b.i).map((x) => x.r);
    return { key, title: COCKPIT_CARD_TITLES[key], status: worstStatus(rows), counts: countStatuses(rows), metrics: metrics[key] ?? [], rows: sorted };
  });
}
