import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SpinResult } from '../../services/game-api';

// Hộp thật dựng bằng ZaUI Sheet + timer và vẫn nằm trên màn suốt hoạt ảnh đóng. Khung giả này luôn vẽ nội dung
// và chỉ ghi lại `open`, để thử đúng chỗ "hộp đang đóng mà nút còn bấm được".
vi.mock('../ui/bottom-sheet', () => ({
  BottomSheet: ({ open, title, footer, children }: { open: boolean; title: string; footer: ReactNode; children: ReactNode }) => (
    <div data-testid="sheet" data-open={String(open)}>
      <h2>{title}</h2>
      {children}
      {footer}
    </div>
  ),
}));

import { WheelPrizeSheet } from './wheel-prize-sheet';

type Prize = SpinResult['prize'];

const POINTS: Prize = { id: 'p1', name: 'Thưởng Điểm Xanh', rewardType: 'POINTS', value: 12_500 };
const SEEDS: Prize = { id: 's1', name: 'Giọt nước may mắn', rewardType: 'SEEDS', value: 1_200 };
const MISS: Prize = { id: 'm1', name: 'Chúc bạn may mắn', rewardType: 'NONE', value: 0 };
const COUPON: Prize = {
  id: 'c1',
  name: 'Voucher giảm 20K',
  rewardType: 'COUPON',
  value: 0,
  coupon: { code: 'VOUCHER-20K', minOrder: 150_000, expiresAt: '2026-12-31T12:00:00.000Z' },
};
const COUPON_2: Prize = { ...COUPON, id: 'c2', coupon: { ...COUPON.coupon!, code: 'VOUCHER-30K' } };

function setup(prize: Prize | null, open = true) {
  const onClose = vi.fn();
  const onUseCoupon = vi.fn();
  const view = (p: Prize | null, o: boolean) => <WheelPrizeSheet prize={p} open={o} onClose={onClose} onUseCoupon={onUseCoupon} />;
  const r = render(view(prize, open));
  return { onClose, onUseCoupon, update: (p: Prize | null, o = true) => r.rerender(view(p, o)) };
}
const numeric = (el: HTMLElement) => el.style.fontVariantNumeric;
const twice = (el: HTMLElement) =>
  act(async () => {
    fireEvent.click(el);
    fireEvent.click(el);
  });

describe('WheelPrizeSheet — nội dung theo loại giải', () => {
  it('điểm: chúc mừng, dòng "+N Điểm Xanh" dùng số đều, nút "Tuyệt vời!" chỉ đóng hộp', () => {
    const { onClose, onUseCoupon } = setup(POINTS);
    expect(screen.getByText('Chúc mừng!')).toBeInTheDocument();
    expect(screen.getByText('Thưởng Điểm Xanh')).toBeInTheDocument();
    const line = screen.getByText(/Điểm Xanh đã vào tài khoản/);
    expect(line).toHaveTextContent('+12.500 Điểm Xanh đã vào tài khoản');
    expect(numeric(line)).toBe('tabular-nums');
    fireEvent.click(screen.getByRole('button', { name: 'Tuyệt vời!' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUseCoupon).not.toHaveBeenCalled();
  });

  it('giọt nước: dòng "+N💧" dùng số đều', () => {
    setup(SEEDS);
    const line = screen.getByText(/đã vào bình nước của bạn/);
    expect(line).toHaveTextContent('+1.200💧 đã vào bình nước của bạn');
    expect(numeric(line)).toBe('tabular-nums');
    expect(screen.getByText('Chúc mừng!')).toBeInTheDocument();
  });

  it('không trúng gì: chỉ động viên, nút "Quay tiếp nhé", dòng động viên không ép số đều', () => {
    setup(MISS);
    expect(screen.getByText('Tiếc quá!')).toBeInTheDocument();
    expect(screen.queryByText('Chúc mừng!')).not.toBeInTheDocument();
    const line = screen.getByText('Lần này chưa trúng quà, thử lại lần sau nhé!');
    expect(numeric(line)).toBe('');
    expect(screen.getByRole('button', { name: 'Quay tiếp nhé' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dùng ngay' })).not.toBeInTheDocument();
  });

  it.each([
    ['điểm giá trị 0', { ...POINTS, value: 0 }],
    ['giọt nước giá trị 0', { ...SEEDS, value: 0 }],
    ['voucher thiếu thông tin mã', { ...COUPON, coupon: undefined }],
  ])('%s: coi như không trúng', (_label, prize) => {
    setup(prize as Prize);
    expect(screen.getByText('Tiếc quá!')).toBeInTheDocument();
    expect(screen.getByText('Lần này chưa trúng quà, thử lại lần sau nhé!')).toBeInTheDocument();
  });

  it('voucher: mã, đơn tối thiểu và hạn dùng; hai dòng số dùng số đều, mã thì không', () => {
    setup(COUPON);
    expect(numeric(screen.getByText('VOUCHER-20K'))).toBe('');
    const min = screen.getByText(/Đơn tối thiểu/);
    expect(min).toHaveTextContent(/Đơn tối thiểu 150\.000/);
    expect(numeric(min)).toBe('tabular-nums');
    const exp = screen.getByText(/Hạn dùng/);
    expect(exp).toHaveTextContent(/Hạn dùng \d{2}\/\d{2}\/2026/);
    expect(numeric(exp)).toBe('tabular-nums');
    expect(screen.getByText('Mã đã vào mục Mã giảm giá của tôi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dùng ngay' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Để sau' })).toBeInTheDocument();
  });

  it('emoji trang trí được ẩn khỏi trình đọc màn hình, cả lúc trúng lẫn lúc trượt', () => {
    const won = setup(POINTS);
    expect(screen.getByText('🎉')).toHaveAttribute('aria-hidden', 'true');
    won.update(MISS);
    expect(screen.getByText('🍀')).toHaveAttribute('aria-hidden', 'true');
  });

  it('chưa có giải: không vẽ nội dung giải; khung mặc định theo hướng chúc mừng, không hiện "Tiếc quá!"', () => {
    setup(null);
    expect(screen.getByText('Chúc mừng!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tuyệt vời!' })).toBeInTheDocument();
    expect(screen.queryByText('🎉')).not.toBeInTheDocument();
    expect(screen.queryByText('🍀')).not.toBeInTheDocument();
  });
});

describe('WheelPrizeSheet — nút "Dùng ngay"', () => {
  it('bấm một lần: đóng hộp rồi mới mở màn dùng mã, mỗi việc một lần', () => {
    const { onClose, onUseCoupon } = setup(COUPON);
    fireEvent.click(screen.getByRole('button', { name: 'Dùng ngay' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUseCoupon).toHaveBeenCalledTimes(1);
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onUseCoupon.mock.invocationCallOrder[0]!);
  });

  it('hai cú chạm cùng nhịp: chỉ đóng và dùng mã một lần', async () => {
    const { onClose, onUseCoupon } = setup(COUPON);
    await twice(screen.getByRole('button', { name: 'Dùng ngay' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUseCoupon).toHaveBeenCalledTimes(1);
  });

  it('hộp đã đóng mà còn nằm trên màn (hoạt ảnh đóng): chạm vào "Dùng ngay" không làm gì', () => {
    const { onClose, onUseCoupon, update } = setup(COUPON);
    const btn = screen.getByRole('button', { name: 'Dùng ngay' });
    update(COUPON, false);
    expect(screen.getByTestId('sheet')).toHaveAttribute('data-open', 'false');
    fireEvent.click(btn);
    expect(onClose).not.toHaveBeenCalled();
    expect(onUseCoupon).not.toHaveBeenCalled();
  });

  it('khoá giữ nguyên khi chỉ vẽ lại với cùng giải và hộp vẫn mở', () => {
    const { onUseCoupon, update } = setup(COUPON);
    fireEvent.click(screen.getByRole('button', { name: 'Dùng ngay' }));
    update(COUPON, true);
    fireEvent.click(screen.getByRole('button', { name: 'Dùng ngay' }));
    expect(onUseCoupon).toHaveBeenCalledTimes(1);
  });

  it('giải mới về khi hộp còn mở: nhả khoá, dùng được mã mới', () => {
    const { onUseCoupon, update } = setup(COUPON);
    fireEvent.click(screen.getByRole('button', { name: 'Dùng ngay' }));
    update(COUPON_2, true);
    fireEvent.click(screen.getByRole('button', { name: 'Dùng ngay' }));
    expect(onUseCoupon).toHaveBeenCalledTimes(2);
  });

  it('đóng rồi mở lại cùng giải: nhả khoá, dùng được lần nữa', () => {
    const { onUseCoupon, update } = setup(COUPON);
    fireEvent.click(screen.getByRole('button', { name: 'Dùng ngay' }));
    update(COUPON, false);
    update(COUPON, true);
    fireEvent.click(screen.getByRole('button', { name: 'Dùng ngay' }));
    expect(onUseCoupon).toHaveBeenCalledTimes(2);
  });

  it('"Để sau" chỉ đóng hộp, không mở màn dùng mã', () => {
    const { onClose, onUseCoupon } = setup(COUPON);
    fireEvent.click(screen.getByRole('button', { name: 'Để sau' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUseCoupon).not.toHaveBeenCalled();
  });
});
