import { inCartQuantity } from '@tubutree/app-core/commerce/flash-line';
import { readGuestCart, removeGuestLine } from './store';

/** Mốc bắt đầu lần gộp gần nhất trong tab này: callback đăng nhập bị tải lại giữa chừng thì không gộp lại phần đã gửi lên máy chủ. */
export const GUEST_MERGE_CLAIM_KEY = 'tubu.guestCart.mergedAt';
export const GUEST_MERGE_CLAIM_TTL_MS = 2 * 60_000;

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
  /** Dòng được thêm ít hơn số khách chọn vì tồn kho không đủ. */
  reduced: number;
  /** Dòng không thêm được: hết hàng, ngừng bán, hoặc máy chủ từ chối. */
  failedLines: number;
}

function session(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Giữ chỗ lần gộp; false khi tab này vừa gộp trong TTL. Không có sessionStorage thì vẫn gộp (khoá trong bộ nhớ chặn chạy đôi cùng trang). */
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

let inflight: Promise<GuestMergeResult | null> | null = null;

/**
 * Gộp giỏ khách vào giỏ máy chủ bằng API thêm giỏ hiện có, tuần tự từng dòng. Số lượng sau gộp = min(tồn, khách + máy chủ); API thêm giỏ
 * cộng dồn nên chỉ gửi phần chênh. Lỗi một dòng không chặn dòng khác. Mỗi dòng xử lý xong (thêm được hay không) bị xoá khỏi giỏ khách ngay,
 * nên chạy lại không bao giờ thêm lần hai. Hai lời gọi cùng lúc dùng chung một lần chạy. Trả null khi không có gì để gộp hoặc vừa gộp.
 */
export function mergeGuestCart(deps: GuestMergeDeps, now: number = Date.now()): Promise<GuestMergeResult | null> {
  if (inflight) return inflight;
  const lines = readGuestCart();
  if (lines.length === 0 || !claim(now)) return Promise.resolve(null);
  inflight = run(lines, deps).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function run(lines: ReturnType<typeof readGuestCart>, deps: GuestMergeDeps): Promise<GuestMergeResult> {
  const result: GuestMergeResult = { lines: lines.length, merged: 0, reduced: 0, failedLines: 0 };
  let cart: { items: Lines } | null = await deps.getCart().catch(() => null);
  const stockBySlug = new Map<string, Promise<Record<string, number> | null>>();
  const stockOf = (slug: string) => {
    let p = stockBySlug.get(slug);
    if (!p) {
      p = deps.getStock(slug).catch(() => null);
      stockBySlug.set(slug, p);
    }
    return p;
  };
  for (const line of lines) {
    try {
      const stocks = await stockOf(line.slug);
      const stock = stocks ? stocks[line.variationId] : undefined;
      // Đã có tồn kho của sản phẩm mà không thấy phân loại: phân loại đã ngừng bán.
      if (stocks && stock === undefined) {
        result.failedLines += 1;
        continue;
      }
      const inCart = inCartQuantity(cart?.items, line.variationId);
      const want = line.quantity;
      const delta = typeof stock === 'number' ? Math.min(stock, inCart + want) - inCart : want;
      if (delta <= 0) {
        if (inCart > 0) result.merged += 1;
        else result.failedLines += 1;
        continue;
      }
      cart = await deps.addToCart(line.variationId, delta);
      result.merged += 1;
      if (delta < want) result.reduced += 1;
    } catch {
      result.failedLines += 1;
    } finally {
      removeGuestLine(line.variationId);
    }
  }
  return result;
}

/** Chỉ cho test: bỏ lần chạy đang giữ trong bộ nhớ. */
export function resetGuestMergeForTest(): void {
  inflight = null;
}
