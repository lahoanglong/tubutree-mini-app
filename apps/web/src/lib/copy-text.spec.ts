// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './copy-text';

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'execCommand');
});

describe('copyText', () => {
  it('clipboard ghi được: true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('123')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('123');
  });

  it('clipboard bị từ chối và không có execCommand: false', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    expect(await copyText('123')).toBe(false);
  });

  it('clipboard bị từ chối: rơi xuống execCommand', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    expect(await copyText('123')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('chuỗi rỗng: false', async () => {
    expect(await copyText('')).toBe(false);
  });
});
