// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shallowPush, shallowReplace } from './shallow-url';

afterEach(() => vi.restoreAllMocks());

describe('shallow-url', () => {
  it('shallowPush/shallowReplace gọi History API với state dạng object (để nav-depth còn đóng dấu độ sâu)', () => {
    const push = vi.spyOn(window.history, 'pushState').mockImplementation(() => undefined);
    const replace = vi.spyOn(window.history, 'replaceState').mockImplementation(() => undefined);
    shallowPush('/ctv/gian-hang?khoi=c1', { builderSection: true });
    expect(push).toHaveBeenCalledWith({ builderSection: true }, '', '/ctv/gian-hang?khoi=c1');
    shallowReplace('/ctv/gian-hang');
    expect(replace).toHaveBeenCalledWith({}, '', '/ctv/gian-hang');
  });
});
