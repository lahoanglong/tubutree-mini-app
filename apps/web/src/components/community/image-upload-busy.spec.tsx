// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { flush, render, type Rendered } from '@/test-utils/dom';

const m = vi.hoisted(() => ({ upload: vi.fn(), compress: vi.fn() }));
vi.mock('@/components/account/cloudinary-upload', () => ({ isCloudinaryConfigured: () => true, uploadToCloudinary: m.upload }));
vi.mock('@/lib/image-compress', async (orig) => ({ ...(await orig<typeof import('@/lib/image-compress')>()), readAndCompressImage: m.compress }));

import { ImageUpload } from './image-upload';

let mounted: Rendered[] = [];
const log: string[] = [];
beforeEach(() => {
  log.length = 0;
  m.upload.mockReset();
  m.compress.mockReset().mockRejectedValue(new Error('nén lỗi'));
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
});

const file = (name: string) => new File(['x'], name, { type: 'image/jpeg' });
function choose(c: HTMLElement, files: File[]) {
  const input = c.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const mount = (props: Partial<Parameters<typeof ImageUpload>[0]> = {}) => {
  const r = render(<ImageUpload value={[]} onChange={(urls) => log.push(`change:${urls.join(',')}`)} onBusyChange={(b) => log.push(`busy:${b}`)} {...props} />);
  mounted.push(r);
  return r;
};

describe('community ImageUpload — báo form cha đang tải ảnh', () => {
  it('một lượt chọn nhiều ảnh là MỘT lượt bận: báo bận một lần, xong báo SAU khi đã đưa danh sách ảnh cho form', async () => {
    let done!: (u: string) => void;
    m.upload.mockImplementation(() => new Promise<string>((res) => { done = res; }));
    const r = mount();
    choose(r.container, [file('a.jpg')]);
    await flush();
    expect(log).toEqual(['busy:true']);
    await act(async () => done('https://res.cloudinary.com/x/a.jpg'));
    await flush();
    expect(log).toEqual(['busy:true', 'change:https://res.cloudinary.com/x/a.jpg', 'busy:false']);
  });

  it('mọi ảnh đều lỗi: vẫn báo xong để form không kẹt bận', async () => {
    m.upload.mockResolvedValue(null);
    const r = mount();
    choose(r.container, [file('a.jpg')]);
    await flush();
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain('Tải ảnh thất bại');
    expect(log).toEqual(['busy:true', 'busy:false']);
  });

  it('form cha đang gửi (disabled): nút Thêm ảnh khoá, tệp chọn lọt vào bị bỏ qua', async () => {
    const r = mount({ disabled: true });
    expect(r.container.querySelector<HTMLButtonElement>('button[type="button"]:not([aria-label])')!.disabled).toBe(true);
    choose(r.container, [file('a.jpg')]);
    await flush();
    expect(m.upload).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });
});
