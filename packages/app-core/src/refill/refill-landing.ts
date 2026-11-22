import { fillTemplate } from '../copy-template';
import type { HttpClient } from '../http';
import type { RefillOfferDTO } from './refill-api';
import { pdpRefillOffer, type PdpRefillOfferView } from './refill-saving';

/** Chai của một cặp (cùng dạng `RefillLandingBottle` ở apps/api/src/modules/catalog/refill/refill-pairs.service.ts). */
export interface RefillLandingBottleDTO {
  productId: string;
  slug: string;
  name: string;
  thumbnail: string | null;
  /** Giá đang bán trên thẻ (đồng), chưa gồm Giờ vàng. */
  price: number;
  compareAt: number | null;
  sizeLabel: string | null;
  inStock: boolean;
}

export interface RefillLandingPairDTO {
  bottle: RefillLandingBottleDTO;
  refill: RefillOfferDTO;
  /** % gói rẻ hơn mua chai cùng lượng do máy chủ tính (để xếp hàng); null khi không so được. */
  savingPct: number | null;
}

/** GET /catalog/refill-pairs/landing. Cờ `catalog.refill_first_enabled` tắt: `{ enabled: false, pairs: [] }`. */
export interface RefillLandingDTO {
  enabled: boolean;
  pairs: RefillLandingPairDTO[];
}

/** Đường dẫn trang ở từng nền tảng (route-map: `/refill-deals` ↔ `/tiet-kiem-refill`). */
export const REFILL_LANDING_PATH = { web: '/tiet-kiem-refill', miniapp: '/refill-deals' } as const;

// Công khai, không theo người: `anonymous` để khách đã đăng nhập không kéo theo preflight CORS/làm mới token (như `fetchGiftLanding`).
export const fetchRefillLanding = (http: HttpClient) => http.get<RefillLandingDTO>('/catalog/refill-pairs/landing', { anonymous: true });

/** Công khai, cache như danh mục ở máy chủ: một khoá chung cho trang, lối vào ở Danh mục/Bộ quà tặng và thẻ Refill ở chi tiết đơn. */
export const refillLandingQuery = (http: HttpClient) => ({
  queryKey: ['refill-pairs', 'landing'] as const,
  queryFn: () => fetchRefillLanding(http),
  staleTime: 5 * 60_000,
  retry: false,
});

/**
 * Chữ của trang "Tiết kiệm với Refill", lối vào ở Danh mục và Bộ quà tặng, và thẻ Refill ở chi tiết đơn. Tách khỏi `shop-copy.ts` như
 * `refill-saving.ts`: chỉ màn này nạp, không vào gói khởi động của Trang chủ. Câu hỏi thường gặp hiện trên trang và khai FAQPage từ cùng mảng.
 */
export const REFILL_LANDING_COPY = {
  title: 'Tiết kiệm với Refill',
  intro: 'Đã có chai? Mua túi hoặc can Refill để rót lại: rẻ hơn mua chai mới cùng lượng và bớt một vỏ nhựa.',
  introUpTo: 'Đã có chai? Túi, can Refill rẻ hơn mua chai mới cùng lượng tới {pct}% và bớt một vỏ nhựa.',
  metaDescription: 'Túi và can Refill cho chai nước giặt, nước rửa chén, sữa tắm bạn đang dùng: rẻ hơn mua chai mới cùng lượng, thêm vào giỏ một chạm.',
  forBottle: 'Thay cho {name}',
  listLabel: 'Danh sách gói Refill, {n} gói',
  empty: 'Chưa có gói Refill nào đang mở bán',
  entrySub: 'Túi, can Refill rẻ hơn mua chai mới',
  orderTitle: 'Lần sau rót lại bằng Refill',
  faqTitle: 'Câu hỏi thường gặp',
  faqWhatQ: 'Refill là gì?',
  faqWhatA: 'Refill là túi hoặc can chứa cùng sản phẩm với chai bạn đang dùng. Bạn rót lại vào chai cũ thay vì mua chai mới.',
  faqSaveQ: 'Mua Refill tiết kiệm được bao nhiêu?',
  faqSaveA: 'Mỗi gói ghi số tiền và phần trăm rẻ hơn so với mua chai cùng lượng, theo giá đang bán. Giá cuối do giỏ hàng tính lại khi bạn đặt.',
  faqBottleQ: 'Chưa có chai thì sao?',
  faqBottleA: 'Bạn mua chai trước, lần sau rót lại bằng Refill. Mỗi gói ghi rõ chai nó thay.',
} as const;

export type RefillLandingCopyKey = keyof typeof REFILL_LANDING_COPY;

/** Số ký tự tối đa sau khi điền giá trị xấu nhất; null = đoạn văn (xuống dòng tự do) hoặc dòng có tên sản phẩm cắt bằng CSS. Chỉ spec đọc. */
export const REFILL_LANDING_COPY_MAX: Record<RefillLandingCopyKey, number | null> = {
  title: 20,
  intro: null,
  introUpTo: null,
  metaDescription: 160,
  forBottle: null,
  listLabel: 36,
  empty: 40,
  entrySub: 36,
  orderTitle: 30,
  faqTitle: 22,
  faqWhatQ: 40,
  faqWhatA: null,
  faqSaveQ: 40,
  faqSaveA: null,
  faqBottleQ: 40,
  faqBottleA: null,
};

export function refillLandingCopy(key: RefillLandingCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(REFILL_LANDING_COPY[key], vars, key);
}

type LandingBottle = { slug: string; name: string };

/**
 * Một hàng của trang: thẻ gói Refill (`PdpRefillOffer`) cùng số với trang chi tiết chai và các chai nó thay. `bottle` là chai mà số trên thẻ so với (chai đầu theo
 * thứ tự máy chủ); `bottles` gồm nó và các chai khác cùng gói, để mỗi gói chỉ một nút "+ Thêm".
 */
export interface RefillLandingRow {
  key: string;
  bottle: LandingBottle;
  bottles: readonly LandingBottle[];
  view: PdpRefillOfferView;
}

type PairRow = { key: string; bottle: LandingBottle; view: PdpRefillOfferView };

/**
 * Mỗi cặp một thẻ, theo thứ tự máy chủ (còn hàng, rẻ hơn nhiều nhất trước), dựng bằng `pdpRefillOffer` như ở trang chi tiết chai. Chỉ giữ thẻ có số rẻ hơn
 * (`comparison`): trang, mô tả tìm kiếm và FAQ đều nói Refill rẻ hơn, nên gói đắt hơn chai cùng lượng (chai đang giảm giá) hay không so được thì không lên.
 * Gói hết hàng thì không có thẻ. Cờ tắt, chưa tải hay dữ liệu hỏng: rỗng.
 */
function savingPairRows(dto: RefillLandingDTO | null | undefined): PairRow[] {
  if (!dto?.enabled || !Array.isArray(dto.pairs)) return [];
  const rows: PairRow[] = [];
  const seen = new Set<string>();
  for (const pair of dto.pairs) {
    if (!pair?.bottle || !pair.refill) continue;
    const key = `${pair.bottle.productId}:${pair.refill.productId}`;
    if (seen.has(key)) continue;
    const view = pdpRefillOffer({ name: pair.bottle.name, price: pair.bottle.price }, pair.refill);
    if (!view?.comparison) continue;
    seen.add(key);
    rows.push({ key, bottle: { slug: pair.bottle.slug, name: pair.bottle.name }, view });
  }
  return rows;
}

/** Hàng của trang: mỗi gói một hàng (gói thay nhiều chai gộp lại, số theo chai đầu), thứ tự máy chủ. */
export function refillLandingRows(dto: RefillLandingDTO | null | undefined): RefillLandingRow[] {
  const rows: RefillLandingRow[] = [];
  const byVariation = new Map<string, LandingBottle[]>();
  for (const row of savingPairRows(dto)) {
    const bottles = byVariation.get(row.view.variationId);
    if (bottles) {
      bottles.push(row.bottle);
      continue;
    }
    const own = [row.bottle];
    byVariation.set(row.view.variationId, own);
    rows.push({ ...row, bottles: own });
  }
  return rows;
}

/** Dòng phụ trên thẻ: "Thay cho A, B". */
export function refillLandingBottleCaption(row: RefillLandingRow): string {
  return refillLandingCopy('forBottle', { name: row.bottles.map((b) => b.name).join(', ') });
}

/** Mức rẻ hơn cao nhất trên các thẻ đang hiện (cùng số khách đọc trên thẻ); null khi không thẻ nào so được. */
export function refillLandingBestPct(rows: readonly RefillLandingRow[]): number | null {
  let best: number | null = null;
  for (const r of rows) {
    const pct = r.view.comparison?.savedPct;
    if (typeof pct === 'number' && (best === null || pct > best)) best = pct;
  }
  return best;
}

/** Câu mở đầu: nêu "tới X%" chỉ khi có thẻ so được. */
export function refillLandingIntro(rows: readonly RefillLandingRow[]): string {
  const pct = refillLandingBestPct(rows);
  return pct === null ? refillLandingCopy('intro') : refillLandingCopy('introUpTo', { pct });
}

/** Gói Refill của trang cho ItemList (JSON-LD), mỗi gói một lần dù thay cho nhiều chai. */
export function refillLandingItems(rows: readonly RefillLandingRow[]): { slug: string; name: string }[] {
  const seen = new Set<string>();
  const out: { slug: string; name: string }[] = [];
  for (const r of rows) {
    if (seen.has(r.view.slug)) continue;
    seen.add(r.view.slug);
    out.push({ slug: r.view.slug, name: r.view.name });
  }
  return out;
}

/** Câu hỏi thường gặp, cùng mảng cho phần hiển thị và FAQPage. */
export function refillLandingFaq(): { q: string; a: string }[] {
  return [
    { q: refillLandingCopy('faqWhatQ'), a: refillLandingCopy('faqWhatA') },
    { q: refillLandingCopy('faqSaveQ'), a: refillLandingCopy('faqSaveA') },
    { q: refillLandingCopy('faqBottleQ'), a: refillLandingCopy('faqBottleA') },
  ];
}

/**
 * Thẻ Refill ở chi tiết một đơn đã giao: cặp đầu tiên (thứ tự của trang) mà chai nằm trong đơn và gói chưa có trong đơn, số so với đúng chai đó (không gộp như
 * trang). Đơn đã giao nghĩa là khách đã có chai đó. `slugs` là slug lúc mua của các dòng không phải quà; dòng không có slug (đơn cũ) không khớp được.
 */
export function refillOrderShortcut(dto: RefillLandingDTO | null | undefined, slugs: readonly (string | null | undefined)[]): RefillLandingRow | null {
  const inOrder = new Set(slugs.filter((s): s is string => typeof s === 'string' && s !== ''));
  if (inOrder.size === 0) return null;
  const row = savingPairRows(dto).find((r) => inOrder.has(r.bottle.slug) && !inOrder.has(r.view.slug));
  return row ? { ...row, bottles: [row.bottle] } : null;
}
