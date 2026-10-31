import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';
import { useNavigationType } from './use-navigation-type';

export const SCROLL_KEY_PREFIX = 'tubu_scroll:';
const SAVE_DEBOUNCE_MS = 100;

function scrollerOf(anchor: HTMLElement | null): HTMLElement | null {
  return (anchor?.closest('.zaui-page') as HTMLElement | null) ?? null;
}

function save(key: string, y: number): void {
  try {
    sessionStorage.setItem(SCROLL_KEY_PREFIX + key, String(Math.round(y)));
  } catch {
    /* storage bị chặn — chỉ mất tính năng khôi phục */
  }
}

function load(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY_PREFIX + key);
    const y = raw == null ? NaN : Number(raw);
    return Number.isFinite(y) && y > 0 ? y : null;
  } catch {
    return null;
  }
}

/**
 * Giữ vị trí cuộn của trang danh sách theo khoá URL (spec 5b.2) — quay lại từ PDP về đúng chỗ.
 * Không dùng `restoreScrollOnBack` của zmp Page: nó khoá theo `location.key`, mà mỗi lần đổi bộ
 * lọc bằng `replace` lại sinh key mới. `anchorRef` phải nằm TRONG `<Page>` (scroller = .zaui-page).
 *
 * Quy tắc khôi phục: CHỈ khi trang được mở bằng điều hướng kiểu POP (nút Back/forward — hoặc tải
 * lại trang) tới khoá đó. Mở mới bằng PUSH/REPLACE (bấm link vào Duyệt) luôn bắt đầu từ đầu trang
 * dù sessionStorage còn vị trí cũ của cùng URL. Loại điều hướng chốt ở lần mount (thay đổi khoá
 * khi đang ở trang là `replace` đổi bộ lọc → không bao giờ khôi phục). Khôi phục MỘT lần mỗi khoá,
 * và chỉ khi danh sách đã có dữ liệu (`ready`).
 *
 * Đổi khoá ngay trong trang (hub ↔ danh sách; trang không bị gỡ): loại điều hướng của LẦN ĐỔI ĐÓ quyết định. PUSH (chạm ô danh
 * mục) → đầu trang; POP (Back) → khôi phục vị trí đã lưu của khoá mới; REPLACE (đổi sắp xếp, gỡ chip) → giữ nguyên vị trí.
 */
export function useScrollRestoration(key: string, ready: boolean): { anchorRef: RefObject<HTMLDivElement> } {
  const anchorRef = useRef<HTMLDivElement>(null);
  const navType = useNavigationType();
  // Khoá được phép khôi phục: chỉ khoá lúc mount, và chỉ khi mount bằng POP.
  const eligibleKey = useRef<string | null>(navType === 'POP' ? key : null);
  const restoredFor = useRef<string | null>(null);
  // Vị trí cuộn gần nhất đã thấy — phòng khi phần tử đã bị gỡ khỏi DOM lúc cleanup (scrollTop = 0).
  const lastY = useRef(0);
  // Vị trí đọc ngay khi khoá đổi, TRƯỚC khi commit: nội dung mới có thể ngắn hơn và trình duyệt kẹp `scrollTop` về cuối trang mới.
  const prevKey = useRef(key);
  const leavingY = useRef<number | null>(null);
  if (prevKey.current !== key) {
    leavingY.current = scrollerOf(anchorRef.current)?.scrollTop ?? null;
    prevKey.current = key;
  }

  // Layout effect (không phải useEffect) để cleanup khi unmount chạy TRƯỚC khi React gỡ DOM của trang.
  useLayoutEffect(() => {
    const scroller = scrollerOf(anchorRef.current);
    if (!scroller) return;
    lastY.current = scroller.scrollTop;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      lastY.current = scroller.scrollTop;
      clearTimeout(timer);
      timer = setTimeout(() => save(key, lastY.current), SAVE_DEBOUNCE_MS);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      scroller.removeEventListener('scroll', onScroll);
      // Rời trang / đổi khoá: lưu vị trí của khoá CŨ ngay.
      save(key, leavingY.current ?? (scroller.isConnected ? scroller.scrollTop : lastY.current));
      leavingY.current = null;
    };
  }, [key]);

  // Theo từng lượt điều hướng (`location.key`), không chỉ theo khoá: zmp-ui khoá phần tử trang theo pathname, nên PUSH lại đúng URL
  // lúc trang cũ còn đang trượt ra (Back rồi chạm ngay) dùng lại chính phần tử đó với scrollTop cũ, khoá không đổi.
  const navKey = useLocation().key;
  const seenNav = useRef<string | null>(null);
  useLayoutEffect(() => {
    const first = seenNav.current === null;
    seenNav.current = navKey;
    if (first) return;
    restoredFor.current = null;
    if (navType === 'POP') {
      eligibleKey.current = key;
      return;
    }
    if (navType !== 'PUSH') return;
    const scroller = scrollerOf(anchorRef.current);
    if (scroller) scroller.scrollTop = 0;
    lastY.current = 0;
    // navType cố ý không nằm trong deps: chỉ đọc nó đúng lúc điều hướng.
  }, [key, navKey]);

  // Layout effect của trang chạy SAU layout effect của <Page> con (Page tự cuộn về 0 khi mount).
  useLayoutEffect(() => {
    if (!ready || restoredFor.current === key) return;
    restoredFor.current = key;
    if (eligibleKey.current !== key) return;
    const scroller = scrollerOf(anchorRef.current);
    const y = load(key);
    if (scroller && y != null) {
      scroller.scrollTop = y;
      lastY.current = y;
    }
  }, [key, ready]);

  return { anchorRef };
}
