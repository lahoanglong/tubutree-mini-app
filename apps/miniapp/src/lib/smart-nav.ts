import { useCallback } from 'react';
import { useLocation, useNavigate } from 'zmp-ui';
import { isRootPath } from '../components/nav-config';

export { isRootPath };

/** Phần dùng chung của `NavigateFunction` (react-router): đi tới đường dẫn, hoặc lùi/tiến theo số bước. */
export interface NavigateLike {
  (to: string, options?: { replace?: boolean; state?: unknown }): void;
  (delta: number): void;
}

export interface SmartNavigateOptions {
  replace?: boolean;
  state?: unknown;
  /** Trang ngay trước trang hiện tại trong lịch sử. Bỏ trống thì đọc từ vết `recordVisit`. */
  prevPath?: string;
}

/** Vị trí của mục lịch sử hiện tại do react-router ghi vào `history.state.idx`; 0 = mục đầu của phiên (mở thẳng link Zalo/QR). */
export function historyIdx(): number {
  if (typeof window === 'undefined') return 0;
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' && idx > 0 ? idx : 0;
}

export const canPop = (): boolean => historyIdx() > 0;

// Vết đường dẫn theo `idx`. Chỉ nằm trong bộ nhớ: nạp lại trang mất vết thì `smartNavigate` rơi về đẩy trang mới, không sai gì thêm.
const trail = new Map<number, string>();

export function recordVisit(fullPath: string): void {
  trail.set(historyIdx(), fullPath);
}

export function previousPath(): string | undefined {
  const idx = historyIdx();
  return idx > 0 ? trail.get(idx - 1) : undefined;
}

/** Xoá vết (dùng cho test). */
export function resetNavTrail(): void {
  trail.clear();
}

const pathOnly = (p: string): string => p.split(/[?#]/)[0] ?? p;

/** Đích không kèm `?query` khớp trang trước theo pathname; đích có query phải khớp đủ để không lùi nhầm sang tab khác của cùng trang. */
function sameTarget(prev: string, target: string): boolean {
  if (prev === target) return true;
  return !/[?#]/.test(target) && pathOnly(prev) === target;
}

/**
 * Nút lùi: có lịch sử trước đó trong phiên thì lùi THẬT một mục (`navigate(-1)`), không đẩy thêm mục mới (Hồ sơ → Ví → Lùi không được thành
 * Hồ sơ → Ví → Hồ sơ). Mở thẳng trang con (idx 0) thì đi tới `fallbackPath` bằng `replace` để bấm tiếp còn leo lên được.
 */
export function smartBack(navigate: NavigateLike, fallbackPath = '/'): void {
  if (canPop()) navigate(-1);
  else navigate(fallbackPath, { replace: true });
}

/**
 * Đi tới `targetPath` mà không chồng bản sao vào lịch sử:
 * - đích là tab gốc của thanh đáy và đang ở một tab gốc khác (hoặc cùng trang): thay mục hiện tại;
 * - đích chính là trang ngay trước (Giỏ → Thanh toán → Giỏ, Học viện → CTV → Học viện) và còn lịch sử: lùi một mục;
 * - còn lại đẩy trang mới như thường. Có `state` hoặc `replace` tường minh thì giữ đúng ý người gọi.
 */
export function smartNavigate(navigate: NavigateLike, currentPath: string, targetPath: string, options: SmartNavigateOptions = {}): void {
  const { prevPath = previousPath(), ...nav } = options;
  const target = pathOnly(targetPath);
  if (nav.replace === undefined && (target === currentPath || (isRootPath(target) && isRootPath(currentPath)))) {
    navigate(targetPath, { ...nav, replace: true });
    return;
  }
  if (nav.replace === undefined && nav.state === undefined && canPop() && prevPath !== undefined && sameTarget(prevPath, targetPath)) {
    navigate(-1);
    return;
  }
  // Không có tuỳ chọn thì gọi đúng như `navigate(to)` trần (mock và nhật ký điều hướng cũ không phải đổi).
  if (Object.keys(nav).length === 0) navigate(targetPath);
  else navigate(targetPath, nav);
}

/** `navigate` của zmp-ui đã bọc `smartNavigate`: `go('/cart')`. */
export function useSmartNavigate(): (targetPath: string, options?: SmartNavigateOptions) => void {
  const navigate = useNavigate() as unknown as NavigateLike;
  const { pathname } = useLocation();
  return useCallback((targetPath, options) => smartNavigate(navigate, pathname, targetPath, options), [navigate, pathname]);
}
