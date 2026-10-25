import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SpinResult } from '../services/game-api';
import { useWheelPrize } from './game/use-wheel-prize';
import { WheelPrizeSheet } from './game/wheel-prize-sheet';
import { WHEEL_SLOTS, slotUnderPointer } from '@tubutree/app-core/game-wheel';

/**
 * Đặc tả hành vi vòng quay may mắn (C-076, PC-10a): nút quay khoá đúng lúc, kết quả chỉ hiện khi CẢ
 * backend trả về lẫn hiệu ứng quay đã đủ 3,6 giây, dòng "+N Điểm Xanh" chỉ khi thưởng là điểm, đóng hộp
 * kết quả rồi quay tiếp được. Viết TRƯỚC khi di cư sang DS v2 để chứng minh việc đổi Button/hộp kết quả
 * không đổi điều kiện bật/tắt nút hay số lần gọi API. Chỉ truy vấn theo role/chữ.
 */
const mocks = vi.hoisted(() => ({ haptic: vi.fn() }));
vi.mock('../utils/haptic', () => ({ haptic: mocks.haptic }));

import { WheelOfFortune as Wheel } from './wheel';

/** Vòng quay + hộp kết quả nối đúng như trang Vườn Xanh (hộp do cấp trang dựng, không còn nằm trong vòng quay). */
function WheelOfFortune({
  cost,
  onSpin,
  onUseCoupon = () => {},
}: {
  cost: number;
  onSpin: () => Promise<SpinResult>;
  onUseCoupon?: () => void;
}) {
  const { onResult, sheet } = useWheelPrize();
  return (
    <>
      <Wheel cost={cost} onSpin={onSpin} onResult={onResult} />
      <WheelPrizeSheet {...sheet} onUseCoupon={onUseCoupon} />
    </>
  );
}

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

  it('giá lớn có dấu phân cách hàng nghìn: 1.250.000 chứ không phải 1250000', () => {
    render(<WheelOfFortune cost={1_250_000} onSpin={vi.fn()} />);
    expect(spinButton()).toHaveTextContent('Quay ngay (1.250.000 Điểm Xanh)');
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

  const wheelAngle = (container: HTMLElement) => {
    const el = [...container.querySelectorAll<HTMLElement>('[style*="rotate("]')].find((e) => e.style.transition !== undefined && /^rotate\(/.test(e.style.transform));
    return Number(/^rotate\((-?[\d.]+)deg\)/.exec(el?.style.transform ?? '')?.[1] ?? NaN);
  };
  const prizeOf = (rewardType: string, value: number): SpinResult => ({ prize: { id: 'x', name: 'Giải', rewardType, value } });

  it('bánh xe quay ≥ 5 vòng và kim dừng ở ô đúng loại giải API trả về', async () => {
    for (const [result, kind] of [
      [POINTS_PRIZE, 'POINTS'],
      [prizeOf('SEEDS', 30), 'SEEDS'],
      [prizeOf('NONE', 0), 'NONE'],
      [prizeOf('LẠ', 9), 'NONE'],
    ] as const) {
      const { container, unmount } = render(<WheelOfFortune cost={20} onSpin={vi.fn().mockResolvedValue(result)} />);
      expect(wheelAngle(container)).toBe(0);
      fireEvent.click(spinButton());
      await advance(0);
      const angle = wheelAngle(container);
      expect(angle).toBeGreaterThanOrEqual(1800);
      expect(WHEEL_SLOTS[slotUnderPointer(angle)]!.kind).toBe(kind);
      await advance(SPIN_MS);
      unmount();
    }
  });

  it('lỗi từ API: bánh xe đứng yên, không có hộp kết quả, nút quay mở lại', async () => {
    const { container } = render(<WheelOfFortune cost={20} onSpin={vi.fn().mockRejectedValue(new Error('nope'))} />);
    fireEvent.click(spinButton());
    await advance(SPIN_MS);
    expect(wheelAngle(container)).toBe(0);
    expect(screen.queryByText('Chúc mừng!')).not.toBeInTheDocument();
    expect(spinButton()).toBeEnabled();
  });

  it('chạm vào chữ QUAY ở giữa bánh xe quay như nút chính', async () => {
    const onSpin = vi.fn().mockResolvedValue(POINTS_PRIZE);
    render(<WheelOfFortune cost={20} onSpin={onSpin} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quay vòng quay' }));
    await advance(0);
    expect(onSpin).toHaveBeenCalledTimes(1);
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
    await advance(SPIN_MS);
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

  it('thưởng điểm lớn có dấu phân cách hàng nghìn', async () => {
    const prize: SpinResult = { prize: { id: 'p3', name: 'Giải đặc biệt', rewardType: 'POINTS', value: 12_500 } };
    render(<WheelOfFortune cost={20} onSpin={vi.fn().mockResolvedValue(prize)} />);
    fireEvent.click(spinButton());
    await advance(SPIN_MS);
    expect(screen.getByText('+12.500 Điểm Xanh đã vào tài khoản')).toBeInTheDocument();
  });

  it('thưởng không phải điểm: có tên quà nhưng không có dòng cộng Điểm Xanh', async () => {
    const prize: SpinResult = { prize: { id: 'p2', name: 'Mã giảm giá 10%', rewardType: 'COUPON', value: 10 } };
    render(<WheelOfFortune cost={20} onSpin={vi.fn().mockResolvedValue(prize)} />);
    fireEvent.click(spinButton());
    await advance(SPIN_MS);
    expect(screen.getByText('Mã giảm giá 10%')).toBeInTheDocument();
    expect(screen.queryByText(/đã vào tài khoản/)).not.toBeInTheDocument();
  });

  it('thưởng điểm nhưng giá trị 0: không chúc mừng, không có dòng cộng Điểm Xanh', async () => {
    const prize: SpinResult = { prize: { id: 'p3', name: 'Chúc may mắn lần sau', rewardType: 'POINTS', value: 0 } };
    render(<WheelOfFortune cost={20} onSpin={vi.fn().mockResolvedValue(prize)} />);
    fireEvent.click(spinButton());
    await advance(SPIN_MS);
    expect(screen.getByText('Chúc may mắn lần sau')).toBeInTheDocument();
    expect(screen.queryByText('Chúc mừng!')).not.toBeInTheDocument();
    expect(screen.queryByText('🎉')).not.toBeInTheDocument();
    expect(screen.queryByText(/đã vào tài khoản/)).not.toBeInTheDocument();
  });

  // R2-ENGAGE-6
  it('không trúng gì (NONE): câu động viên, không "Chúc mừng!", không pháo hoa, nút đóng "Quay tiếp nhé"', async () => {
    const prize: SpinResult = { prize: { id: 'p8', name: 'Chúc may mắn lần sau', rewardType: 'NONE', value: 0 } };
    render(<WheelOfFortune cost={20} onSpin={vi.fn().mockResolvedValue(prize)} />);
    fireEvent.click(spinButton());
    await advance(SPIN_MS);
    expect(screen.queryByText('Chúc mừng!')).not.toBeInTheDocument();
    expect(screen.queryByText('🎉')).not.toBeInTheDocument();
    expect(screen.getByText('Lần này chưa trúng quà, thử lại lần sau nhé!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quay tiếp nhé' })).toBeInTheDocument();
  });

  it('giải hạt (SEEDS): nói rõ số giọt nước đã cộng vào bình', async () => {
    const prize: SpinResult = { prize: { id: 'p5', name: '30 💧', rewardType: 'SEEDS', value: 30 } };
    render(<WheelOfFortune cost={20} onSpin={vi.fn().mockResolvedValue(prize)} />);
    fireEvent.click(spinButton());
    await advance(SPIN_MS);
    expect(screen.getByText('Chúc mừng!')).toBeInTheDocument();
    expect(screen.getByText('+30💧 đã vào bình nước của bạn')).toBeInTheDocument();
  });

  it('voucher (COUPON): hiện mã, đơn tối thiểu, hạn dùng; "Dùng ngay" đóng hộp và gọi onUseCoupon', async () => {
    const prize: SpinResult = {
      prize: {
        id: 'p4',
        name: 'Voucher 20k',
        rewardType: 'COUPON',
        value: 20000,
        coupon: { code: 'GAME20000-ABCDE-1234', minOrder: 120000, expiresAt: '2026-11-13T09:00:00.000Z' },
      },
    };
    const onUseCoupon = vi.fn();
    render(<WheelOfFortune cost={20} onSpin={vi.fn().mockResolvedValue(prize)} onUseCoupon={onUseCoupon} />);
    fireEvent.click(spinButton());
    await advance(SPIN_MS);
    expect(screen.getByText('Chúc mừng!')).toBeInTheDocument();
    expect(screen.getByText('GAME20000-ABCDE-1234')).toBeInTheDocument();
    expect(screen.getByText('Đơn tối thiểu 120.000đ')).toBeInTheDocument();
    expect(screen.getByText(/Hạn dùng \d{2}\/\d{2}\/2026/)).toBeInTheDocument();
    expect(screen.getByText('Mã đã vào mục Mã giảm giá của tôi')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dùng ngay' }));
    await advance(500);
    expect(onUseCoupon).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Chúc mừng!')).not.toBeInTheDocument();
  });

  it('voucher: "Để sau" chỉ đóng hộp, không điều hướng', async () => {
    const prize: SpinResult = {
      prize: {
        id: 'p4', name: 'Voucher 20k', rewardType: 'COUPON', value: 20000,
        coupon: { code: 'GAME20000-ABCDE-1234', minOrder: 120000, expiresAt: '2026-11-13T09:00:00.000Z' },
      },
    };
    const onUseCoupon = vi.fn();
    render(<WheelOfFortune cost={20} onSpin={vi.fn().mockResolvedValue(prize)} onUseCoupon={onUseCoupon} />);
    fireEvent.click(spinButton());
    await advance(SPIN_MS);
    fireEvent.click(screen.getByRole('button', { name: 'Để sau' }));
    await advance(500);
    expect(onUseCoupon).not.toHaveBeenCalled();
    expect(screen.queryByText('GAME20000-ABCDE-1234')).not.toBeInTheDocument();
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

describe('WheelOfFortune — báo kết quả cho cấp trang', () => {
  it('bắt đầu quay: onResult(null); đủ 3,6 giây và backend đã trả về: onResult(prize) đúng một lần', async () => {
    const onResult = vi.fn();
    render(<Wheel cost={20} onSpin={vi.fn().mockResolvedValue(POINTS_PRIZE)} onResult={onResult} />);
    fireEvent.click(spinButton());
    await advance(0);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenLastCalledWith(null);
    await advance(SPIN_MS - 100);
    expect(onResult).toHaveBeenCalledTimes(1);
    await advance(200);
    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenLastCalledWith(POINTS_PRIZE.prize);
  });

  it('onSpin lỗi: chỉ có onResult(null) lúc bắt đầu, không bao giờ có prize', async () => {
    const onResult = vi.fn();
    render(<Wheel cost={20} onSpin={vi.fn().mockRejectedValue(new Error('Không đủ Điểm Xanh'))} onResult={onResult} />);
    fireEvent.click(spinButton());
    await advance(SPIN_MS);
    expect(onResult.mock.calls).toEqual([[null]]);
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
