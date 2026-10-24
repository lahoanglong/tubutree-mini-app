import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BottomSheet } from './components/ui/bottom-sheet';

// vitest-setup.ts huỷ timer 200 ms của zmp-ui Sheet bằng cách nhận ra nó qua thời lượng và đường dẫn trong stack. Nếu zmp-ui đổi
// thời lượng hoặc tên tệp, bộ nhận ra thành no-op âm thầm và lỗi "window is not defined" ngẫu nhiên quay lại.
describe('canary: vitest-setup.ts nhận ra timer đóng của zmp-ui Sheet', () => {
  it('đóng Sheet thì setup đã theo dõi ít nhất một timer', () => {
    const stats = (globalThis as { __sheetTimerStats?: { tracked: number } }).__sheetTimerStats;
    expect(stats, 'vitest-setup.ts không bật bộ theo dõi timer').toBeDefined();
    const before = stats!.tracked;
    const ui = (open: boolean) => (
      <BottomSheet open={open} onClose={() => undefined} title="canary">
        <p>nội dung</p>
      </BottomSheet>
    );
    const { rerender } = render(ui(true));
    expect(screen.getByText('nội dung')).toBeInTheDocument();
    rerender(ui(false));
    expect(
      stats!.tracked,
      'zmp-ui Sheet không còn đặt setTimeout 200 ms từ sheet/content: sửa bộ nhận ra trong src/vitest-setup.ts',
    ).toBeGreaterThan(before);
  });
});
