import { createHash } from 'node:crypto';
import { maskClaimCode } from './external-points-rate';
import type { OrderSourceMap } from './external-order.config';
import { buyerPhonePattern, classifyPancakeOrder, externalStatusOf, extractTrackingCodes, marketplaceOrderSn, normalizeTrackingCode } from './external-order.mapper';
import { parseOrderPhoneForMatch, visibleDigits } from './order-phone-match';

/**
 * Lõi của `scripts/pancake-marketplace-probe.ts` (W44, chỉ GET): đếm trên đơn sàn thật của Pancake trường nào mang mã (mã vận đơn, mã đơn
 * sàn) và trường SĐT nào mang số ở dạng nào, theo nhóm trạng thái, rồi thử tra lại bằng `search` theo đúng vị từ của lookup. Mục đích: biết
 * Lazada (và Shopee, TikTok) có tích điểm được không trước khi đổi mapper.
 *
 * Chỉ import hàm đã có trên image API đang chạy, để bản dò gắn `:ro` vào container tạm chạy được trước deploy.
 *
 * Không bao giờ trả ra: chữ số SĐT, tên, địa chỉ, giá trị mã (mã chỉ hiện 3 ký tự đầu và cuối như `maskClaimCode`). SĐT đầy đủ chỉ được
 * băm sha256 trong bộ nhớ để đếm số khác nhau; băm cũng không in.
 */

type Data = Record<string, unknown>;

export type StatusBucket = 'DELIVERED' | 'SHIPPED' | 'OPEN' | 'CLOSED';
export const STATUS_BUCKETS: readonly StatusBucket[] = ['DELIVERED', 'SHIPPED', 'OPEN', 'CLOSED'];
const CLOSED_STATUSES: readonly number[] = [4, 5, 6, 7, 15];

/** DELIVERED (3, 16), SHIPPED (2), CLOSED (4, 5, 6, 7, 15), còn lại OPEN. */
export function statusBucketOf(data: Data): StatusBucket {
  const { pancakeStatus } = externalStatusOf(data);
  if (pancakeStatus === 3 || pancakeStatus === 16) return 'DELIVERED';
  if (pancakeStatus === 2) return 'SHIPPED';
  if (pancakeStatus !== null && CLOSED_STATUSES.includes(pancakeStatus)) return 'CLOSED';
  return 'OPEN';
}

/** Nhóm khách quét mã được (đã nhận hoặc đang giao): mọi tỉ lệ kết luận chỉ tính trên nhóm này. */
export const isClaimBucket = (b: StatusBucket): boolean => b === 'DELIVERED' || b === 'SHIPPED';

const emptyBuckets = (): Record<StatusBucket, number> => ({ DELIVERED: 0, SHIPPED: 0, OPEN: 0, CLOSED: 0 });
const round2 = (n: number): number => Math.round(n * 100) / 100;
const rate = (n: number, d: number): number | null => (d > 0 ? round2(n / d) : null);

export const CENSUS_MAX_DEPTH = 3;
/** Mảng dài (items, status_history…) chỉ xem vài phần tử đầu: đủ để biết đường dẫn, không phình bộ nhớ. */
const CENSUS_MAX_ARRAY = 20;

interface Leaf {
  path: string;
  value: unknown;
}

/** Khoá có từ 4 chữ số trở lên (id làm khoá) gộp thành `#` để đường dẫn không mang số và các đơn gộp chung một dòng. */
const pathSegment = (key: string): string => ((key.match(/\d/g)?.length ?? 0) >= 4 ? '#' : key);

/** Mọi lá (không phải object hay mảng) trong payload, đi sâu tối đa CENSUS_MAX_DEPTH tầng object. Chỉ số mảng gộp thành `[]`. */
export function payloadLeaves(data: Data): Leaf[] {
  const out: Leaf[] = [];
  const visit = (v: unknown, path: string, depth: number): void => {
    if (Array.isArray(v)) {
      for (const x of v.slice(0, CENSUS_MAX_ARRAY)) visit(x, `${path}[]`, depth);
      return;
    }
    if (v !== null && typeof v === 'object') {
      if (depth >= CENSUS_MAX_DEPTH) return;
      for (const [k, child] of Object.entries(v as Data)) visit(child, path ? `${path}.${pathSegment(k)}` : pathSegment(k), depth + 1);
      return;
    }
    if (path) out.push({ path, value: v });
  };
  visit(data, '', 0);
  return out;
}

/**
 * Giá trị dạng mã: chuẩn hoá được bằng `normalizeTrackingCode`, chuỗi gốc không có khoảng trắng (không phải chữ tự do) và không giống SĐT.
 * Trả mã đã chuẩn hoá hoặc null.
 */
export function codeLikeValue(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = String(raw).trim();
  if (/\s/.test(text)) return null;
  const code = normalizeTrackingCode(text);
  if (!code) return null;
  return parseOrderPhoneForMatch(text).kind === 'NONE' ? code : null;
}

/** Hình dạng mã: cụm chữ `A<n>`, cụm số `D<n>` (vd `A5D10A1`). Không mang giá trị. */
export const codeShape = (code: string): string => code.replace(/[A-Z]+|[0-9]+/g, (m) => `${/\d/.test(m) ? 'D' : 'A'}${m.length}`);

/** 3 ký tự đầu khi là chữ (tiền tố hãng như SPX, LEX); mã bắt đầu bằng số thì null. */
export const codePrefix = (code: string): string | null => (/^[A-Z]{3}/.test(code) ? code.slice(0, 3) : null);

/** Các mã (đã chuẩn hoá, không trùng) ở đúng đường dẫn `path` của đơn. */
export function codesAtPath(data: Data, path: string): string[] {
  const codes: string[] = [];
  for (const leaf of payloadLeaves(data)) {
    if (leaf.path !== path) continue;
    const code = codeLikeValue(leaf.value);
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

/** 5 đường dẫn `extractTrackingCodes` đang đọc: luôn có dòng trong bảng, kể cả khi 0%. */
export const EXTRACTED_CODE_PATHS: readonly string[] = [
  'partner.extend_code',
  'partner.extend_update[].tracking_id',
  'order_number_vtp',
  'invoice_info_list[].order_sn',
  'tracking_number',
];

export type PhoneFieldClass = 'FULL' | 'MASK_LEAD_TAIL' | 'MASK_TAIL_ONLY' | 'MASK_UNPARSED' | 'TEXT' | 'EMPTY';
export type PhonePrefixClass = '0' | '84' | '+84' | '0084' | '*' | 'other';
const PHONE_FIELD_CLASSES: readonly PhoneFieldClass[] = ['FULL', 'MASK_LEAD_TAIL', 'MASK_TAIL_ONLY', 'MASK_UNPARSED', 'TEXT', 'EMPTY'];
const MASK_CHAR_RE = /[*xX•●]/;
const compactPhone = (raw: unknown): string =>
  typeof raw === 'string' || typeof raw === 'number' ? String(raw).replace(/[\s.\-()]/g, '') : '';

/**
 * Dạng của một trường SĐT. MASK_UNPARSED: chuỗi chỉ gồm số, `+` và ký tự che mà `parseOrderPhoneForMatch` không đọc được (dấu hiệu cần mở
 * rộng bộ đọc). TEXT: có chữ hoặc ký tự lạ. EMPTY: null, vắng hoặc rỗng.
 */
export function phoneFieldClassOf(raw: unknown): PhoneFieldClass {
  if (raw === null || raw === undefined) return 'EMPTY';
  if (typeof raw !== 'string' && typeof raw !== 'number') return 'TEXT';
  const s = compactPhone(raw);
  if (!s) return 'EMPTY';
  const p = parseOrderPhoneForMatch(String(raw));
  if (p.kind === 'FULL') return 'FULL';
  if (p.kind === 'MASK') return p.lead ? 'MASK_LEAD_TAIL' : 'MASK_TAIL_ONLY';
  return MASK_CHAR_RE.test(s) && /^[0-9+*xX•●]+$/.test(s) ? 'MASK_UNPARSED' : 'TEXT';
}

export function phonePrefixClassOf(raw: unknown): PhonePrefixClass | null {
  const s = compactPhone(raw);
  if (!s) return null;
  if (s.startsWith('+84')) return '+84';
  if (s.startsWith('0084')) return '0084';
  if (s.startsWith('84')) return '84';
  if (s.startsWith('0')) return '0';
  if (MASK_CHAR_RE.test(s[0]!)) return '*';
  return 'other';
}

/** Khuôn của chuỗi che không đọc được: chữ số thay bằng `d`, ký tự che thành `*` (vd `dddd*****ddd`). Không mang chữ số nào. */
export const maskForm = (raw: unknown): string => compactPhone(raw).replace(/\d/g, 'd').replace(/[xX•●]/g, '*').slice(0, 20);

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Hai đường dẫn `buyerPhonePattern` đang đọc. */
export const BUYER_PHONE_PATHS: readonly string[] = ['bill_phone_number', 'shipping_address.phone_number'];

export interface CodePathRow {
  path: string;
  /** Tỉ lệ đơn có giá trị dạng mã ở đường dẫn này, theo nhóm trạng thái (null: nhóm không có đơn). */
  coverage: Record<StatusBucket, number | null>;
  coverageClaim: number | null;
  /** Tối đa 2 hình dạng hay gặp nhất, kèm số đơn. */
  shapes: string[];
  prefixes: string[];
  /** Số giá trị khác nhau / số đơn có giá trị. < 1 là có đơn dùng chung mã. */
  distinctRatio: number | null;
  /** Tỉ lệ đơn có giá trị mà giá trị đó đã nằm trong `extractTrackingCodes`. */
  inExtractRatio: number | null;
}

export interface PhonePathRow {
  path: string;
  present: number;
  classes: Record<PhoneFieldClass, number>;
  prefixes: Partial<Record<PhonePrefixClass, number>>;
  /** Số chữ số nhìn thấy: nhỏ nhất, lớn nhất (trên đơn có số). */
  digitsMin: number | null;
  digitsMax: number | null;
  /** Số FULL khác nhau / số đơn có FULL (đếm bằng sha256 trong bộ nhớ). */
  fullDistinctRatio: number | null;
  /** Khuôn của MASK_UNPARSED (không chữ số), tối đa 3. */
  unparsedForms: string[];
  /** Ở các đơn mà SĐT người mua (2 đường dẫn đang đọc) che hoặc NONE: tỉ lệ đơn mà đường dẫn này nhìn thấy nhiều chữ số hơn. */
  betterDigitsRate: number | null;
}

export type BuyerShape = 'FULL' | 'MASK_LEAD_TAIL' | 'MASK_TAIL_ONLY' | 'NONE';

export interface SearchCheck {
  /** Đơn tra thử (nhóm DELIVERED/SHIPPED), đã che. */
  maskedTracking: string | null;
  maskedOrderSn: string | null;
  bucket: StatusBucket;
  /** null: đơn không có mã loại này. true: `search` trả ít nhất một đơn mang đúng mã (vị từ của lookup). */
  trackingHit: boolean | null;
  orderSnHit: boolean | null;
  /** Đường dẫn mã mới → kết quả tra bằng giá trị ở đường dẫn đó (vị từ: đơn trả về mang đúng mã ở cùng đường dẫn). */
  candidateHits: Record<string, boolean | null>;
  /** Đơn trả về có đúng id của đơn đang tra (chỉ để tham khảo, kết luận không dựa vào id). */
  sameOrder: boolean;
}

export interface ChannelCensus {
  channel: string;
  fetched: Record<StatusBucket, number>;
  sample: Record<StatusBucket, number>;
  /** Trên nhóm DELIVERED+SHIPPED của mẫu. */
  claimSample: number;
  trackingRate: number | null;
  orderSnRate: number | null;
  anyCodeRate: number | null;
  buyerShapes: Record<BuyerShape, number>;
  buyerFullDistinctRatio: number | null;
  claimableRate: number | null;
  codePaths: CodePathRow[];
  phonePaths: PhonePathRow[];
  /** Đường dẫn mã mới đủ điều kiện thử tra lại (≥ 80% nhóm nhận, không trùng, chưa nằm trong extract). */
  candidatePaths: string[];
  searches: SearchCheck[];
  lookupRate: number | null;
  lookupReady: boolean;
  /** Tỉ lệ số FULL khác nhau < 0,5 trên ≥ 5 đơn: nghi số trung gian dùng chung. */
  relaySuspect: boolean;
}

export const LOOKUP_READY_MIN_RATE = 0.8;
export const CANDIDATE_MIN_COVERAGE = 0.8;
export const RELAY_DISTINCT_MAX = 0.5;
const RELAY_MIN_FULL = 5;
const MAX_CODE_ROWS = 15;
const MAX_CANDIDATES = 5;

export interface FetchedChannel {
  channel: string;
  /** Đơn sàn đúng kênh đã kéo (không trùng id), mọi trạng thái. */
  orders: readonly Data[];
}

/** Đơn sàn đúng kênh `channel` theo `pancake.order_source_map`. */
export function channelOrders(orders: readonly Data[], channel: string, map: OrderSourceMap): Data[] {
  return orders.filter((o) => {
    const c = classifyPancakeOrder(o, map);
    return c.kind === 'MARKETPLACE' && c.channel === channel;
  });
}

/** Mẫu tối đa `perChannel` đơn, ưu tiên DELIVERED rồi SHIPPED rồi OPEN rồi CLOSED (giữ thứ tự Pancake trong cùng nhóm). */
export function pickCensusSample(orders: readonly Data[], perChannel: number): Data[] {
  const rank = (o: Data): number => STATUS_BUCKETS.indexOf(statusBucketOf(o));
  return orders
    .map((o, i) => ({ o, i, r: rank(o) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, Math.max(0, perChannel))
    .map((x) => x.o);
}

const topKeys = (m: Map<string, number>, n: number): string[] =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([k, c]) => `${k}×${c}`);

const bump = (m: Map<string, number>, k: string): void => {
  m.set(k, (m.get(k) ?? 0) + 1);
};

interface CodeAcc {
  present: Record<StatusBucket, number>;
  shapes: Map<string, number>;
  prefixes: Map<string, number>;
  values: Map<string, number>;
  inExtract: number;
  orders: number;
}

interface PhoneAcc {
  present: number;
  classes: Record<PhoneFieldClass, number>;
  prefixes: Partial<Record<PhonePrefixClass, number>>;
  digits: number[];
  fullHashes: Set<string>;
  full: number;
  unparsed: Map<string, number>;
  better: number;
}

const newPhoneAcc = (): PhoneAcc => ({
  present: 0,
  classes: { FULL: 0, MASK_LEAD_TAIL: 0, MASK_TAIL_ONLY: 0, MASK_UNPARSED: 0, TEXT: 0, EMPTY: 0 },
  prefixes: {},
  digits: [],
  fullHashes: new Set(),
  full: 0,
  unparsed: new Map(),
  better: 0,
});

const buyerShapeOf = (data: Data): BuyerShape => {
  const p = buyerPhonePattern(data);
  if (p.kind === 'FULL') return 'FULL';
  if (p.kind === 'NONE') return 'NONE';
  return p.lead ? 'MASK_LEAD_TAIL' : 'MASK_TAIL_ONLY';
};

/** Mã vận đơn (mã đầu trong extract mà không phải mã đơn sàn) của đơn; null khi không có. */
export const trackingCodeOf = (data: Data): string | null => {
  const sn = marketplaceOrderSn(data);
  return extractTrackingCodes(data).find((c) => c !== sn) ?? null;
};

/** Đếm trường mã và trường SĐT của một kênh. Phần tra lại (`searches`, `lookupRate`) điền sau bằng `runSearchChecks`. */
export function censusChannel(fetched: FetchedChannel, perChannel: number): ChannelCensus {
  const fetchedBuckets = emptyBuckets();
  for (const o of fetched.orders) fetchedBuckets[statusBucketOf(o)]++;
  const sample = pickCensusSample(fetched.orders, perChannel);
  const sampleBuckets = emptyBuckets();
  const codeAcc = new Map<string, CodeAcc>();
  const phoneAcc = new Map<string, PhoneAcc>();
  const buyerShapes: Record<BuyerShape, number> = { FULL: 0, MASK_LEAD_TAIL: 0, MASK_TAIL_ONLY: 0, NONE: 0 };
  const buyerFullHashes = new Set<string>();
  let claimSample = 0;
  let tracking = 0;
  let orderSn = 0;
  let anyCode = 0;
  let claimable = 0;
  let weakBuyer = 0;

  for (const data of sample) {
    const bucket = statusBucketOf(data);
    sampleBuckets[bucket]++;
    const extracted = extractTrackingCodes(data);
    const buyer = buyerPhonePattern(data);
    if (isClaimBucket(bucket)) {
      claimSample++;
      if (trackingCodeOf(data)) tracking++;
      if (marketplaceOrderSn(data)) orderSn++;
      if (extracted.length > 0) anyCode++;
      if (extracted.length > 0 && buyer.kind !== 'NONE') claimable++;
      buyerShapes[buyerShapeOf(data)]++;
      if (buyer.kind === 'FULL') buyerFullHashes.add(sha256(buyer.phone));
    }
    const weak = buyer.kind !== 'FULL';
    if (weak) weakBuyer++;

    const seenCode = new Set<string>();
    const seenPhone = new Set<string>();
    for (const leaf of payloadLeaves(data)) {
      if (/phone/i.test(leaf.path)) {
        if (seenPhone.has(leaf.path)) continue;
        seenPhone.add(leaf.path);
        const acc = phoneAcc.get(leaf.path) ?? newPhoneAcc();
        phoneAcc.set(leaf.path, acc);
        acc.present++;
        const cls = phoneFieldClassOf(leaf.value);
        acc.classes[cls]++;
        const prefix = phonePrefixClassOf(leaf.value);
        if (prefix) acc.prefixes[prefix] = (acc.prefixes[prefix] ?? 0) + 1;
        const digits = compactPhone(leaf.value).match(/\d/g)?.length ?? 0;
        if (digits > 0) acc.digits.push(digits);
        const parsed = parseOrderPhoneForMatch(typeof leaf.value === 'number' ? String(leaf.value) : leaf.value);
        if (parsed.kind === 'FULL') {
          acc.full++;
          acc.fullHashes.add(sha256(parsed.phone));
        }
        if (cls === 'MASK_UNPARSED') bump(acc.unparsed, maskForm(leaf.value));
        if (weak && !BUYER_PHONE_PATHS.includes(leaf.path) && visibleDigits(parsed) > visibleDigits(buyer)) acc.better++;
        continue;
      }
      const code = codeLikeValue(leaf.value);
      if (!code || seenCode.has(leaf.path)) continue;
      seenCode.add(leaf.path);
      const acc = codeAcc.get(leaf.path) ?? { present: emptyBuckets(), shapes: new Map(), prefixes: new Map(), values: new Map(), inExtract: 0, orders: 0 };
      codeAcc.set(leaf.path, acc);
      acc.orders++;
      acc.present[bucket]++;
      bump(acc.shapes, codeShape(code));
      const prefix = codePrefix(code);
      if (prefix) bump(acc.prefixes, prefix);
      bump(acc.values, code);
      if (extracted.includes(code)) acc.inExtract++;
    }
  }

  const coverageOf = (present: Record<StatusBucket, number>): Record<StatusBucket, number | null> => {
    const out = {} as Record<StatusBucket, number | null>;
    for (const b of STATUS_BUCKETS) out[b] = rate(present[b], sampleBuckets[b]);
    return out;
  };
  const rows: CodePathRow[] = [...codeAcc.entries()].map(([path, a]) => ({
    path,
    coverage: coverageOf(a.present),
    coverageClaim: rate(a.present.DELIVERED + a.present.SHIPPED, claimSample),
    shapes: topKeys(a.shapes, 2),
    prefixes: topKeys(a.prefixes, 2),
    distinctRatio: rate(a.values.size, a.orders),
    inExtractRatio: rate(a.inExtract, a.orders),
  }));
  for (const path of EXTRACTED_CODE_PATHS) {
    if (!codeAcc.has(path)) {
      rows.push({ path, coverage: coverageOf(emptyBuckets()), coverageClaim: rate(0, claimSample), shapes: [], prefixes: [], distinctRatio: null, inExtractRatio: null });
    }
  }
  const known = new Set(EXTRACTED_CODE_PATHS);
  const others = rows
    .filter((r) => !known.has(r.path))
    .sort((a, b) => (b.coverageClaim ?? 0) - (a.coverageClaim ?? 0) || a.path.localeCompare(b.path));
  const codePaths = [...EXTRACTED_CODE_PATHS.map((p) => rows.find((r) => r.path === p)!), ...others.slice(0, MAX_CODE_ROWS)];
  const candidatePaths = others
    .filter((r) => (r.coverageClaim ?? 0) >= CANDIDATE_MIN_COVERAGE && r.distinctRatio === 1 && (r.inExtractRatio ?? 0) < 1)
    .slice(0, MAX_CANDIDATES)
    .map((r) => r.path);

  const phonePaths: PhonePathRow[] = [...phoneAcc.entries()]
    .map(([path, a]) => ({
      path,
      present: a.present,
      classes: a.classes,
      prefixes: a.prefixes,
      digitsMin: a.digits.length ? Math.min(...a.digits) : null,
      digitsMax: a.digits.length ? Math.max(...a.digits) : null,
      fullDistinctRatio: rate(a.fullHashes.size, a.full),
      unparsedForms: topKeys(a.unparsed, 3),
      betterDigitsRate: BUYER_PHONE_PATHS.includes(path) ? null : rate(a.better, weakBuyer),
    }))
    .sort((a, b) => b.present - a.present || a.path.localeCompare(b.path));

  const buyerFullDistinctRatio = rate(buyerFullHashes.size, buyerShapes.FULL);
  return {
    channel: fetched.channel,
    fetched: fetchedBuckets,
    sample: sampleBuckets,
    claimSample,
    trackingRate: rate(tracking, claimSample),
    orderSnRate: rate(orderSn, claimSample),
    anyCodeRate: rate(anyCode, claimSample),
    buyerShapes,
    buyerFullDistinctRatio,
    claimableRate: rate(claimable, claimSample),
    codePaths,
    phonePaths,
    candidatePaths,
    searches: [],
    lookupRate: null,
    lookupReady: false,
    relaySuspect: buyerShapes.FULL >= RELAY_MIN_FULL && buyerFullDistinctRatio !== null && buyerFullDistinctRatio < RELAY_DISTINCT_MAX,
  };
}

/** Đơn mang đúng mã `code` theo vị từ mà lookup dùng (người gọi truyền vào, để bản dò chạy được trên image cũ lẫn mới). */
export type CarriesCode = (data: Data, code: string) => boolean;
export type SearchOrders = (text: string) => Promise<readonly Data[]>;

/** Đơn tra thử: tối đa `n` đơn DELIVERED rồi SHIPPED của mẫu. */
export function pickSearchSamples(sample: readonly Data[], n: number): Data[] {
  return pickCensusSample(
    sample.filter((o) => isClaimBucket(statusBucketOf(o))),
    n,
  );
}

/**
 * Tra lại từng đơn mẫu bằng `search`: mã vận đơn, mã đơn sàn, và giá trị ở từng đường dẫn mã mới. Trúng khi ít nhất một đơn trả về mang
 * đúng mã (`carries` cho mã đang đọc; cùng đường dẫn cho mã mới), không dựa vào id. `lookupRate` = tỉ lệ đơn mẫu tra được bằng mã vận đơn
 * hoặc mã đơn sàn (đơn không có mã nào tính là trượt).
 */
export async function runSearchChecks(census: ChannelCensus, samples: readonly Data[], search: SearchOrders, carries: CarriesCode): Promise<ChannelCensus> {
  const checks: SearchCheck[] = [];
  let found = 0;
  for (const data of samples) {
    const id = String(data['id'] ?? '');
    let sameOrder = false;
    const tryCode = async (code: string | null, hit: (o: Data, c: string) => boolean): Promise<boolean | null> => {
      if (!code) return null;
      const matched = (await search(code)).filter((o) => hit(o, code));
      if (matched.some((o) => String(o['id'] ?? '') === id)) sameOrder = true;
      return matched.length > 0;
    };
    const tracking = trackingCodeOf(data);
    const sn = marketplaceOrderSn(data);
    const trackingHit = await tryCode(tracking, carries);
    const orderSnHit = await tryCode(sn, carries);
    const candidateHits: Record<string, boolean | null> = {};
    for (const path of census.candidatePaths) {
      candidateHits[path] = await tryCode(codesAtPath(data, path)[0] ?? null, (o, c) => codesAtPath(o, path).includes(c));
    }
    if (trackingHit === true || orderSnHit === true) found++;
    checks.push({
      maskedTracking: tracking ? maskClaimCode(tracking) : null,
      maskedOrderSn: sn ? maskClaimCode(sn) : null,
      bucket: statusBucketOf(data),
      trackingHit,
      orderSnHit,
      candidateHits,
      sameOrder,
    });
  }
  const lookupRate = rate(found, checks.length);
  return { ...census, searches: checks, lookupRate, lookupReady: lookupRate !== null && lookupRate >= LOOKUP_READY_MIN_RATE };
}

/** 0: mọi kênh có đơn nhóm nhận đều LOOKUP_READY; 1: có kênh chưa; 2: không kênh nào có đơn nhóm nhận (không kết luận được). */
export function censusExitCode(channels: readonly ChannelCensus[]): 0 | 1 | 2 {
  const sampled = channels.filter((c) => c.claimSample > 0);
  if (sampled.length === 0) return 2;
  return sampled.every((c) => c.lookupReady) ? 0 : 1;
}

export interface DbSummaryRow {
  channel: string | null;
  status: string;
  n: number;
  noCode: number;
  noPhone: number;
  withOrderSn: number;
}

const pct = (v: number | null): string => (v === null ? '–' : `${Math.round(v * 100)}%`);
const counts = (r: Record<StatusBucket, number>): string => STATUS_BUCKETS.map((b) => `${b} ${r[b]}`).join(' · ');
const hitRate = (xs: readonly (boolean | null)[]): string => {
  const tried = xs.filter((x) => x !== null);
  return tried.length ? `${tried.filter((x) => x === true).length}/${tried.length}` : '–';
};
const hitWord = (v: boolean | null): string => (v === null ? '–' : v ? 'trúng' : 'trượt');

/** Báo cáo chữ, đã che (không chữ số SĐT, không giá trị mã, không khoá API). */
export function formatCensusReport(input: { days: number; perChannel: number; getCalls: number; channels: readonly ChannelCensus[]; db: readonly DbSummaryRow[] | null }): string {
  const out: string[] = [
    `Dò trường đơn sàn Pancake (chỉ GET, đã che): cửa sổ ${input.days} ngày, tối đa ${input.perChannel} đơn mẫu mỗi sàn, ${input.getCalls} lệnh GET`,
  ];
  for (const c of input.channels) {
    out.push('', `## ${c.channel}`);
    out.push(`- Đã kéo: ${counts(c.fetched)}`);
    out.push(`- Mẫu: ${counts(c.sample)} (nhóm nhận DELIVERED+SHIPPED = ${c.claimSample})`);
    out.push(`- Nhóm nhận: có mã vận đơn ${pct(c.trackingRate)} · có mã đơn sàn ${pct(c.orderSnRate)} · có mã bất kỳ ${pct(c.anyCodeRate)} · CLAIMABLE_RATE ${pct(c.claimableRate)}`);
    out.push(
      `- SĐT người mua (nhóm nhận): FULL ${c.buyerShapes.FULL} · MASK lead+tail ${c.buyerShapes.MASK_LEAD_TAIL} · MASK tail-only ${c.buyerShapes.MASK_TAIL_ONLY} · NONE ${c.buyerShapes.NONE}` +
        ` · số FULL khác nhau ${pct(c.buyerFullDistinctRatio)}${c.relaySuspect ? ' · NGHI SỐ TRUNG GIAN' : ''}`,
    );
    out.push(
      `- Tra lại (${c.searches.length} đơn): mã vận đơn ${hitRate(c.searches.map((s) => s.trackingHit))} · mã đơn sàn ${hitRate(c.searches.map((s) => s.orderSnHit))}` +
        c.candidatePaths.map((p) => ` · ${p} ${hitRate(c.searches.map((s) => s.candidateHits[p] ?? null))}`).join('') +
        ` · LOOKUP ${pct(c.lookupRate)} → LOOKUP_READY ${c.lookupReady ? 'có' : 'không'}`,
    );
    out.push(`- Đường dẫn mã mới đủ điều kiện (≥ 80% nhóm nhận, không trùng, chưa trong extract): ${c.candidatePaths.length ? c.candidatePaths.join(', ') : 'không có'}`);
    out.push('  Trường mang mã | DELIVERED | SHIPPED | OPEN | CLOSED | nhóm nhận | hình dạng | tiền tố | khác nhau | trong extract');
    for (const r of c.codePaths) {
      out.push(
        `  ${r.path} | ${STATUS_BUCKETS.map((b) => pct(r.coverage[b])).join(' | ')} | ${pct(r.coverageClaim)} | ${r.shapes.join(' ') || '–'} | ${r.prefixes.join(' ') || '–'} | ${pct(r.distinctRatio)} | ${pct(r.inExtractRatio)}`,
      );
    }
    out.push('  Trường SĐT | có mặt | FULL | MASK lead+tail | MASK tail-only | MASK_UNPARSED | TEXT | EMPTY | tiền tố | số chữ số | FULL khác nhau | nhiều số hơn SĐT người mua');
    for (const p of c.phonePaths) {
      const prefixes = Object.entries(p.prefixes).map(([k, v]) => `${k}×${v}`).join(' ') || '–';
      const digits = p.digitsMin === null ? '–' : p.digitsMin === p.digitsMax ? `${p.digitsMin}` : `${p.digitsMin}–${p.digitsMax}`;
      out.push(
        `  ${p.path} | ${p.present} | ${PHONE_FIELD_CLASSES.map((k) => p.classes[k]).join(' | ')} | ${prefixes} | ${digits} | ${pct(p.fullDistinctRatio)} | ${pct(p.betterDigitsRate)}` +
          (p.unparsedForms.length ? ` | khuôn che lạ: ${p.unparsedForms.join(' ')}` : ''),
      );
    }
    for (const s of c.searches) {
      const cand = Object.entries(s.candidateHits).map(([k, v]) => ` ${k}:${hitWord(v)}`).join('');
      out.push(
        `    · ${s.bucket} vận đơn ${s.maskedTracking ?? '(không)'}:${hitWord(s.trackingHit)} mã sàn ${s.maskedOrderSn ?? '(không)'}:${hitWord(s.orderSnHit)}${cand} đúng đơn:${s.sameOrder ? 'có' : 'không'}`,
      );
    }
  }
  if (input.db) {
    out.push('', '## external_orders (DB, chỉ đọc, source = MARKETPLACE)', '  kênh | trạng thái | số đơn | không mã | không SĐT | có mã đơn sàn');
    for (const r of input.db) out.push(`  ${r.channel ?? '(không)'} | ${r.status} | ${r.n} | ${r.noCode} | ${r.noPhone} | ${r.withOrderSn}`);
  }
  return out.join('\n');
}
