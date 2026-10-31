import { afterEach, describe, expect, it, vi } from 'vitest';
import { installPressFeedback } from './press-feedback';

describe('installPressFeedback', () => {
  afterEach(() => vi.restoreAllMocks());

  it('gắn đúng một touchstart passive lên document dù gọi nhiều lần (iOS chỉ áp :active khi có listener)', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const off1 = installPressFeedback();
    const off2 = installPressFeedback();
    const touch = add.mock.calls.filter(([type]) => type === 'touchstart');
    expect(touch).toHaveLength(1);
    expect(touch[0]![2]).toEqual({ passive: true });
    off1();
    off2();
  });

  it('hàm gỡ bỏ listener, gắn lại được sau khi gỡ', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const off = installPressFeedback();
    off();
    expect(remove.mock.calls.filter(([type]) => type === 'touchstart')).toHaveLength(1);
    const off2 = installPressFeedback();
    expect(add.mock.calls.filter(([type]) => type === 'touchstart')).toHaveLength(2);
    off2();
  });

  it('không có document (SSR/test node) thì không làm gì và không ném lỗi', () => {
    const off = installPressFeedback(null);
    expect(() => off()).not.toThrow();
  });
});
