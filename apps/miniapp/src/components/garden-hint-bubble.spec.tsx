import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GardenHintBubble } from './garden-hint-bubble';
import { GARDEN_HINT_KEY } from '../utils/garden-hint';
import { vi as copy } from '../i18n/vi';

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
    const bubble = screen.getByRole('status');
    expect(bubble).toHaveTextContent(copy.nav.gardenHint);
    expect(Number.parseFloat(bubble.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('tự tắt sau vài giây để không che nội dung phía sau thanh tab', () => {
    render(<GardenHintBubble onGardenTab={false} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('chỉ hiện một lần trên mỗi máy', () => {
    const first = render(<GardenHintBubble onGardenTab={false} />);
    first.unmount();
    render(<GardenHintBubble onGardenTab={false} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
