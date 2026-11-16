import { inCartQuantity } from '@tubutree/app-core/commerce/flash-line';
import { markGuestMergeBase, readGuestCart, removeGuestLine, type GuestCartLine } from './store';

/** Mốc bắt đầu lần gộp đang chạy trong tab này: callback đăng nhập bị tải lại giữa chừng thì không gộp chồng lên lời gọi còn đang bay. */
export const GUEST_MERGE_CLAIM_KEY = 'tubu.guestCart.mergedAt';
export const GUEST_MERGE_CLAIM_TTL_MS = 2 * 60_000;
/** Mốc giỏ máy chủ của một dòng còn dùng được trong chừng này; lâu hơn thì giỏ máy chủ có thể đã đổi tay khách, tính lại từ đầu. */
export const GUEST_MERGE_BASE_TTL_MS = 10 * 60_000;

type Lines = readonly { variationId: string; quantity: number }[];

export interface GuestMergeDeps {
  getCart: () => Promise<{ items: Lines }>;
  addToCart: (variationId: string, quantity: number) => Promise<{ items: Lines }>;
  /** Tồn kho thật theo phân loại của một sản phẩm (API công khai). Lỗi thì gộp không biết tồn và để máy chủ quyết. */
  getStock: (slug: string) => Promise<Record<string, number>>;
}

export interface GuestMergeResult {
  /** Số dòng giỏ khách đem gộp. */
  lines: number;
  /** Dòng đã nằm trong giỏ máy chủ sau khi gộp (kể cả dòng giỏ máy chủ đã đủ số còn hàng). */
  merged: number;
  /** Dòng vào giỏ máy chủ ít hơn số khách chọn vì tồn kho không đủ. */
  reduced: number;
  /** Dòng không thêm được: hết hàng, ngừng bán, hoặc máy chủ từ chối hẳn (4xx). Đã bỏ khỏi giỏ khách. */
  failedLines: number;
  /** Dòng chưa gộp được vì mạng hay máy chủ lỗi tạm: còn trong giỏ khách để lần sau gộp tiếp. */
  kept: number;
}

function session(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Giữ chỗ lần gộp; false khi tab này có lần gộp bị cắt ngang chưa quá TTL. Không có sessionStorage thì vẫn gộp (khoá trong bộ nhớ chặn chạy đôi cùng trang). */
function claim(now: number): boolean {
  const s = session();
  if (!s) return true;
  try {
    const at = Number(s.getItem(GUEST_MERGE_CLAIM_KEY));
    if (Number.isFinite(at) && at > 0 && now - at >= 0 && now - at < GUEST_MERGE_CLAIM_TTL_MS) return false;
    s.setItem(GUEST_MERGE_CLAIM_KEY, String(now));
  } catch {
    /* bộ nhớ bị chặn: dựa vào khoá trong bộ nhớ */
  }
  return true;
}

/** Lần gộp đã chạy hết (không còn lời gọi nào đang bay): bỏ giữ chỗ để lần gộp lại các dòng còn sót không phải chờ TTL. */
function release(): void {
  try {
    session()?.removeItem(GUEST_MERGE_CLAIM_KEY);
  } catch {
    /* hết TTL thì tự mở */
  }
}

/** Máy chủ đã trả lời và từ chối hẳn (hết hàng, ngừng bán, sai dữ liệu): gửi lại cũng vậy. Lỗi mạng, 5xx, 401, 408, 429 là lỗi tạm. */
function rejectedForGood(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

let inflight: Promise<GuestMergeResult | null> | null = null;

/**
 * Gộp giỏ khách vào giỏ máy chủ bằng API thêm giỏ hiện có, tuần tự từng dòng. Số lượng sau gộp = min(tồn, khách + máy chủ lúc bắt đầu gộp
 * dòng đó); API thêm giỏ cộng dồn nên chỉ gửi phần còn thiếu so với đích. Lỗi một dòng không chặn dòng khác. Dòng xong (vào giỏ hoặc bị từ
 * chối hẳn) bị xoá khỏi giỏ khách; dòng gặp lỗi tạm ở lại kèm mốc để lần sau nhắm đúng đích, không cộng lần hai. Hai lời gọi cùng lúc dùng
 * chung một lần chạy. Trả null khi không có gì để gộp hoặc tab này có lần gộp bị cắt ngang chưa quá TTL.
 */
export function mergeGuestCart(deps: GuestMergeDeps, now: number = Date.now()): Promise<GuestMergeResult | null> {
  if (inflight) return inflight;
  const lines = readGuestCart();
  if (lines.length === 0 || !claim(now)) return Promise.resolve(null);
  inflight = run(lines, deps, now).finally(() => {
    inflight = null;
    release();
  });
  return inflight;
}

async function run(lines: readonly GuestCartLine[], deps: GuestMergeDeps, now: number): Promise<GuestMergeResult> {
  const result: GuestMergeResult = { lines: lines.length, merged: 0, reduced: 0, failedLines: 0, kept: 0 };
  // Không đọc được giỏ máy chủ thì không biết đã có bao nhiêu: gửi mù có thể vượt tồn và bị từ chối, nên để cả giỏ khách cho lần sau.
  let cart: { items: Lines };
  try {
    cart = await deps.getCart();
  } catch {
    result.kept = lines.length;
    return result;
  }
  const stockBySlug = new Map<string, Promise<Record<string, number> | null>>();
  const stockOf = (slug: string) => {
    let p = stockBySlug.get(slug);
    if (!p) {
      p = deps.getStock(slug).catch(() => null);
      stockBySlug.set(slug, p);
    }
    return p;
  };
  for (const snapshot of lines) {
    // Đọc lại dòng ngay trước khi gửi: tab khác vừa gộp xong dòng này thì đã xoá nó, bỏ qua.
    const line = readGuestCart().find((l) => l.variationId === snapshot.variationId);
    if (!line) continue;
    const id = line.variationId;
    const stocks = await stockOf(line.slug);
    const stock = stocks ? stocks[id] : undefined;
    // Đã có tồn kho của sản phẩm mà không thấy phân loại: phân loại đã ngừng bán.
    if (stocks && stock === undefined) {
      result.failedLines += 1;
      removeGuestLine(id);
      continue;
    }
    const inCart = inCartQuantity(cart.items, id);
    const base = line.mergeBase && now - line.mergeBase.at >= 0 && now - line.mergeBase.at < GUEST_MERGE_BASE_TTL_MS ? line.mergeBase.inCart : inCart;
    const wanted = base + line.quantity;
    const target = typeof stock === 'number' ? Math.min(stock, wanted) : wanted;
    const delta = target - inCart;
    if (delta <= 0) {
      if (inCart > 0) {
        result.merged += 1;
        if (target < wanted) result.reduced += 1;
      } else {
        result.failedLines += 1;
      }
      removeGuestLine(id);
      continue;
    }
    markGuestMergeBase(id, base, now);
    try {
      cart = await deps.addToCart(id, delta);
      result.merged += 1;
      if (target < wanted) result.reduced += 1;
      removeGuestLine(id);
    } catch (err) {
      if (rejectedForGood(err)) {
        result.failedLines += 1;
        removeGuestLine(id);
      } else {
        result.kept += 1;
      }
    }
  }
  return result;
}

/** Chỉ cho test: bỏ lần chạy đang giữ trong bộ nhớ. */
export function resetGuestMergeForTest(): void {
  inflight = null;
}
