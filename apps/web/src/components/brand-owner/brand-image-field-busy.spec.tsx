// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const m = vi.hoisted(() => ({
  upload: vi.fn(),
  compress: vi.fn(async (_file: File): Promise<string> => 'data:image/jpeg;base64,NEN'),
}));
vi.mock('@/components/account/cloudinary-upload', () => ({ uploadToCloudinary: m.upload }));
vi.mock('@/lib/image-compress', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), readAndCompressImage: m.compress }));

import { BrandImageField } from './brand-image-field';

let mounted: Rendered[] = [];
const log: string[] = [];
beforeEach(() => {
  log.length = 0;
  m.upload.mockReset();
  m.compress.mockClear();
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
});

const file = (name: string, type = 'image/jpeg', size = 1000) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
function choose(c: HTMLElement, f: File) {
  const input = c.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [f] });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const mount = (props: Partial<Parameters<typeof BrandImageField>[0]> = {}) => {
  const r = render(
    <BrandImageField
      label="Logo"
      value=""
      onChange={(url) => log.push(`change:${url}`)}
      onBusyChange={(b) => log.push(`busy:${b}`)}
      {...props}
    />,
  );
  mounted.push(r);
  return r;
};
const deferUpload = () => {
  let done!: (url: string | null) => void;
  let fail!: (e: Error) => void;
  m.upload.mockImplementation(
    () =>
      new Promise<string | null>((res, rej) => {
        done = res;
        fail = rej;
      }),
  );
  return { done: (u: string | null) => done(u), fail: (e: Error) => fail(e) };
};

describe('BrandImageField — báo form cha đang tải ảnh', () => {
  it('báo bận lúc bắt đầu tải; báo xong SAU khi đã đưa ảnh mới cho form (không nhả khoá trước khi ảnh vào)', async () => {
    const up = deferUpload();
    const r = mount();
    choose(r.container, file('a.jpg'));
    await flush();
    expect(log).toEqual(['busy:true']);
    await act(async () => up.done('https://res.cloudinary.com/x/a.jpg'));
    await flush();
    expect(log).toEqual(['busy:true', 'change:https://res.cloudinary.com/x/a.jpg', 'busy:false']);
  });

  it('tải lỗi và nén cũng lỗi: vẫn báo xong để form không kẹt ở trạng thái bận', async () => {
    const up = deferUpload();
    m.compress.mockRejectedValueOnce(new Error('nén lỗi'));
    const r = mount();
    choose(r.container, file('a.jpg'));
    await flush();
    await act(async () => up.fail(new Error('mạng')));
    await flush();
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain('Tải ảnh thất bại');
    expect(log).toEqual(['busy:true', 'busy:false']);
  });

  it('tệp bị từ chối trước khi tải (không phải ảnh, quá 20MB): KHÔNG báo gì, để không trừ nhầm lượt tải của ô khác', async () => {
    const r = mount();
    choose(r.container, file('a.pdf', 'application/pdf'));
    await flush();
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain('không phải ảnh');
    choose(r.container, file('big.jpg', 'image/jpeg', 21 * 1024 * 1024));
    await flush();
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain('tối đa 20MB');
    expect(log).toEqual([]);
    expect(m.upload).not.toHaveBeenCalled();
  });

  it('ô bị gỡ giữa lúc đang tải: lượt tải vẫn báo xong để form cha không kẹt bận', async () => {
    const up = deferUpload();
    function Parent() {
      const [show, setShow] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setShow(false)}>
            go-o
          </button>
          {show && <BrandImageField label="Logo" value="" onChange={() => undefined} onBusyChange={(b) => log.push(`busy:${b}`)} />}
        </>
      );
    }
    const r = render(<Parent />);
    mounted.push(r);
    choose(r.container, file('a.jpg'));
    await flush();
    click(r.container.querySelector('button')!);
    expect(r.container.querySelector('input[type="file"]')).toBeNull();
    await act(async () => up.done('https://res.cloudinary.com/x/a.jpg'));
    await flush();
    expect(log).toEqual(['busy:true', 'busy:false']);
  });

  it('form cha đang lưu (disabled): ô báo aria-disabled, bấm không mở hộp chọn tệp, tệp chọn lọt vào bị bỏ qua', async () => {
    const r = mount({ value: 'https://res.cloudinary.com/x/old.jpg', disabled: true });
    const input = r.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const openPicker = vi.spyOn(input, 'click');
    const drop = r.container.querySelector<HTMLButtonElement>('button[aria-label="Đổi ảnh logo"]')!;
    const change = Array.from(r.container.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Đổi ảnh khác'))!;
    expect(drop.getAttribute('aria-disabled')).toBe('true');
    expect(drop.disabled).toBe(false);
    expect(change.getAttribute('aria-disabled')).toBe('true');
    act(() => drop.click());
    act(() => change.click());
    expect(openPicker).not.toHaveBeenCalled();
    choose(r.container, file('a.jpg'));
    await flush();
    expect(m.upload).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });

  it('không disabled: bấm ô mở hộp chọn tệp như cũ', () => {
    const r = mount();
    const input = r.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const openPicker = vi.spyOn(input, 'click');
    act(() => r.container.querySelector<HTMLButtonElement>('button[aria-label="Tải ảnh logo lên"]')!.click());
    expect(openPicker).toHaveBeenCalledTimes(1);
  });
});
