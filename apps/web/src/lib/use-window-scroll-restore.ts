import { useEffect } from 'react';

const PREFIX = 'tubu_scroll_web:';
const SAVE_DEBOUNCE_MS = 100;
const RETRY_MS = 50;
// Cuộn vô tận nạp từng trang: tới được độ sâu cũ cần vài vòng tải, máy chậm mất vài giây.
const MAX_MS = 4000;
const POP_WINDOW_MS = 2000;

// Mốc popstate gần nhất (Back/Forward). Trang mount ngay sau đó là quay lại; mở mới bằng link không có popstate nên luôn từ đầu trang.
let lastPopAt = 0;
if (typeof window !== 'undefined') window.addEventListener('popstate', () => (lastPopAt = Date.now()));

// Back/Forward về một tài liệu mới (trình duyệt không giữ trang trong bộ nhớ đệm back/forward): không có popstate, loại điều hướng nói lên điều đó.
// Chỉ lần mount đầu của tài liệu được dùng; chuyển trang mềm sau đó không phải Back.
let docNavChecked = false;
function consumeBackForwardLoad(): boolean {
  if (docNavChecked) return false;
  docNavChecked = true;
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return nav?.type === 'back_forward';
  } catch {
    return false;
  }
}

function read(key: string): number | null {
  try {
    const y = Number(sessionStorage.getItem(PREFIX + key));
    return Number.isFinite(y) && y > 0 ? y : null;
  } catch {
    return null;
  }
}

function write(key: string, y: number): void {
  try {
    sessionStorage.setItem(PREFIX + key, String(Math.round(y)));
  } catch {
    /* storage bị chặn: chỉ mất khôi phục cuộn */
  }
}

/**
 * Giữ vị trí cuộn của trang dài tải nội dung ở client (Trang chủ): Back từ PDP về đúng chỗ. Trang còn ngắn lúc mount nên trình duyệt kẹp
 * vị trí; thử lại tới khi đủ cao hoặc quá 4 giây, dừng ngay khi khách chạm/cuộn/gõ phím. Chỉ khôi phục khi mount ngay sau Back/Forward
 * (popstate, hoặc tài liệu mới nạp bằng Back/Forward khi trình duyệt không giữ trang trong bộ nhớ đệm).
 */
export function useWindowScrollRestore(key: string): void {
  useEffect(() => {
    let lastY = window.scrollY;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let restoring = false;
    const onScroll = () => {
      // Cú cuộn do chính lần khôi phục gây ra (có thể đang bị kẹp) không ghi đè vị trí đã lưu.
      if (restoring) return;
      lastY = window.scrollY;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => write(key, lastY), SAVE_DEBOUNCE_MS);
    };

    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const stop = () => {
      stopped = true;
      restoring = false;
      clearTimeout(retryTimer);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('keydown', stop);
    };
    const viaBackDoc = consumeBackForwardLoad();
    const y = viaBackDoc || Date.now() - lastPopAt < POP_WINDOW_MS ? read(key) : null;
    if (y != null) {
      const started = Date.now();
      window.scrollTo(0, y);
      lastY = window.scrollY;
      if (window.scrollY < y - 1) {
        restoring = true;
        window.addEventListener('touchstart', stop, { passive: true });
        window.addEventListener('wheel', stop, { passive: true });
        window.addEventListener('keydown', stop);
        const tick = () => {
          if (stopped) return;
          window.scrollTo(0, y);
          if (window.scrollY >= y - 1 || Date.now() - started >= MAX_MS) return stop();
          retryTimer = setTimeout(tick, RETRY_MS);
        };
        retryTimer = setTimeout(tick, RETRY_MS);
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      const interrupted = restoring;
      stop();
      clearTimeout(saveTimer);
      window.removeEventListener('scroll', onScroll);
      // Rời trang giữa lúc đang khôi phục: giữ vị trí đã lưu, không ghi vị trí bị kẹp.
      if (!interrupted) write(key, lastY);
    };
  }, [key]);
}
