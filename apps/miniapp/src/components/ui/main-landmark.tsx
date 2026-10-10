import type { ReactNode } from 'react';

/** Landmark `<main>` duy nhất cho nội dung route. zmp-ui `Page`/`Box` render `<div>` nên không trang
 * nào tự có landmark (axe landmark-one-main, WCAG 1.3.1). `display: contents` để thẻ không sinh
 * hộp — chuỗi flex/height và định vị tuyệt đối của `.zaui-page` giữ nguyên như khi chưa có thẻ. */
export function MainLandmark({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" style={{ display: 'contents' }}>
      {children}
    </main>
  );
}
