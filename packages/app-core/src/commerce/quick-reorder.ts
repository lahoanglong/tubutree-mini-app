import type { ProductCard } from '../api/catalog';
import type { PurchasedItem } from '../api/orders';
import { isFlashRunning, type FlashPriceItem } from '../flash-price';
import { rebuyPricing } from '../rebuy-pricing';
import { serverNow } from '../server-clock';
import { joinVariationLine, variationLabel } from '../variation-label';
import { addOneCardPricing } from './add-one-pricing';
import { variationLinePreview } from './flash-line';
import { fillBootCopy } from '../shop-copy-boot';

/**
 * Dải "Mua lại món quen" ở Trang chủ: món khách đã nhận hàng (hoặc, khi chưa có đơn nào, món vừa xem) dưới dạng thẻ thêm một chạm.
 * Mini App và web cùng gọi hàm này: giá, thứ tự và món bị loại không được lệch giữa hai nền tảng.
 */

/** Trần số món của dải (kệ `home.purchased`) và sàn: dưới sàn dải ẩn hẳn, một món thì trang vẫn vẽ dòng Mua lại cũ. Sàn đếm món còn hàng. */
export const QUICK_REORDER_MAX = 8;
export const QUICK_REORDER_MIN = 2;
/** Kệ Mua lại của Trang chủ chỉ mời món của đơn đặt trong chừng này ngày (tính theo ngày Việt Nam); tab Đơn hàng vẫn hiện đủ. */
export const BUY_AGAIN_WINDOW_DAYS = 90;

const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;

/**
 * Mốc sớm nhất (epoch ms) của cửa sổ Mua lại: nửa đêm giờ Việt Nam của ngày cách hôm nay `BUY_AGAIN_WINDOW_DAYS` ngày. Theo ngày chứ không theo
 * từng mili giây để chống trùng Trang chủ và kệ, tính ở hai lượt vẽ khác nhau, luôn ra cùng một tập món (chỉ đổi lúc nửa đêm).
 */
export function buyAgainCutoff(now: number): number {
  return buyAgainDay(now) - BUY_AGAIN_WINDOW_DAYS * DAY_MS;
}

/** Nửa đêm giờ Việt Nam của hôm nay (epoch ms). Dùng làm `now` cho `quickReorderShelfItems` khi cần một khoá chỉ đổi theo ngày (deps của useMemo). */
export function buyAgainDay(now: number): number {
  return Math.floor((now + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS;
}

/** Lần mua gần nhất của món nằm trong cửa sổ Mua lại. Mốc hỏng thì không mời (không đoán). */
export function inBuyAgainWindow(p: Pick<PurchasedItem, 'lastPurchasedAt'>, now: number): boolean {
  const at = Date.parse(p.lastPurchasedAt);
  return Number.isFinite(at) && at >= buyAgainCutoff(now);
}

export interface QuickReorderItem {
  /** Khoá dòng: phân loại sẽ vào giỏ (một sản phẩm đã mua hai phân loại là hai thẻ). */
  key: string;
  productId: string;
  slug: string;
  variationId: string;
  /** Tên sản phẩm kèm phân loại khi biết ("Dầu gội · 500ml"). */
  name: string;
  thumbnail: string | null;
  /** Giá khách trả cho một đơn vị: Giờ vàng đang chạy thắng khi rẻ hơn giá bán. */
  price: number;
  compareAt: number | null;
  /** Phần trăm tiết kiệm so với giá gạch; 0 khi không giảm. */
  savePct: number;
  isFlash: boolean;
  /** Số lần đã đặt; 0 với món chỉ mới xem. */
  timesBought: number;
  source: 'purchased' | 'viewed';
  /** Nhãn trên ảnh thay cho "-x%"/"Đã mua n lần" (ô đã đổi sang túi Refill: "Đổi sang túi Refill 1L"). */
  badge?: string;
  /** Chữ nút thêm thay cho "+ Thêm". */
  addLabel?: string;
  /** Câu đọc của nút thêm thay cho câu mặc định. */
  addAria?: string;
  /** Món đã mua đang hết hàng: ô có nút "Báo khi có" thay cho "+ Thêm" và không vào "Thêm lại tất cả". */
  soldOut?: boolean;
  /** Món hết hàng mà khách đã đăng ký báo hàng về. */
  restockWaiting?: boolean;
}

export interface QuickReorderParams {
  /** Món đã mua, mới nhất trước (`GET /me/purchased-items`). */
  purchased?: readonly PurchasedItem[];
  /** Thẻ món vừa xem, mới nhất trước, giá đã hỏi theo slug; chỉ dùng khi khách chưa có món đã mua nào. */
  viewed?: readonly ProductCard[];
  /** Giờ vàng đang chạy (`/flash-sales/active`). */
  flash?: readonly FlashPriceItem[];
  /** Phân loại đã nằm ở kệ xếp trên (Giờ vàng): không lặp lại. */
  excludeVariationIds?: ReadonlySet<string>;
  /** Số đang có trong giỏ theo phân loại (`cartUnitsByVariation`): giỏ so suất Giờ vàng với cả dòng, nên thẻ chỉ ghi giá Giờ vàng khi thêm 1 nữa vẫn trong suất. Chưa tải giỏ: bỏ trống. */
  cartUnits?: ReadonlyMap<string, number>;
  now?: number;
  limit?: number;
  /** Cờ báo hàng về bật (`restockAlertsEnabled` của trang món đã mua): món đã mua đang hết hàng thêm vào cuối dải với nút "Báo khi có". */
  includeSoldOut?: boolean;
}

/**
 * Món đủ điều kiện lên dải: còn hàng và có giá. Chống trùng của Trang chủ (`use-home-shelves`) lọc bằng đúng vị từ này trước khi chiếm món, để tập món dải vẽ
 * và tập món kệ giữ là một: lọc khác nhau thì có món bị chiếm mà không ai vẽ (biến khỏi mọi kệ), hoặc được vẽ mà không ai chiếm (lặp ở kệ dưới).
 */
export function quickReorderAvailable(p: PurchasedItem): boolean {
  return p.inStock !== false && p.stock > 0 && (p.salePrice ?? p.price) > 0;
}

/** Món đã mua đang hết hàng mà vẫn có giá: nhận nút "Báo khi có" khi cờ báo hàng về bật. */
export function quickReorderSoldOut(p: PurchasedItem): boolean {
  return !(p.inStock !== false && p.stock > 0) && (p.salePrice ?? p.price) > 0;
}

export interface QuickReorderShelfOptions {
  /** Giờ máy chủ: chỉ giữ món của đơn trong `BUY_AGAIN_WINDOW_DAYS` ngày. */
  now: number;
  /** Cờ báo hàng về bật: dải giữ cả món hết hàng (sau món còn hàng) với nút "Báo khi có". */
  restock?: boolean;
}

/**
 * Món kệ `home.purchased` của Trang chủ chiếm và vẽ, chỉ trong cửa sổ `BUY_AGAIN_WINDOW_DAYS` ngày. Đủ `QUICK_REORDER_MIN` món dùng được thì dải "Mua lại món quen"
 * vẽ món dùng được, rồi (cờ báo hàng về bật) món hết hàng có nút "Báo khi có", nên kệ giữ đúng chừng ấy món; ít hơn thì dải ẩn và kệ cũ (một dòng / thẻ) vẽ đủ, kể cả
 * món hết hàng. Chống trùng của Trang chủ (`use-home-shelves`) và kệ (`PurchasedRail`) cùng gọi hàm này với cùng tham số để tập món bị chiếm và tập món được vẽ là một:
 * lệch thì có món biến khỏi mọi kệ, hoặc lặp ở kệ dưới. Chưa cắt trần (kệ cắt `QUICK_REORDER_MAX`; món còn hàng đứng trước nên được giữ trước).
 */
export function quickReorderShelfItems<T extends PurchasedItem>(items: readonly T[], opts: QuickReorderShelfOptions): T[] {
  const recent = items.filter((p) => inBuyAgainWindow(p, opts.now));
  const usable = recent.filter(quickReorderAvailable);
  if (usable.length < QUICK_REORDER_MIN) return recent;
  return opts.restock ? [...usable, ...recent.filter(quickReorderSoldOut)] : usable;
}

function fromPurchased(p: PurchasedItem, flash: readonly FlashPriceItem[], now: number, inCart: number): QuickReorderItem {
  // Giá Giờ vàng chỉ khi suất còn chạy VÀ thêm 1 nữa vẫn trong suất khách còn mua được (API: `flashAllowance`; danh sách Giờ vàng: giới hạn mỗi khách, suất còn lại của đợt).
  // Vượt thì giỏ tính cả dòng giá thường (cả phần đã có trong giỏ), nên thẻ cũng ghi giá thường.
  const running = flash.filter((f) => f.variationId === p.variationId);
  const apiBlocked = p.flashAllowance != null && 1 + inCart > p.flashAllowance;
  const overLimit = variationLinePreview({ id: p.variationId, retailPrice: p.price, salePrice: p.salePrice }, running, 1, inCart).overLimit;
  const pricing = rebuyPricing(p, apiBlocked || overLimit ? [] : running, now);
  return {
    key: p.variationId,
    productId: p.productId,
    slug: p.slug,
    variationId: p.variationId,
    name: joinVariationLine(p.productName, variationLabel(p.variationName)),
    thumbnail: p.thumbnail,
    price: pricing.price,
    compareAt: pricing.compareAt,
    savePct: pricing.salePct,
    isFlash: pricing.isFlash,
    timesBought: p.timesBought,
    source: 'purchased',
  };
}

function fromViewed(c: ProductCard, flash: readonly FlashPriceItem[], now: number): QuickReorderItem | null {
  const pricing = addOneCardPricing(c, flash, now);
  // Cùng luật với nút thêm nhanh của thẻ: món ghim thêm phân loại ghim, Giờ vàng thắng thì thêm phân loại của suất đó, còn lại là phân loại đại diện.
  const variationId = pricing.variationId;
  if (!variationId || !c.inStock) return null;
  return {
    key: variationId,
    productId: c.id,
    slug: c.slug,
    variationId,
    name: c.name,
    thumbnail: c.thumbnail,
    price: pricing.price,
    compareAt: pricing.compareAt,
    savePct: pricing.salePct,
    isFlash: pricing.isFlash,
    timesBought: 0,
    source: 'viewed',
  };
}

/**
 * Tối đa `limit` (mặc định `QUICK_REORDER_MAX`) món để thêm lại một chạm. Thứ tự là thứ tự nguồn (mới nhất trước). Món đã mua có trước: chỉ khi khách chưa có món đã mua nào
 * (kể cả toàn món hết hàng thì vẫn là khách cũ, dải ẩn chứ không đổi sang món vừa xem) mới dùng món vừa xem. Loại món không có phân loại để thêm,
 * phân loại trong `excludeVariationIds` và phân loại lặp. Món hết hàng chỉ vào khi `includeSoldOut` (cờ báo hàng về bật), đứng sau mọi món còn hàng và mang
 * `soldOut`. Dưới `QUICK_REORDER_MIN` món còn hàng thì trả rỗng.
 */
export function buildQuickReorderItems(params: QuickReorderParams): QuickReorderItem[] {
  const now = params.now ?? serverNow();
  const flash = (params.flash ?? []).filter((f) => isFlashRunning(f, now));
  const limit = Math.max(0, Math.min(params.limit ?? QUICK_REORDER_MAX, QUICK_REORDER_MAX));
  const seen = new Set<string>(params.excludeVariationIds ?? []);
  const out: QuickReorderItem[] = [];
  const push = (item: QuickReorderItem | null) => {
    if (!item || seen.has(item.variationId) || !(item.price > 0)) return;
    seen.add(item.variationId);
    out.push(item);
  };
  const bought = params.purchased ?? [];
  if (bought.length > 0) {
    for (const p of bought) if (quickReorderAvailable(p)) push(fromPurchased(p, flash, now, params.cartUnits?.get(p.variationId) ?? 0));
  } else {
    for (const c of params.viewed ?? []) push(fromViewed(c, flash, now));
  }
  if (out.length < QUICK_REORDER_MIN) return [];
  if (params.includeSoldOut) {
    // Hết hàng nên không có suất Giờ vàng nào áp được: giá in là giá bán thường của phân loại đã mua.
    for (const p of bought) {
      if (quickReorderSoldOut(p)) push({ ...fromPurchased(p, [], now, 0), soldOut: true, restockWaiting: p.restockWaiting === true });
    }
  }
  return out.slice(0, limit);
}

/** Dòng giỏ của "Thêm lại tất cả": mỗi món một đơn vị. */
export function quickReorderLines(items: readonly QuickReorderItem[]): { variationId: string; quantity: number }[] {
  return items.filter((i) => !i.soldOut).map((i) => ({ variationId: i.variationId, quantity: 1 }));
}

/** Tổng tiền khách trả khi thêm lại cả dải (mỗi món còn hàng một đơn vị, giá đang hiện). */
export function quickReorderTotal(items: readonly QuickReorderItem[]): number {
  return items.reduce((sum, i) => (i.soldOut ? sum : sum + i.price), 0);
}

/**
 * Câu đọc của "Thêm lại tất cả": đúng số món và tổng tiền của các ô còn hàng đang hiện (nút chỉ thêm các ô này), và nói rõ bao nhiêu ô là túi Refill
 * để khách dùng trình đọc màn hình không bị đổi món mà không biết.
 */
export function quickReorderAddAllAria(items: readonly QuickReorderItem[], money: (n: number) => string): string {
  const spoken = fillBootCopy('quickReorder.addAllAria', { n: quickReorderLines(items).length, total: money(quickReorderTotal(items)) });
  const refills = items.filter((i) => i.badge).length;
  return refills > 0 ? `${spoken}${fillBootCopy('refill.railAllNote', { n: refills })}` : spoken;
}

/**
 * Trang món đã mua sau một lần chạm "Báo khi có" (vẽ trước khi máy chủ trả lời): đổi `restockWaiting` của đúng phân loại, giữ nguyên mọi thứ khác.
 * Không có phân loại đó thì trả đúng trang cũ (React Query bỏ qua lần ghi không đổi).
 */
export function withPurchasedRestock<P extends { items: readonly PurchasedItem[] }>(page: P, variationId: string, waiting: boolean): P {
  if (!page.items.some((p) => p.variationId === variationId && (p.restockWaiting === true) !== waiting)) return page;
  return { ...page, items: page.items.map((p) => (p.variationId === variationId ? { ...p, restockWaiting: waiting } : p)) };
}
