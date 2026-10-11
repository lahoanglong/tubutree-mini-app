import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SpinResult } from '../services/game-api';

/**
 * Đặc tả hành vi vòng quay may mắn (C-076, PC-10a): nút quay khoá đúng lúc, kết quả chỉ hiện khi CẢ
 * backend trả về lẫn hiệu ứng quay đã đủ 3,6 giây, dòng "+N Điểm Xanh" chỉ khi thưởng là điểm, đóng hộp
 * kết quả rồi quay tiếp được. Viết TRƯỚC khi di cư sang DS v2 để chứng minh việc đổi Button/hộp kết quả
 * không đổi điều kiện bật/tắt nút hay số lần gọi API. Chỉ truy vấn theo role/chữ.
 */
const mocks = vi.hoisted(() => ({ haptic: vi.fn() }));
vi.mock('../utils/haptic', () => ({ haptic: mocks.haptic }));

import { WheelOfFortune } from './wheel';

const SPIN_MS = 3600;
const POINTS_PRIZE: SpinResult = { prize: { id: 'p1', name: 'Thưởng 50 Điểm Xanh', rewardType: 'POINTS', value: 50 } };

const spinButton = () => screen.getByRole('button', { name: /Quay ngay|Đang quay/ });

/** Cho microtask (kết quả onSpin) và timer chạy xong; ZaUI Sheet cũng dùng timer cho hoạt ảnh mở/đóng. */
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('WheelOfFortune — nút quay', () => {
  it('lúc rảnh: nhãn có giá Điểm Xanh, nút bật, chưa có hộp kết quả', () => {
    render(<WheelOfFortune cost={20} onSpin={vi.fn()} />);
    expect(spinButton()).toHaveTextContent('Quay ngay (20 Điểm Xanh)');
    expect(spinButton()).toBeEnabled();
    expect(screen.queryByText('Chúc mừng!')).not.toBeInTheDocument();
  });

  it('giá hiển thị đúng theo prop cost', () => {
    render(<WheelOfFortune cost={35} onSpin={vi.fn()} />);
    expect(spinButton()).toHaveTextContent('Quay ngay (35 Điểm Xanh)');
  });

  it('bấm quay: gọi onSpin đúng 1 lần, nhãn đổi "Đang quay..." và nút khoá', async () => {
    const onSpin = vi.fn().mockResolvedValue(POINTS_PRIZE);
    render(<WheelOfFortune cost={20} onSpin={onSpin} />);
    fireEvent.click(spinButton());
    await advance(0);
    expect(onSpin).toHaveBeenCalledTimes(1);
    expect(spinButton()).toHaveTextContent('Đang quay...');
    expect(spinButton()).toBeDisabled();
    await advance(SPIN_MS);
  });

  it('chạm đúp khi đang quay vẫn chỉ gọi onSpin 1 lần', async () => {
    const onSpin = vi.fn().mockResolvedValue(POINTS_PRIZE);
    render(<WheelOfFortune cost={20} onSpin={onSpin} />);
    fireEvent.click(spinButton());
    fireEvent.click(spinButton());
    await advance(1000);
    fireEvent.click(spinButton());
    expect(onSpin).toHaveBeenCalledTimes(1);
    await advance(SPIN_MS);
  });

  it('hai cú chạm trong cùng một khung hình (React chưa kịp khoá nút) vẫn chỉ gọi onSpin 1 lần', async () => {
    const onSpin = vi.fn().mockResolvedValue(POINTS_PRIZE);
    render(<WheelOfFortune cost={20} onSpin={onSpin} />);
    const button = spinButton();
    act(() => {
      button.click();
      button.click();
    });
    expect(onSpin).toHaveBeenCalledTimes(1);
    await advance(SPIN_MS);
  });

  it('bánh xe quay ≥ 5 vòng và dừng ở ô đã chọn (ô 0 → 2160 độ)', async () => {
    const onSpin = vi.fn().mockResolvedValue(POINTS_PRIZE);
    const { container } = render(<WheelOfFortune cost={20} onSpin={onSpin} />);
    expect(container.querySelector('[style*="rotate(0deg)"]')).not.toBeNull();
    fireEvent.click(spinButton());
    await advance(0);
    expect(container.querySelector('[style*="rotate(2160deg)"]')).not.toBeNull();
    await advance(SPIN_MS);
  });

  it('rung nhẹ lúc bắt đầu quay và lúc có kết quả', async () => {
    render(<WheelOfFortune cost={20} onSpin={vi.fn().mockResolvedValue(POINTS_PRIZE)} />);
    fireEvent.click(spinButton());
    await advance(0);
    expect(mocks.haptic).toHaveBeenCalledTimes(1);
    expect(mocks.haptic).toHaveBeenLastCalledWith('medium');
    await advance(SPIN_MS);
    expect(mocks.haptic).toHaveBeenCalledTimes(2);
    expect(mocks.haptic).toHaveBeenLastCalledWith('medium');
  });
});

describe('WheelOfFortune — hộp kết quả', () => {
  it('chỉ hiện khi đủ thời gian quay, dù backend trả về sớm', async () => {
    render(<WheelOfFortune cost={20} onSpin={vi.fn().mockResolvedValue(POINTS_PRIZE)} />);
    fireEvent.click(spinButton());
    await advance(SPIN_MS - 100);
    expect(screen.queryByText('Chúc mừng!')).not.toBeInTheDocument();
    expect(spinButton()).toBeDisabled();
    await advance(200);
    expect(screen.getByText('Chúc mừng!')).toBeInTheDocument();
  });

  it('chỉ hiện khi backend đã trả về, dù hiệu ứng đã hết', async () => {
    let resolveSpin: (r: SpinResult) => void = () => {};
    const onSpin = vi.fn().mockReturnValue(new Promise<SpinResult>((r) => { resolveSpin = r; }));
    render(<WheelOfFortune cost={20} onSpin={onSpin} />);
    fireEvent.click(spinButton());
    await advance(SPIN_MS + 2000);
    expect(screen.queryByText('Chúc mừng!')).not.toBeInTheDocument();
    expect(spinButton()).toBeDisabled();
    resolveSpin(POINTS_PRIZE);
    await advance(0);
    expect(screen.getByText('Chúc mừng!')).toBeInTheDocument();
  });

  it('thưởng điểm: hiện tên quà và dòng "+N Điểm Xanh đã vào tài khoản"; nút quay mở lại', async () => {
    render(<WheelOfFortune cost={20} onSpin={vi.fn().mockResolvedValue(POINTS_PRIZE)} />);
    fireEvent.click(spinButton());
    await advance(SPIN_MS);
    expect(screen.getByText('Thưởng 50 Điểm Xanh')).toBeInTheDocument();
    expect(screen.getByText('+50 Điểm Xanh đã vào tài khoản')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tuyệt vời!' })).toBeInTheDocument();
    expect(spinButton()).toHaveTextContent('Quay ngay (20 Điểm Xanh)');
    expect(spinButton()).toBeEnabled();
  });

  it('thưởng không phải điểm: có tên quà nhưng không có dòng cộng Điểm Xanh', async () => {
    const prize: SpinResult = { prize: { id: 'p2', name: 'Mã giảm giá 10%', rewardType: 'COUPON', value: 10 } };
    render(<WheelOfFortune cost={20} onSpin={vi.fn().mockResolvedValue(prize)} />);
    fireEvent.click(spinButton());
    await advance(SPIN_MS);
    expect(screen.getByText('Mã giảm giá 10%')).toBeInTheDocument();
    expect(screen.queryByText(/đã vào tài khoản/)).not.toBeInTheDocument();
  });

  it('thưởng điểm nhưng giá trị 0: không có dòng cộng Điểm Xanh', async () => {
    const prize: SpinResult = { prize: { id: 'p3', name: 'Chúc may mắn lần sau', rewardType: 'POINTS', value: 0 } };
    render(<WheelOfFortune cost={20} onSpin={vi.fn().mockResolvedValue(prize)} />);
    fireEvent.click(spinButton());
    await advance(SPIN_MS);
    expect(screen.getByText('Chúc may mắn lần sau')).toBeInTheDocument();
    expect(screen.queryByText(/đã vào tài khoản/)).not.toBeInTheDocument();
  });

  it('"Tuyệt vời!" đóng hộp kết quả; sau đó quay lại được và gọi onSpin lần 2', async () => {
    const onSpin = vi.fn().mockResolvedValue(POINTS_PRIZE);
    render(<WheelOfFortune cost={20} onSpin={onSpin} />);
    fireEvent.click(spinButton());
    await advance(SPIN_MS);
    fireEvent.click(screen.getByRole('button', { name: 'Tuyệt vời!' }));
    await advance(500);
    expect(screen.queryByText('Chúc mừng!')).not.toBeInTheDocument();
    expect(spinButton()).toBeEnabled();
    fireEvent.click(spinButton());
    await advance(0);
    expect(onSpin).toHaveBeenCalledTimes(2);
    await advance(SPIN_MS);
  });
});

describe('WheelOfFortune — lỗi', () => {
  it('onSpin lỗi: không có hộp kết quả, nút quay mở lại để thử tiếp', async () => {
    const onSpin = vi.fn().mockRejectedValueOnce(new Error('Không đủ Điểm Xanh')).mockResolvedValue(POINTS_PRIZE);
    render(<WheelOfFortune cost={20} onSpin={onSpin} />);
    fireEvent.click(spinButton());
    await advance(SPIN_MS);
    expect(screen.queryByText('Chúc mừng!')).not.toBeInTheDocument();
    expect(spinButton()).toHaveTextContent('Quay ngay (20 Điểm Xanh)');
    expect(spinButton()).toBeEnabled();
    fireEvent.click(spinButton());
    await advance(SPIN_MS);
    expect(onSpin).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Chúc mừng!')).toBeInTheDocument();
  });
});
