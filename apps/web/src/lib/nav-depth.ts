// Độ sâu điều hướng trong web, ghi thẳng vào history.state của từng mục lịch sử.
// history.length không dùng được (tính cả các mục trước khi khách vào site) và bộ đếm popstate không phân biệt Back với Forward hay replace với push.
// Mỗi pushState/replaceState đi qua đây đều được đóng dấu: push = độ sâu hiện tại + 1, replace = giữ nguyên. Back/Forward/F5 đứng lại đúng mục
// đã đóng dấu nên không cần đoán. Mục chưa có dấu (vào thẳng link, tab mới, trang ngoài Next) tính độ sâu 0.
const KEY = 'tubuDepth';

export function historyDepth(): number {
  const s: unknown = typeof window === 'undefined' ? null : window.history.state;
  const n = s && typeof s === 'object' ? (s as Record<string, unknown>)[KEY] : undefined;
  return typeof n === 'number' && n > 0 ? n : 0;
}

// Chỉ đóng dấu state dạng object (Next luôn truyền object); state null/ngoài ý muốn giữ nguyên để không làm Next hiểu sai mục lịch sử.
const stamp = (state: unknown, depth: number) =>
  state && typeof state === 'object' ? { ...(state as object), [KEY]: depth } : state;

const PATCHED = Symbol.for('tubu.history.depth');

export function trackHistoryDepth(): void {
  if (typeof window === 'undefined') return;
  const h = window.history as History & { [PATCHED]?: true };
  if (h[PATCHED]) return;
  h[PATCHED] = true;
  const push = h.pushState;
  const replace = h.replaceState;
  h.pushState = function pushState(this: History, state, unused, url) {
    return push.call(this, stamp(state, historyDepth() + 1), unused, url);
  };
  h.replaceState = function replaceState(this: History, state, unused, url) {
    return replace.call(this, stamp(state, historyDepth()), unused, url);
  };
}

// Cài ngay khi module được nạp (trước khi React hydrate): lúc hydrate, App Router của Next ghi lại state của mục hiện tại bằng replaceState,
// nếu cài muộn hơn (trong effect) thì F5 ở trang sâu làm mất dấu và nút lùi tưởng chưa có lịch sử.
trackHistoryDepth();
