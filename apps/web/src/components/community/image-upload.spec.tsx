// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ configured: true, upload: vi.fn(), compress: vi.fn() }));
vi.mock('@/components/account/cloudinary-upload', () => ({
  isCloudinaryConfigured: () => mocks.configured,
  uploadToCloudinary: mocks.upload,
}));
vi.mock('@/lib/image-compress', async (orig) => ({
  ...(await orig<typeof import('@/lib/image-compress')>()),
  readAndCompressImage: mocks.compress,
}));

import { MAX_PUBLIC_DATA_URL_LENGTH } from '@/lib/image-compress';
import { ImageUpload } from './image-upload';

let mounted: Rendered[] = [];
const onChange = vi.fn();
const file = (name: string, type = 'image/jpeg', size = 1000) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const pick = async (r: Rendered, files: File[]) => {
  const input = r.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush(4);
};
const mount = (props: Partial<Parameters<typeof ImageUpload>[0]> = {}) => {
  const r = render(<ImageUpload value={[]} onChange={onChange} {...props} />);
  mounted.push(r);
  return r;
};

beforeEach(() => {
  mocks.configured = true;
  mocks.upload.mockReset().mockResolvedValue('https://res.cloudinary.com/x/a.jpg');
  mocks.compress.mockReset().mockResolvedValue('data:image/jpeg;base64,AAA');
  onChange.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('ImageUpload', () => {
  it('Cloudinary thành công: onChange nhận secure_url, không nén', async () => {
    const r = mount({ value: ['https://old/1.jpg'] });
    await pick(r, [file('a.jpg')]);
    expect(onChange).toHaveBeenCalledWith([
      'https://old/1.jpg',
      'https://res.cloudinary.com/x/a.jpg',
    ]);
    expect(mocks.compress).not.toHaveBeenCalled();
  });

  it('Cloudinary trả null: dùng ảnh nén theo trần nội dung công khai', async () => {
    mocks.upload.mockResolvedValue(null);
    const r = mount();
    await pick(r, [file('a.jpg')]);
    expect(mocks.compress).toHaveBeenCalledWith(expect.any(File), MAX_PUBLIC_DATA_URL_LENGTH);
    expect(onChange).toHaveBeenCalledWith(['data:image/jpeg;base64,AAA']);
  });

  it('chưa cấu hình Cloudinary: nén thẳng, không gọi upload', async () => {
    mocks.configured = false;
    const r = mount();
    await pick(r, [file('a.jpg')]);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(['data:image/jpeg;base64,AAA']);
  });

  it('ảnh quá 20MB bị bỏ qua và báo', async () => {
    const r = mount();
    await pick(r, [file('big.jpg', 'image/jpeg', 21 * 1024 * 1024)]);
    expect(onChange).not.toHaveBeenCalled();
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain(
      'Đã bỏ qua 1 ảnh quá lớn',
    );
  });

  it('tệp không phải ảnh, hoặc nén lỗi, thì báo tải thất bại', async () => {
    mocks.configured = false;
    mocks.compress.mockRejectedValue(new Error('hỏng'));
    const r = mount();
    await pick(r, [file('a.txt', 'text/plain'), file('b.jpg')]);
    expect(onChange).not.toHaveBeenCalled();
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain('Tải ảnh thất bại');
  });

  it('dừng ở trần max ảnh', async () => {
    const r = mount({ value: ['u1'], max: 2 });
    await pick(r, [file('a.jpg'), file('b.jpg')]);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['u1', 'https://res.cloudinary.com/x/a.jpg']);
  });
});
