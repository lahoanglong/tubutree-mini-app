// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ auth: { user: null as null | { referralCode: string } }, offer: null as null | { amount: number; minOrder: number } }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/use-welcome-offer', () => ({ useWelcomeOffer: () => mocks.offer }));

import ShareButton from './share-button';

let mounted: Rendered[] = [];
const mount = () => {
  const r = render(<ShareButton title="Dầu gội bồ kết" path="/san-pham/dau-goi" />);
  mounted.push(r);
  return r;
};
const setNav = (props: { share?: unknown; writeText?: unknown }) => {
  Object.defineProperty(navigator, 'share', { value: props.share, configurable: true });
  Object.defineProperty(navigator, 'clipboard', { value: props.writeText ? { writeText: props.writeText } : undefined, configurable: true });
};

beforeEach(() => {
  mocks.auth = { user: null };
  mocks.offer = null;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  setNav({});
});

describe('ShareButton', () => {
  it('có Web Share API: mở hộp chia sẻ với tên và link sản phẩm', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNav({ share });
    const { container } = mount();
    click(byText(container, 'button', 'Chia sẻ'));
    await flush();
    expect(share).toHaveBeenCalledWith({ title: 'Dầu gội bồ kết', text: 'Tubu Tree tặng khách mới mã giảm giá cho đơn đầu', url: `${window.location.origin}/san-pham/dau-goi` });
  });

  it('có mã chào mừng thật và mô tả ngắn: lời kèm mở bằng ưu đãi rồi mô tả', async () => {
    mocks.offer = { amount: 30000, minOrder: 199000 };
    const share = vi.fn().mockResolvedValue(undefined);
    setNav({ share });
    const r = render(<ShareButton title="Dầu gội bồ kết" path="/san-pham/dau-goi" description="Sạch dịu nhẹ" />);
    mounted.push(r);
    click(byText(r.container, 'button', 'Chia sẻ'));
    await flush();
    expect(share).toHaveBeenCalledWith({ title: 'Dầu gội bồ kết', text: 'Tubu Tree tặng khách mới mã 30.000đ cho đơn đầu từ 199k. Sạch dịu nhẹ', url: `${window.location.origin}/san-pham/dau-goi` });
  });

  it('khách đã đăng nhập: link kèm mã giới thiệu của họ', async () => {
    mocks.auth = { user: { referralCode: 'AN 1' } };
    const share = vi.fn().mockResolvedValue(undefined);
    setNav({ share });
    const { container } = mount();
    click(byText(container, 'button', 'Chia sẻ'));
    await flush();
    expect(share).toHaveBeenCalledWith({ title: 'Dầu gội bồ kết', text: 'Tubu Tree tặng khách mới mã giảm giá cho đơn đầu', url: `${window.location.origin}/san-pham/dau-goi?ref=AN%201` });
  });

  it('không có Web Share API: sao chép link và báo "Đã sao chép"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNav({ writeText });
    const { container } = mount();
    click(byText(container, 'button', 'Chia sẻ'));
    await flush();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/san-pham/dau-goi`);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Đã sao chép liên kết sản phẩm.');
  });

  it('khách đóng hộp chia sẻ (AbortError): không sao chép thay, không báo lỗi', async () => {
    const writeText = vi.fn();
    setNav({ share: vi.fn().mockRejectedValue(new DOMException('x', 'AbortError')), writeText });
    const { container } = mount();
    click(byText(container, 'button', 'Chia sẻ'));
    await flush();
    expect(writeText).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('Web Share API lỗi khác: rơi về sao chép link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNav({ share: vi.fn().mockRejectedValue(new Error('NotAllowedError')), writeText });
    const { container } = mount();
    click(byText(container, 'button', 'Chia sẻ'));
    await flush();
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('không chia sẻ cũng không sao chép được: nói thẳng để khách tự chép', async () => {
    setNav({});
    const { container } = mount();
    click(byText(container, 'button', 'Chia sẻ'));
    await flush();
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/Không sao chép được/);
  });
});

describe('ShareButton: khoá chạm đúp (W79B, Mini ↔ web)', () => {
  const pending = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  it('hộp chia sẻ đang mở (Promise chưa xong): chạm lại không mở chồng; nút aria-busy + aria-disabled, không disabled; đóng hộp thì chạm lại được', async () => {
    const d = pending();
    const share = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue(undefined);
    setNav({ share });
    const { container } = mount();
    const button = byText(container, 'button', 'Chia sẻ') as HTMLButtonElement;
    await act(async () => {
      button.click();
      button.click();
    });
    expect(share).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
    await act(async () => d.resolve());
    expect(button.hasAttribute('aria-busy')).toBe(false);
    click(button);
    await flush();
    expect(share).toHaveBeenCalledTimes(2);
  });

  it('sao chép lỗi hay khách đóng hộp (AbortError): khoá nhả, nút không chết', async () => {
    const share = vi.fn().mockRejectedValueOnce(new DOMException('x', 'AbortError')).mockResolvedValue(undefined);
    setNav({ share });
    const { container } = mount();
    const button = byText(container, 'button', 'Chia sẻ') as HTMLButtonElement;
    click(button);
    await flush();
    click(button);
    await flush();
    expect(share).toHaveBeenCalledTimes(2);
  });
});
