// Độ sâu điều hướng trong web, ghi thẳng vào history.state của từng mục lịch sử.
// history.length không dùng được (tính cả các mục trước khi khách vào site) và bộ đếm popstate không phân biệt Back với Forward hay replace với push.
// Mỗi pushState/replaceState đi qua đây đều được đóng dấu: push = độ sâu hiện tại + 1, replace = giữ nguyên. Back/Forward/F5 đứng lại đúng mục
// đã đóng dấu nên không cần đoán. Mục chưa có dấu (vào thẳng link, tab mới, trang ngoài Next) tính độ sâu 0.
// Cùng lúc push, đường dẫn trang đang đứng (pathname + query) được ghi thành `tubuPrev` trên mục MỚI: đó là "trang ngay trước" trong lịch sử, để
// liên kết như "Về giỏ hàng" biết khi nào nên lùi thật (router.back) thay vì đẩy thêm một bản sao của trang trước (Giỏ → Thanh toán → Giỏ). replace giữ nguyên
// `tubuPrev` của mục hiện tại vì mục đứng trước nó trong lịch sử không đổi. Bản Mini App làm việc này bằng vết trong bộ nhớ (lib/smart-nav.ts).
const KEY = 'tubuDepth';
const PREV = 'tubuPrev';

function currentState(): Record<string, unknown> | null {
  const s: unknown = typeof window === 'undefined' ? null : window.history.state;
  return s && typeof s === 'object' ? (s as Record<string, unknown>) : null;
}

export function historyDepth(): number {
  const n = currentState()?.[KEY];
  return typeof n === 'number' && n > 0 ? n : 0;
}

/** Trang ngay trước trang hiện tại trong lịch sử web (pathname + query), chỉ khi mục hiện tại có độ sâu; mở thẳng link, F5 mục chưa dấu thì không có. */
export function previousPath(): string | undefined {
  if (historyDepth() === 0) return undefined;
  const p = currentState()?.[PREV];
  return typeof p === 'string' && p !== '' ? p : undefined;
}

const pathOnly = (p: string): string => p.split(/[?#]/)[0] ?? p;

/**
 * Đích khớp trang trước theo pathname. Đích có `?query` hay `#` phải khớp đủ để không lùi nhầm sang tab khác của cùng trang
 * (`/uu-dai?tab=wallet` khác `/uu-dai`); đích trần chấp nhận trang trước có query.
 */
export function pathMatchesPrevious(target: string): boolean {
  const prev = previousPath();
  if (prev === undefined) return false;
  if (prev === target) return true;
  return !/[?#]/.test(target) && pathOnly(prev) === target;
}

/**
 * `router.push(href)` nhưng nếu `href` chính là trang ngay trước và còn lịch sử trong web thì lùi một mục: Giỏ → Thanh toán → "Về giỏ" không thành
 * Giỏ → Thanh toán → Giỏ (bản sao), nút Back sau đó không bị dội về Thanh toán.
 */
export function pushOrBack(router: { back: () => void; push: (href: string) => void }, href: string): void {
  if (historyDepth() > 0 && pathMatchesPrevious(href)) router.back();
  else router.push(href);
}

// Chỉ đóng dấu state dạng object (Next luôn truyền object); state null/ngoài ý muốn giữ nguyên để không làm Next hiểu sai mục lịch sử.
const stamp = (state: unknown, depth: number, prev: string | undefined) =>
  state && typeof state === 'object' ? { ...(state as object), [KEY]: depth, ...(prev === undefined ? {} : { [PREV]: prev }) } : state;

const PATCHED = Symbol.for('tubu.history.depth');

export function trackHistoryDepth(): void {
  if (typeof window === 'undefined') return;
  const h = window.history as History & { [PATCHED]?: true };
  if (h[PATCHED]) return;
  h[PATCHED] = true;
  const push = h.pushState;
  const replace = h.replaceState;
  h.pushState = function pushState(this: History, state, unused, url) {
    return push.call(this, stamp(state, historyDepth() + 1, `${window.location.pathname}${window.location.search}`), unused, url);
  };
  h.replaceState = function replaceState(this: History, state, unused, url) {
    const prev = currentState()?.[PREV];
    return replace.call(this, stamp(state, historyDepth(), typeof prev === 'string' ? prev : undefined), unused, url);
  };
}

// Cài ngay khi module được nạp (trước khi React hydrate): lúc hydrate, App Router của Next ghi lại state của mục hiện tại bằng replaceState,
// nếu cài muộn hơn (trong effect) thì F5 ở trang sâu làm mất dấu và nút lùi tưởng chưa có lịch sử.
trackHistoryDepth();
