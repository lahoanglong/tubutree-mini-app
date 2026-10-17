// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ auth: { user: null as null | { referralCode: string } } }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));

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
    expect(share).toHaveBeenCalledWith({ title: 'Dầu gội bồ kết', url: `${window.location.origin}/san-pham/dau-goi` });
  });

  it('khách đã đăng nhập: link kèm mã giới thiệu của họ', async () => {
    mocks.auth = { user: { referralCode: 'AN 1' } };
    const share = vi.fn().mockResolvedValue(undefined);
    setNav({ share });
    const { container } = mount();
    click(byText(container, 'button', 'Chia sẻ'));
    await flush();
    expect(share).toHaveBeenCalledWith({ title: 'Dầu gội bồ kết', url: `${window.location.origin}/san-pham/dau-goi?ref=AN%201` });
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
