// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type Rendered } from '@/test-utils/dom';
import { GARDEN_HINT_DELAY_MS, GardenHintBubble } from './garden-hint-bubble';
import { GARDEN_HINT_KEY } from './garden-hint';

// Bóng gợi ý tab Vườn Xanh (Mini ↔ web, Wave 84A ↔ 94B): hai cú chạm trong cùng một tác vụ đều thấy bóng trước khi `setOpen(false)` kịp vẽ,
// nên không có khoá thì đẩy trang hai lần (hai mục lịch sử).

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

let mounted: Rendered | null = null;
const qc = new QueryClient();
// Vẽ lại qua cùng QueryClientProvider như `render`: bỏ lớp bọc thì React dựng lại cả cây và cờ khoá (ref) tự về trống, che mất lỗi khoá dính.
const rerender = (onGardenTab: boolean) => act(() => mounted!.root.render(<QueryClientProvider client={qc}>{<GardenHintBubble onGardenTab={onGardenTab} />}</QueryClientProvider>));
const show = async () => {
  vi.useFakeTimers();
  mounted = render(<GardenHintBubble onGardenTab={false} />, qc);
  act(() => {
    vi.advanceTimersByTime(GARDEN_HINT_DELAY_MS + 10);
  });
  return mounted;
};
const bubble = () => mounted!.container.querySelector<HTMLElement>('[role="status"]');
const tapTogether = (el: HTMLElement) =>
  act(() => {
    el.click();
    el.click();
  });

beforeEach(() => {
  mocks.push.mockReset();
  localStorage.removeItem(GARDEN_HINT_KEY);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  localStorage.removeItem(GARDEN_HINT_KEY);
});

describe('GardenHintBubble: khoá chạm đúp', () => {
  it('hai cú chạm cùng khung hình vào bóng chỉ mở Vườn Xanh một lần và gỡ bóng', async () => {
    await show();
    tapTogether(bubble()!);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/vuon-xanh');
    expect(bubble()).toBeNull();
  });

  it('bóng hiện lại ở lần mở sau (rời tab Vườn rồi quay về) thì bấm mở được lại, không dính khoá của lần trước', async () => {
    await show();
    tapTogether(bubble()!);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    // Lần mở sau: máy chưa ghi được cờ đã xem (bộ nhớ đầy) nên bóng hiện lại.
    rerender(true);
    localStorage.removeItem(GARDEN_HINT_KEY);
    rerender(false);
    act(() => {
      vi.advanceTimersByTime(GARDEN_HINT_DELAY_MS + 10);
    });
    expect(bubble()).not.toBeNull();
    tapTogether(bubble()!);
    expect(mocks.push).toHaveBeenCalledTimes(2);
  });
});
