// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveImage } from './download-image';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('saveImage', () => {
  it('tải blob rồi bấm thẻ <a download> với đúng tên file', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    // Response của Node không nhận Blob của jsdom, nên dựng đối tượng trả lời tối thiểu.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) })));
    const seen: { download: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      seen.push({ download: this.download, href: this.href });
    });
    await expect(saveImage('https://img.test/a.png', 'qr.png')).resolves.toBe('saved');
    expect(seen).toEqual([{ download: 'qr.png', href: 'blob:x' }]);
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('máy chủ ảnh trả lỗi: mở ảnh ở tab mới', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 404 })));
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await expect(saveImage('https://img.test/a.png', 'qr.png')).resolves.toBe('opened');
    expect(open).toHaveBeenCalledWith('https://img.test/a.png', '_blank', 'noopener,noreferrer');
  });

  it('fetch ném lỗi (CORS/mạng): mở ảnh ở tab mới thay vì ném lỗi', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await expect(saveImage('https://img.test/a.png', 'qr.png')).resolves.toBe('opened');
    expect(open).toHaveBeenCalledTimes(1);
  });
});
