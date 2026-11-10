// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// R2-LIFECYCLE-10: form trả hàng trên web không tải được ảnh minh chứng.

const m = vi.hoisted(() => ({ compress: vi.fn() }));
vi.mock('@/lib/image-compress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/image-compress')>()),
  readAndCompressImage: (f: File) => m.compress(f),
}));

import { EvidenceUpload } from './evidence-upload';
import { useState } from 'react';

function Harness({ initial = [], max = 3 }: { initial?: string[]; max?: number }) {
  const [v, setV] = useState<string[]>(initial);
  return (
    <div>
      <EvidenceUpload value={v} onChange={setV} max={max} />
      <output data-testid="value">{JSON.stringify(v)}</output>
    </div>
  );
}

const file = (name: string, size = 1000, type = 'image/jpeg') => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const pick = (c: HTMLElement, files: File[]) => {
  const input = c.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const value = (c: HTMLElement) => JSON.parse(c.querySelector('[data-testid="value"]')!.textContent!) as string[];

let mounted: Rendered[] = [];
const mount = async (props: { initial?: string[]; max?: number } = {}) => {
  const r = render(<Harness {...props} />);
  mounted.push(r);
  await flush(2);
  return r.container;
};

beforeEach(() => {
  m.compress.mockReset().mockImplementation(async (f: File) => `data:image/jpeg;base64,${f.name}`);
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('EvidenceUpload — ảnh minh chứng đổi/trả', () => {
  it('chọn nhiều ảnh: nén từng ảnh, hiện ảnh nhỏ và đếm n/3', async () => {
    const c = await mount();
    expect(c.textContent).toContain('0/3');
    pick(c, [file('a.jpg'), file('b.jpg')]);
    await flush(4);
    expect(value(c)).toEqual(['data:image/jpeg;base64,a.jpg', 'data:image/jpeg;base64,b.jpg']);
    expect(c.querySelectorAll('li img')).toHaveLength(2);
    expect(c.querySelector('li img')!.getAttribute('alt')).toBe('Ảnh minh chứng 1');
    expect(c.textContent).toContain('2/3');
  });

  it('không vượt tối đa 3 ảnh: ảnh thừa bị bỏ và có báo; đủ 3 thì nút thêm ảnh khoá', async () => {
    const c = await mount({ initial: ['data:image/jpeg;base64,1'] });
    pick(c, [file('a.jpg'), file('b.jpg'), file('c.jpg')]);
    await flush(4);
    expect(value(c)).toHaveLength(3);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('tối đa 3 ảnh');
    const add = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('Thêm ảnh'))!;
    expect(add.disabled).toBe(true);
  });

  it('bỏ qua tệp không phải ảnh và ảnh quá 20MB, nói rõ lý do', async () => {
    const c = await mount();
    pick(c, [file('doc.pdf', 1000, 'application/pdf'), file('big.jpg', 21 * 1024 * 1024), file('ok.jpg')]);
    await flush(4);
    expect(value(c)).toEqual(['data:image/jpeg;base64,ok.jpg']);
    const alert = c.querySelector('[role="alert"]')!.textContent!;
    expect(alert).toContain('không phải ảnh');
    expect(alert).toContain('quá lớn');
  });

  it('nén lỗi: báo lỗi thân thiện, các ảnh trước đó vẫn giữ', async () => {
    m.compress.mockRejectedValueOnce(new Error('boom'));
    const c = await mount({ initial: ['data:image/jpeg;base64,1'] });
    pick(c, [file('bad.jpg')]);
    await flush(4);
    expect(value(c)).toEqual(['data:image/jpeg;base64,1']);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Không xử lý được ảnh');
  });

  it('xoá một ảnh theo nút có tên rõ ràng', async () => {
    const c = await mount({ initial: ['data:image/jpeg;base64,1', 'data:image/jpeg;base64,2'] });
    click(c.querySelector('button[aria-label="Xoá ảnh minh chứng 1"]'));
    await flush(2);
    expect(value(c)).toEqual(['data:image/jpeg;base64,2']);
  });

  it('bộ đếm n/tối đa dùng số đều (tabular-nums) để không nhảy khi số ảnh đổi', async () => {
    const c = await mount({ initial: ['data:image/jpeg;base64,1'] });
    const counter = Array.from(c.querySelectorAll('span')).find((s) => s.textContent === '1/3')!;
    expect(counter.className).toContain('tabular-nums');
  });

  describe('đang xử lý ảnh (busy)', () => {
    const addButton = (c: HTMLElement) => Array.from(c.querySelectorAll('button')).find((b) => /Thêm ảnh|Đang xử lý ảnh/.test(b.textContent ?? ''))!;
    const removeButtons = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('button[aria-label^="Xoá ảnh minh chứng"]'));

    it('nút thêm ảnh đổi chữ, disabled + aria-busy; nút xoá ảnh khoá; chọn tệp lần hai chen vào bị bỏ, không nén thêm', async () => {
      let finish!: (v: string) => void;
      m.compress.mockReset().mockReturnValueOnce(new Promise<string>((resolve) => (finish = resolve)));
      const c = await mount({ initial: ['data:image/jpeg;base64,1'] });
      expect(addButton(c).textContent).toContain('Thêm ảnh');
      expect(addButton(c).hasAttribute('aria-busy')).toBe(false);

      pick(c, [file('a.jpg')]);
      await flush(2);
      expect(addButton(c).textContent).toContain('Đang xử lý ảnh…');
      expect(addButton(c).disabled).toBe(true);
      expect(addButton(c).getAttribute('aria-busy')).toBe('true');
      expect(removeButtons(c).map((b) => b.disabled)).toEqual([true]);

      pick(c, [file('b.jpg')]);
      await flush(2);
      expect(m.compress).toHaveBeenCalledTimes(1);

      finish('data:image/jpeg;base64,a.jpg');
      await flush(4);
      expect(value(c)).toEqual(['data:image/jpeg;base64,1', 'data:image/jpeg;base64,a.jpg']);
      expect(addButton(c).textContent).toContain('Thêm ảnh');
      expect(addButton(c).disabled).toBe(false);
      expect(addButton(c).hasAttribute('aria-busy')).toBe(false);
      expect(removeButtons(c).map((b) => b.disabled)).toEqual([false, false]);
    });

    it('báo form cha đang xử lý rồi xong (kể cả khi mọi tệp bị bỏ vì không phải ảnh hay quá lớn, và khi nén lỗi) để khoá nút Gửi trong lúc chờ', async () => {
      let finish!: (v: string) => void;
      m.compress.mockReset().mockReturnValueOnce(new Promise<string>((resolve) => (finish = resolve)));
      const busy: boolean[] = [];
      const onChange = vi.fn();
      const r = render(<EvidenceUpload value={[]} onChange={onChange} onBusyChange={(b) => busy.push(b)} />);
      mounted.push(r);
      await flush(2);
      pick(r.container, [file('a.jpg')]);
      await flush(2);
      expect(busy).toEqual([true]);
      expect(onChange).not.toHaveBeenCalled();
      finish('data:image/jpeg;base64,a.jpg');
      await flush(4);
      expect(onChange).toHaveBeenCalledWith(['data:image/jpeg;base64,a.jpg']);
      expect(busy).toEqual([true, false]);

      pick(r.container, [file('doc.pdf', 1000, 'application/pdf'), file('lon.jpg', 21 * 1024 * 1024)]);
      await flush(4);
      expect(busy).toEqual([true, false, true, false]);

      m.compress.mockReset().mockRejectedValueOnce(new Error('hỏng'));
      pick(r.container, [file('x.jpg')]);
      await flush(4);
      expect(busy).toEqual([true, false, true, false, true, false]);
    });

    it('disabled từ ngoài: chọn tệp bị bỏ, không nén và không đổi giá trị', async () => {
      const onChange = vi.fn();
      const r = render(<EvidenceUpload value={[]} onChange={onChange} disabled />);
      mounted.push(r);
      await flush(2);
      pick(r.container, [file('a.jpg')]);
      await flush(4);
      expect(m.compress).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
      expect(r.container.querySelector('[role="alert"]')).toBeNull();
    });
  });

  it('có tên truy cập và vùng chạm 44px', async () => {
    const c = await mount({ initial: ['data:image/jpeg;base64,1'] });
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});
