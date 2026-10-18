// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { flush, render, type Rendered } from '@/test-utils/dom';

const cloud = vi.hoisted(() => ({ url: null as string | null }));
vi.mock('@/components/account/cloudinary-upload', () => ({ uploadToCloudinary: async () => cloud.url }));

import { StorefrontImageUpload } from './storefront-image-upload';

let mounted: Rendered | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  cloud.url = null;
});

async function pick(file: File) {
  const input = mounted!.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
}

describe('StorefrontImageUpload', () => {
  it('chưa có ảnh: mời tải lên; có ảnh: hiện ảnh và lối đổi ảnh khác', () => {
    const onChange = vi.fn();
    mounted = render(<StorefrontImageUpload label="Ảnh bìa" value="" onChange={onChange} maxDim={1000} quality={0.75} />);
    expect(mounted.container.textContent).toContain('Chạm để tải ảnh lên');
    mounted.unmount();
    mounted = render(<StorefrontImageUpload label="Ảnh bìa" value="data:image/jpeg;base64,xx" onChange={onChange} maxDim={1000} quality={0.75} />);
    expect(mounted.container.querySelector('img')?.getAttribute('alt')).toBe('Ảnh bìa');
    expect(mounted.container.textContent).toContain('Đổi ảnh khác');
  });

  it('có Cloudinary: lưu URL trả về', async () => {
    cloud.url = 'https://res.cloudinary.com/x/a.jpg';
    const onChange = vi.fn();
    mounted = render(<StorefrontImageUpload label="Ảnh đại diện" value="" onChange={onChange} maxDim={400} quality={0.8} />);
    await pick(new File(['x'], 'a.png', { type: 'image/png' }));
    expect(onChange).toHaveBeenCalledWith('https://res.cloudinary.com/x/a.jpg');
  });

  it('tệp không phải ảnh: báo lỗi, không lưu', async () => {
    const onChange = vi.fn();
    mounted = render(<StorefrontImageUpload label="Ảnh bìa" value="" onChange={onChange} maxDim={1000} quality={0.75} />);
    await pick(new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toContain('không phải ảnh');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ảnh quá 20MB: báo lỗi, không lưu', async () => {
    const onChange = vi.fn();
    mounted = render(<StorefrontImageUpload label="Ảnh bìa" value="" onChange={onChange} maxDim={1000} quality={0.75} />);
    const big = new File(['x'], 'big.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 });
    await pick(big);
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toContain('tối đa 20MB');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('không có Cloudinary mà trình duyệt không đọc được ảnh: báo tải thất bại', async () => {
    const onChange = vi.fn();
    mounted = render(<StorefrontImageUpload label="Ảnh bìa" value="" onChange={onChange} maxDim={1000} quality={0.75} />);
    URL.createObjectURL = () => 'blob:x';
    URL.revokeObjectURL = () => undefined;
    const Orig = globalThis.Image;
    globalThis.Image = class {
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    } as unknown as typeof Image;
    await pick(new File(['x'], 'a.png', { type: 'image/png' }));
    globalThis.Image = Orig;
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toContain('Tải ảnh thất bại');
    expect(onChange).not.toHaveBeenCalled();
  });
});
