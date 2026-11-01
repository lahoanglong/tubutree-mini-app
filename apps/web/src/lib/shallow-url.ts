// Đổi địa chỉ trang bằng History API thay cho `router.push/replace`: đổi search params qua router là soft navigation, App Router có thể
// tải lại RSC của trang từ máy chủ chỉ để mở một khối. Next 15 đồng bộ `usePathname`/`useSearchParams` với `history.pushState/replaceState`
// nên màn vẫn đổi mà không gọi máy chủ. `state` luôn là object: `nav-depth` chỉ đóng dấu độ sâu lên state dạng object.

export function shallowPush(url: string, state: Record<string, unknown> = {}): void {
  window.history.pushState(state, '', url);
}

export function shallowReplace(url: string, state: Record<string, unknown> = {}): void {
  window.history.replaceState(state, '', url);
}
