// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { click } from '@/test-utils/dom';
import { act } from 'react';
import { mount } from './harness';

const nav = vi.hoisted(() => ({ pathname: '/san-pham/abc', back: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ back: nav.back, push: nav.push, replace: nav.replace }),
}));

import BackButton from './back-button';

const popped = () => new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
const go = async (delta: number) => {
  const p = popped();
  window.history.go(delta);
  await p;
};
// Next ghi lịch sử bằng pushState/replaceState với state riêng của nó; spec giả lại đúng cách đó.
const nextPush = (path: string) => window.history.pushState({ __NA: true }, '', path);
const nextReplace = (path: string) => window.history.replaceState({ __NA: true }, '', path);
const press = (c: HTMLElement) => click(c.querySelector('button')!);

beforeEach(() => {
  nav.pathname = '/san-pham/abc';
  nav.back.mockClear();
  nav.push.mockClear();
  nav.replace.mockClear();
  document.body.className = '';
  document.body.querySelectorAll('[data-back-href]').forEach((n) => n.remove());
  // Bản gốc của trình duyệt (không qua lớp đóng dấu) để mỗi test bắt đầu ở một mục "vào thẳng" độ sâu 0.
  Object.getPrototypeOf(window.history).replaceState.call(window.history, { __NA: true }, '', '/san-pham/abc');
});

describe('BackButton: không bao giờ rời web, không bao giờ im lặng', () => {
  it('vào thẳng link: đi tới trang cha trong web, không back()', () => {
    const { container } = mount(<BackButton />);
    press(container);
    expect(nav.replace).toHaveBeenCalledWith('/san-pham');
    expect(nav.back).not.toHaveBeenCalled();
  });

  it('trang cha suy ra không có route thì về "/"', () => {
    nav.pathname = '/khong-co/trang-con';
    const { container } = mount(<BackButton />);
    press(container);
    expect(nav.replace).toHaveBeenCalledWith('/');
  });

  it('PageHeader khai báo trang cha (data-back-href) thì ưu tiên hơn suy luận', () => {
    const header = document.createElement('header');
    header.setAttribute('data-back-href', '/tai-khoan');
    document.body.appendChild(header);
    const { container } = mount(<BackButton />);
    press(container);
    expect(nav.replace).toHaveBeenCalledWith('/tai-khoan');
  });

  it('fallbackHref truyền vào thắng cả data-back-href', () => {
    const header = document.createElement('header');
    header.setAttribute('data-back-href', '/tai-khoan');
    document.body.appendChild(header);
    const { container } = mount(<BackButton fallbackHref="/s/abc" />);
    press(container);
    expect(nav.replace).toHaveBeenCalledWith('/s/abc');
  });

  it('trang cha trùng đường dẫn hiện tại thì về "/" thay vì bấm không ra gì', () => {
    nav.pathname = '/doi-rac/tao';
    const header = document.createElement('header');
    header.setAttribute('data-back-href', '/doi-rac/tao');
    document.body.appendChild(header);
    const { container } = mount(<BackButton />);
    press(container);
    expect(nav.replace).toHaveBeenCalledWith('/');
  });

  it('push A rồi B: ở B lùi một bước; lùi về A rồi A vẫn lùi được về trang đầu trong web', async () => {
    const { container } = mount(<BackButton />);
    nextPush('/san-pham/a');
    nextPush('/san-pham/b');
    nav.pathname = '/san-pham/b';
    press(container);
    expect(nav.back).toHaveBeenCalledTimes(1);
    await go(-1);
    nav.back.mockClear();
    press(container);
    expect(nav.back).toHaveBeenCalledTimes(1);
    await go(-1);
    nav.back.mockClear();
    press(container);
    expect(nav.back).not.toHaveBeenCalled();
    expect(nav.replace).toHaveBeenCalled();
  });

  it('replace B thành C không tăng độ sâu: từ trang vào thẳng rồi replace thì nút đi tới trang cha, không back()', () => {
    const { container } = mount(<BackButton />);
    nextReplace('/san-pham/c');
    nav.pathname = '/san-pham/c';
    press(container);
    expect(nav.back).not.toHaveBeenCalled();
    expect(nav.replace).toHaveBeenCalledWith('/san-pham');
  });

  it('push B rồi replace thành C: vẫn một bước để lùi', () => {
    const { container } = mount(<BackButton />);
    nextPush('/san-pham/b');
    nextReplace('/san-pham/c');
    nav.pathname = '/san-pham/c';
    press(container);
    expect(nav.back).toHaveBeenCalledTimes(1);
  });

  it('lùi rồi Forward rồi lùi: độ sâu theo đúng mục lịch sử đang đứng', async () => {
    const { container } = mount(<BackButton />);
    nextPush('/san-pham/a');
    nextPush('/san-pham/b');
    await go(-2);
    await go(1);
    await go(1);
    nav.pathname = '/san-pham/b';
    press(container);
    expect(nav.back).toHaveBeenCalledTimes(1);
    await go(-1);
    await go(-1);
    nav.back.mockClear();
    press(container);
    expect(nav.back).not.toHaveBeenCalled();
    expect(nav.replace).toHaveBeenCalled();
  });

  it('tải lại ở B: độ sâu nằm trong history.state nên nút vẫn lùi một bước', () => {
    const first = mount(<BackButton />);
    nextPush('/san-pham/b');
    first.unmount();
    // Lúc hydrate, App Router ghi lại state mục hiện tại bằng replaceState trước khi nút kịp gắn.
    nextReplace('/san-pham/b');
    nav.pathname = '/san-pham/b';
    const { container } = mount(<BackButton />);
    press(container);
    expect(nav.back).toHaveBeenCalledTimes(1);
  });

  it('nhiều bản BackButton cùng gắn vẫn chỉ tăng độ sâu một bước mỗi lần push', async () => {
    const a = mount(<BackButton />);
    mount(<BackButton />);
    nextPush('/san-pham/a');
    nextPush('/san-pham/b');
    await go(-1);
    nav.pathname = '/san-pham/a';
    nav.back.mockClear();
    press(a.container);
    expect(nav.back).toHaveBeenCalledTimes(1);
    await go(-1);
    nav.back.mockClear();
    press(a.container);
    expect(nav.back).not.toHaveBeenCalled();
  });

  it('state không phải object (trang ngoài Next) không bị đổi', () => {
    mount(<BackButton />);
    window.history.pushState(null, '', '/x');
    expect(window.history.state).toBeNull();
  });

  it('vào thẳng trang con: bấm đi tới trang cha bằng replace, bấm tiếp ở trang cha lên tiếp chứ không back() về trang con', () => {
    nav.pathname = '/cong-dong/su-kien';
    const header = document.createElement('header');
    header.setAttribute('data-back-href', '/cong-dong');
    document.body.appendChild(header);
    const first = mount(<BackButton />);
    press(first.container);
    expect(nav.replace).toHaveBeenCalledWith('/cong-dong');
    expect(nav.push).not.toHaveBeenCalled();
    first.unmount();
    nextReplace('/cong-dong');
    nav.pathname = '/cong-dong';
    header.removeAttribute('data-back-href');
    const { container } = mount(<BackButton />);
    press(container);
    expect(nav.back).not.toHaveBeenCalled();
    expect(nav.replace).toHaveBeenLastCalledWith('/');
  });
});

describe('BackButton: thanh nền đặc phía sau nút khi cuộn', () => {
  it('trong suốt ở đỉnh trang, đặc khi cuộn quá 8px', async () => {
    const { container } = mount(<BackButton />);
    const bar = () => container.querySelector('[data-back-bar]') as HTMLElement;
    expect(bar().dataset.scrolled).toBe('false');
    expect(bar().style.pointerEvents).toBe('none');
    Object.defineProperty(window, 'scrollY', { value: 120, configurable: true });
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(bar().dataset.scrolled).toBe('true');
    expect(bar().style.opacity).toBe('1');
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });
});
