// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { render, type Rendered } from '@/test-utils/dom';
import { HarvestCelebration } from './harvest-celebration';

// Hộp thu hoạch của khách vãng lai (Mini ↔ web, Wave 84A ↔ 94B): "Đăng nhập Zalo" chạm đúp cùng khung hình chỉ chuyển sang đăng nhập một lần
// (trang cha đóng hộp rồi chuyển sang đăng nhập; hai cú chạm đều thấy nút trước khi hộp đóng thì `onLogin` chạy hai lần).

const base = {
  open: true,
  coupons: [] as string[],
  guest: true,
  certificate: null,
  species: null,
  points: null,
  sprout: false,
  canShare: true,
  couponCapped: null,
  nextTarget: 60,
  onClose: vi.fn(),
  onCopyCoupon: vi.fn(),
  onUseCoupon: vi.fn(),
  shared: false,
  sharing: false,
  onShare: vi.fn(),
};

let mounted: Rendered | null = null;
const qc = new QueryClient();
// Vẽ lại qua cùng QueryClientProvider như `render`: bỏ lớp bọc thì React dựng lại cả cây và cờ khoá (ref) tự về trống, che mất lỗi khoá dính.
const rerender = (ui: React.ReactElement) => act(() => mounted!.root.render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>));
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});
const cta = () => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === gameNewbieCopy.harvest.guestCta)!;
const tapTogether = (el: HTMLElement) =>
  act(() => {
    el.click();
    el.click();
  });

describe('HarvestCelebration: đăng nhập của khách', () => {
  it('hai cú chạm cùng khung hình vào "Đăng nhập Zalo" chỉ gọi onLogin một lần', () => {
    const onLogin = vi.fn();
    mounted = render(<HarvestCelebration {...base} onLogin={onLogin} />);
    tapTogether(cta());
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('hộp mở lại cho lần thu hoạch sau thì bấm được lại, không dính khoá của lần trước', () => {
    const onLogin = vi.fn();
    mounted = render(<HarvestCelebration {...base} onLogin={onLogin} />, qc);
    tapTogether(cta());
    expect(onLogin).toHaveBeenCalledTimes(1);
    rerender(<HarvestCelebration {...base} open={false} onLogin={onLogin} />);
    rerender(<HarvestCelebration {...base} open onLogin={onLogin} />);
    tapTogether(cta());
    expect(onLogin).toHaveBeenCalledTimes(2);
  });
});
