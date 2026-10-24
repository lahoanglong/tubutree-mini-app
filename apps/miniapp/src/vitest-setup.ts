// Nạp matcher jest-dom (toBeInTheDocument, ...) cho mọi test component (*.spec.tsx).
// Subpath /vitest tự gọi expect.extend() bằng `expect` của vitest — không cần import thủ công
// ở từng file spec.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// zmp-ui Sheet khi đóng đặt một setTimeout 200 ms (sheet/content.js, ANIMATION_DURATION) và không bao giờ huỷ. Timer chạy sau
// khi vitest đóng jsdom thì gọi setState, React 18 đọc window.event và ném "window is not defined" (lỗi chưa xử lý, rải rác).
// Huỷ các timer đó ở cuối mỗi test: cây đã gỡ nên không còn gì để chúng cập nhật.
if (typeof window !== 'undefined') {
  const sheetTimers = new Set<ReturnType<typeof setTimeout>>();
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const fromSheet = ms === 200 && (new Error().stack ?? '').includes('components/sheet/content');
    if (!fromSheet) return realSetTimeout(fn, ms, ...args);
    const handle = realSetTimeout(
      (...a: unknown[]) => {
        sheetTimers.delete(handle);
        fn(...a);
      },
      ms,
      ...args,
    );
    sheetTimers.add(handle);
    return handle;
  }) as typeof setTimeout;
  afterEach(() => {
    for (const h of sheetTimers) realClearTimeout(h);
    sheetTimers.clear();
  });
}
