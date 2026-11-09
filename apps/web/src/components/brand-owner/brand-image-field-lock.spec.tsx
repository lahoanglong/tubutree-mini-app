// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { flush, render, type Rendered } from '@/test-utils/dom';

const m = vi.hoisted(() => ({
  upload: vi.fn(),
  compress: vi.fn(async (_file: File): Promise<string> => 'data:image/jpeg;base64,NEN'),
}));
vi.mock('@/components/account/cloudinary-upload', () => ({ uploadToCloudinary: m.upload }));
vi.mock('@/lib/image-compress', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), readAndCompressImage: m.compress }));

import { BrandImageField } from './brand-image-field';

let mounted: Rendered[] = [];
beforeEach(() => {
  m.upload.mockReset();
  m.compress.mockClear();
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
});

const file = (name: string) => new File(['x'], name, { type: 'image/jpeg' });
function choose(r: Rendered, f: File) {
  const input = r.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [f] });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('BrandImageField — tải ảnh một lần một lúc', () => {
  it('đang tải: nút báo aria-busy + aria-disabled, KHÔNG disabled thật; bấm nút không mở hộp chọn tệp; chọn tệp thứ hai bị bỏ qua', async () => {
    let done!: (url: string) => void;
    m.upload.mockImplementation(() => new Promise<string>((res) => { done = res; }));
    const onChange = vi.fn();
    const r = render(<BrandImageField label="Logo" value="" onChange={onChange} />);
    mounted.push(r);
    const input = r.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const openPicker = vi.spyOn(input, 'click');

    choose(r, file('a.jpg'));
    choose(r, file('b.jpg'));
    await flush();
    expect(m.upload).toHaveBeenCalledTimes(1);

    const drop = r.container.querySelector<HTMLButtonElement>('button[aria-label="Tải ảnh logo lên"]')!;
    expect(drop.getAttribute('aria-busy')).toBe('true');
    expect(drop.getAttribute('aria-disabled')).toBe('true');
    expect(drop.disabled).toBe(false);
    act(() => drop.click());
    expect(openPicker).not.toHaveBeenCalled();

    await act(async () => done('https://res.cloudinary.com/x/a.jpg'));
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('https://res.cloudinary.com/x/a.jpg');
    expect(drop.hasAttribute('aria-busy')).toBe(false);
    act(() => drop.click());
    expect(openPicker).toHaveBeenCalledTimes(1);
  });

  it('tải lỗi: nhả khoá để chọn lại tệp khác', async () => {
    m.upload.mockRejectedValueOnce(new Error('mạng')).mockResolvedValueOnce('https://res.cloudinary.com/x/b.jpg');
    m.compress.mockRejectedValueOnce(new Error('nén lỗi'));
    const onChange = vi.fn();
    const r = render(<BrandImageField label="Logo" value="" onChange={onChange} />);
    mounted.push(r);
    choose(r, file('a.jpg'));
    await flush();
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain('Tải ảnh thất bại');
    choose(r, file('b.jpg'));
    await flush();
    expect(onChange).toHaveBeenCalledWith('https://res.cloudinary.com/x/b.jpg');
  });
});
