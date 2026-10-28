// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { flush, render, type Rendered } from '@/test-utils/dom';

const m = vi.hoisted(() => ({
  upload: vi.fn(async (_file: File | Blob): Promise<string | null> => 'https://res.cloudinary.com/x/anh.jpg'),
  compress: vi.fn(async (_file: File): Promise<string> => 'data:image/jpeg;base64,NEN'),
}));
vi.mock('@/components/account/cloudinary-upload', () => ({ uploadToCloudinary: m.upload }));
vi.mock('@/lib/image-compress', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), readAndCompressImage: m.compress }));

import { BrandImageField } from './brand-image-field';

let mounted: Rendered[] = [];
beforeEach(() => {
  m.upload.mockClear();
  m.compress.mockClear();
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
});

async function pickFile(r: Rendered) {
  const input = r.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
}

describe('BrandImageField — diện mạo Mini App ở điện thoại', () => {
  it('nhãn đậm như Text label, khung viền đứt 1.5px nền canvas', () => {
    const r = render(<BrandImageField label="Logo" value="" onChange={() => undefined} />);
    mounted.push(r);
    const label = Array.from(r.container.querySelectorAll('div')).find((d) => d.textContent === 'Logo' && d.children.length === 0)!;
    expect(label.className).toContain('max-md:font-semibold');
    const drop = r.container.querySelector<HTMLElement>('button[aria-label="Tải ảnh logo lên"]')!;
    expect(drop.className).toContain('max-md:border-[1.5px]');
    expect(drop.className).toContain('max-md:bg-[color:var(--color-bg-canvas)]');
  });
});

describe('BrandImageField — nơi lưu ảnh', () => {
  it('mặc định: ưu tiên Cloudinary, dùng đường dẫn Cloudinary trả về', async () => {
    const onChange = vi.fn();
    const r = render(<BrandImageField label="Logo" value="" onChange={onChange} />);
    mounted.push(r);
    await pickFile(r);
    expect(m.upload).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('https://res.cloudinary.com/x/anh.jpg');
  });

  it('Cloudinary chưa cấu hình (trả null): nén thành ảnh nhúng', async () => {
    m.upload.mockResolvedValueOnce(null);
    const onChange = vi.fn();
    const r = render(<BrandImageField label="Logo" value="" onChange={onChange} />);
    mounted.push(r);
    await pickFile(r);
    expect(onChange).toHaveBeenCalledWith('data:image/jpeg;base64,NEN');
  });

  it('upload="inline" (ảnh giấy tờ như CCCD): không bao giờ gọi Cloudinary, chỉ nén thành ảnh nhúng', async () => {
    const onChange = vi.fn();
    const r = render(<BrandImageField label="Ảnh CCCD mặt trước *" value="" onChange={onChange} upload="inline" />);
    mounted.push(r);
    await pickFile(r);
    expect(m.upload).not.toHaveBeenCalled();
    expect(m.compress).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('data:image/jpeg;base64,NEN');
  });
});
