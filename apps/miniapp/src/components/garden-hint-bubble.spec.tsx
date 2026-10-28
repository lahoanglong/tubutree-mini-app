import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GARDEN_HINT_DELAY_MS, GardenHintBubble } from './garden-hint-bubble';
import { GARDEN_HINT_KEY } from '../utils/garden-hint';
import { vi as copy } from '../i18n/vi';

const settle = () =>
  act(() => {
    vi.advanceTimersByTime(GARDEN_HINT_DELAY_MS + 10);
  });

describe('GardenHintBubble — bóng gợi ý tab Vườn Xanh (D6-16)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.removeItem(GARDEN_HINT_KEY);
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem(GARDEN_HINT_KEY);
  });

  it('cao ít nhất 44px để chạm tắt được', () => {
    render(<GardenHintBubble onGardenTab={false} />);
    settle();
    const bubble = screen.getByRole('status');
    expect(bubble).toHaveTextContent(copy.nav.gardenHint);
    expect(Number.parseFloat(bubble.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('tự tắt sau vài giây để không che nội dung phía sau thanh tab', () => {
    render(<GardenHintBubble onGardenTab={false} />);
    settle();
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('chỉ hiện một lần trên mỗi máy', () => {
    const first = render(<GardenHintBubble onGardenTab={false} />);
    settle();
    first.unmount();
    render(<GardenHintBubble onGardenTab={false} />);
    settle();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('chưa hiện ngay khi mở trang: chờ trang vẽ xong để không đè lên màn đầu', () => {
    render(<GardenHintBubble onGardenTab={false} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(localStorage.getItem(GARDEN_HINT_KEY)).toBeNull();
  });

  it('có lớp phủ đang mở thì chưa hiện và chưa đánh dấu "đã xem" (lần mở sau mới thử lại)', () => {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    document.body.appendChild(overlay);
    render(<GardenHintBubble onGardenTab={false} />);
    settle();
    expect(screen.queryByRole('status')).toBeNull();
    expect(localStorage.getItem(GARDEN_HINT_KEY)).toBeNull();
    overlay.remove();
  });

  it('bấm vào bóng mở Vườn Xanh', () => {
    const open = vi.fn();
    render(<GardenHintBubble onGardenTab={false} onOpenGarden={open} />);
    settle();
    fireEvent.click(screen.getByRole('status'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('khách cuộn trang thì bóng tắt ngay, không che nội dung đang đọc', () => {
    render(<GardenHintBubble onGardenTab={false} />);
    settle();
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => {
      document.dispatchEvent(new Event('scroll'));
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
