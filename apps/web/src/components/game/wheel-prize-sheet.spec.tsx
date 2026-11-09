// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpinResult } from '@tubutree/app-core/api/game';
import { byText, click, render, type Rendered } from '@/test-utils/dom';

// Sheet thật chỉ dựng khi mở (qua portal). Khung giả này luôn vẽ nội dung và ghi lại `open`, để thử đúng chỗ
// "hộp đang đóng mà nút còn bấm được" (cùng ca với spec của Mini App, nơi hộp còn trên màn suốt hoạt ảnh đóng).
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, title, footer, children }: { open: boolean; title: string; footer: ReactNode; children: ReactNode }) => (
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

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function setup(prize: Prize | null, open = true) {
  const onClose = vi.fn();
  const onUseCoupon = vi.fn();
  const view = (p: Prize | null, o: boolean) => <WheelPrizeSheet prize={p} open={o} onClose={onClose} onUseCoupon={onUseCoupon} />;
  // Cập nhật phải bọc đúng provider mà `render` đã dùng, nếu không React dựng lại cả cây và ref mất theo.
  const qc = new QueryClient();
  const r = render(view(prize, open), qc);
  mounted = r;
  const c = r.container;
  return {
    c,
    onClose,
    onUseCoupon,
    update: (p: Prize | null, o = true) =>
      act(() => {
        r.root.render(<QueryClientProvider client={qc}>{view(p, o)}</QueryClientProvider>);
      }),
  };
}
const btn = (c: HTMLElement, text: string) => byText(c, 'button', text) as HTMLButtonElement;
const line = (c: HTMLElement, re: RegExp) => Array.from(c.querySelectorAll<HTMLElement>('p, div')).find((e) => e.children.length === 0 && re.test(e.textContent ?? ''))!;
const tabular = (el: HTMLElement) => el.classList.contains('tabular-nums');
const twice = (el: HTMLElement) =>
  act(() => {
    el.click();
    el.click();
  });

describe('WheelPrizeSheet (web) — nội dung theo loại giải', () => {
  it('điểm: chúc mừng, dòng "+N Điểm Xanh" dùng số đều, nút "Tuyệt vời!" chỉ đóng hộp', () => {
    const { c, onClose, onUseCoupon } = setup(POINTS);
    expect(c.textContent).toContain('Chúc mừng!');
    expect(c.textContent).toContain('Thưởng Điểm Xanh');
    const l = line(c, /Điểm Xanh đã vào tài khoản/);
    expect(l.textContent).toBe('+12.500 Điểm Xanh đã vào tài khoản');
    expect(tabular(l)).toBe(true);
    click(btn(c, 'Tuyệt vời!'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUseCoupon).not.toHaveBeenCalled();
  });

  it('giọt nước: dòng "+N💧" dùng số đều', () => {
    const { c } = setup(SEEDS);
    const l = line(c, /đã vào bình nước của bạn/);
    expect(l.textContent).toBe('+1.200💧 đã vào bình nước của bạn');
    expect(tabular(l)).toBe(true);
    expect(c.textContent).toContain('Chúc mừng!');
  });

  it('không trúng gì: chỉ động viên, nút "Quay tiếp nhé", dòng động viên không ép số đều', () => {
    const { c } = setup(MISS);
    expect(c.textContent).toContain('Tiếc quá!');
    expect(c.textContent).not.toContain('Chúc mừng!');
    expect(tabular(line(c, /chưa trúng quà/))).toBe(false);
    expect(btn(c, 'Quay tiếp nhé')).not.toBeNull();
    expect(byText(c, 'button', 'Dùng ngay')).toBeNull();
  });

  it.each([
    ['điểm giá trị 0', { ...POINTS, value: 0 }],
    ['giọt nước giá trị 0', { ...SEEDS, value: 0 }],
    ['voucher thiếu thông tin mã', { ...COUPON, coupon: undefined }],
  ])('%s: coi như không trúng', (_label, prize) => {
    const { c } = setup(prize as Prize);
    expect(c.textContent).toContain('Tiếc quá!');
    expect(c.textContent).toContain('Lần này chưa trúng quà, thử lại lần sau nhé!');
  });

  it('voucher: mã, đơn tối thiểu và hạn dùng; hai dòng số dùng số đều, mã thì không', () => {
    const { c } = setup(COUPON);
    expect(tabular(line(c, /^VOUCHER-20K$/))).toBe(false);
    const min = line(c, /Đơn tối thiểu/);
    expect(min.textContent).toMatch(/^Đơn tối thiểu 150\.000/);
    expect(tabular(min)).toBe(true);
    const exp = line(c, /Hạn dùng/);
    expect(exp.textContent).toMatch(/^Hạn dùng \d{2}\/\d{2}\/2026/);
    expect(tabular(exp)).toBe(true);
    expect(c.textContent).toContain('Mã đã vào mục Mã giảm giá của tôi');
    expect(btn(c, 'Dùng ngay')).not.toBeNull();
    expect(btn(c, 'Để sau')).not.toBeNull();
  });

  it('emoji trang trí được ẩn khỏi trình đọc màn hình, cả lúc trúng lẫn lúc trượt (cùng Mini App)', () => {
    const { c, update } = setup(POINTS);
    expect(line(c, /^🎉$/).getAttribute('aria-hidden')).toBe('true');
    update(MISS);
    expect(line(c, /^🍀$/).getAttribute('aria-hidden')).toBe('true');
  });

  it('chưa có giải: không vẽ nội dung giải; khung mặc định theo hướng chúc mừng, không hiện "Tiếc quá!"', () => {
    const { c } = setup(null);
    expect(c.textContent).toContain('Chúc mừng!');
    expect(btn(c, 'Tuyệt vời!')).not.toBeNull();
    expect(c.textContent).not.toContain('🎉');
    expect(c.textContent).not.toContain('🍀');
  });
});

describe('WheelPrizeSheet (web) — nút "Dùng ngay"', () => {
  it('bấm một lần: đóng hộp rồi mới mở màn dùng mã, mỗi việc một lần', () => {
    const { c, onClose, onUseCoupon } = setup(COUPON);
    click(btn(c, 'Dùng ngay'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUseCoupon).toHaveBeenCalledTimes(1);
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onUseCoupon.mock.invocationCallOrder[0]!);
  });

  it('hai cú bấm cùng nhịp: chỉ đóng và dùng mã một lần', () => {
    const { c, onClose, onUseCoupon } = setup(COUPON);
    twice(btn(c, 'Dùng ngay'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUseCoupon).toHaveBeenCalledTimes(1);
  });

  it('hộp đã đóng mà nút còn trên màn: bấm "Dùng ngay" không làm gì', () => {
    const { c, onClose, onUseCoupon, update } = setup(COUPON);
    const b = btn(c, 'Dùng ngay');
    update(COUPON, false);
    expect(c.querySelector('[data-testid="sheet"]')!.getAttribute('data-open')).toBe('false');
    click(b);
    expect(onClose).not.toHaveBeenCalled();
    expect(onUseCoupon).not.toHaveBeenCalled();
  });

  it('khoá giữ nguyên khi chỉ vẽ lại với cùng giải và hộp vẫn mở', () => {
    const { c, onUseCoupon, update } = setup(COUPON);
    click(btn(c, 'Dùng ngay'));
    update(COUPON, true);
    click(btn(c, 'Dùng ngay'));
    expect(onUseCoupon).toHaveBeenCalledTimes(1);
  });

  it('giải mới về khi hộp còn mở: nhả khoá, dùng được mã mới', () => {
    const { c, onUseCoupon, update } = setup(COUPON);
    click(btn(c, 'Dùng ngay'));
    update(COUPON_2, true);
    click(btn(c, 'Dùng ngay'));
    expect(onUseCoupon).toHaveBeenCalledTimes(2);
  });

  it('đóng rồi mở lại cùng giải: nhả khoá, dùng được lần nữa', () => {
    const { c, onUseCoupon, update } = setup(COUPON);
    click(btn(c, 'Dùng ngay'));
    update(COUPON, false);
    update(COUPON, true);
    click(btn(c, 'Dùng ngay'));
    expect(onUseCoupon).toHaveBeenCalledTimes(2);
  });

  it('"Để sau" chỉ đóng hộp, không mở màn dùng mã', () => {
    const { c, onClose, onUseCoupon } = setup(COUPON);
    click(btn(c, 'Để sau'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUseCoupon).not.toHaveBeenCalled();
  });
});
