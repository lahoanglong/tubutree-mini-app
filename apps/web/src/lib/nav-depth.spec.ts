// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { historyDepth, pathMatchesPrevious, previousPath, pushOrBack } from './nav-depth';

// Next ghi lịch sử bằng pushState/replaceState với state riêng của nó; spec giả lại đúng cách đó.
const nextPush = (path: string) => window.history.pushState({ __NA: true }, '', path);
const nextReplace = (path: string) => window.history.replaceState({ __NA: true }, '', path);
const popped = () => new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
const go = async (delta: number) => {
  const p = popped();
  window.history.go(delta);
  await p;
};

beforeEach(() => {
  // Bản gốc của trình duyệt (không qua lớp đóng dấu): mỗi test bắt đầu ở một mục "vào thẳng" độ sâu 0.
  Object.getPrototypeOf(window.history).replaceState.call(window.history, { __NA: true }, '', '/gio-hang');
});

describe('nav-depth: đóng dấu tubuPrev', () => {
  it('mục vào thẳng không có trang trước', () => {
    expect(historyDepth()).toBe(0);
    expect(previousPath()).toBeUndefined();
  });

  it('push ghi đường dẫn đang đứng (kèm query) thành trang trước của mục mới', () => {
    nextReplace('/gio-hang?tab=a');
    nextPush('/thanh-toan');
    expect(historyDepth()).toBe(1);
    expect(previousPath()).toBe('/gio-hang?tab=a');
    nextPush('/chuyen-khoan/TB1');
    expect(historyDepth()).toBe(2);
    expect(previousPath()).toBe('/thanh-toan');
  });

  it('replace giữ nguyên độ sâu và trang trước của mục hiện tại', () => {
    nextPush('/thanh-toan');
    nextReplace('/thanh-toan?x=1');
    expect(historyDepth()).toBe(1);
    expect(previousPath()).toBe('/gio-hang');
  });

  it('replace ở mục vào thẳng không bịa ra trang trước', () => {
    nextReplace('/san-pham');
    expect(historyDepth()).toBe(0);
    expect(previousPath()).toBeUndefined();
  });

  it('lùi và tiến đứng đúng mục: mỗi mục giữ trang trước riêng của nó', async () => {
    nextPush('/thanh-toan');
    nextPush('/chuyen-khoan/TB1');
    await go(-1);
    expect(previousPath()).toBe('/gio-hang');
    await go(-1);
    expect(previousPath()).toBeUndefined();
    await go(2);
    expect(previousPath()).toBe('/thanh-toan');
  });

  it('tải lại: lúc hydrate Next ghi lại state mục hiện tại bằng replaceState trần, dấu vẫn còn', () => {
    nextPush('/thanh-toan');
    nextReplace('/thanh-toan');
    expect(historyDepth()).toBe(1);
    expect(previousPath()).toBe('/gio-hang');
  });

  it('state không phải object (trang ngoài Next) không bị đổi', () => {
    window.history.pushState(null, '', '/x');
    expect(window.history.state).toBeNull();
    expect(previousPath()).toBeUndefined();
  });
});

describe('nav-depth: pathMatchesPrevious và pushOrBack', () => {
  it('đích trần khớp trang trước theo pathname, bỏ qua query của trang trước', () => {
    nextReplace('/gio-hang?a=1');
    nextPush('/thanh-toan');
    expect(pathMatchesPrevious('/gio-hang')).toBe(true);
    expect(pathMatchesPrevious('/gio-hang?a=1')).toBe(true);
    expect(pathMatchesPrevious('/san-pham')).toBe(false);
  });

  it('đích có query phải khớp đủ, không lùi nhầm sang tab khác của cùng trang', () => {
    nextReplace('/ma-giam-gia');
    nextPush('/thanh-toan');
    expect(pathMatchesPrevious('/ma-giam-gia?tab=history')).toBe(false);
    expect(pathMatchesPrevious('/ma-giam-gia')).toBe(true);
  });

  it('vào thẳng (độ sâu 0) thì không bao giờ khớp', () => {
    expect(pathMatchesPrevious('/gio-hang')).toBe(false);
  });

  it('pushOrBack: đích là trang trước thì back(), không push', () => {
    nextPush('/thanh-toan');
    const router = { back: vi.fn(), push: vi.fn() };
    pushOrBack(router, '/gio-hang');
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('pushOrBack: đích khác trang trước, hoặc vào thẳng thì push', () => {
    const router = { back: vi.fn(), push: vi.fn() };
    pushOrBack(router, '/gio-hang');
    expect(router.push).toHaveBeenCalledWith('/gio-hang');
    nextPush('/thanh-toan');
    pushOrBack(router, '/san-pham');
    expect(router.push).toHaveBeenCalledWith('/san-pham');
    expect(router.back).not.toHaveBeenCalled();
  });
});
