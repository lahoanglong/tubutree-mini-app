// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { ImageDropZone } from './image-drop-zone';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const image = (name = 'a.png', type = 'image/png') => new File(['x'], name, { type });
const bigImage = () => {
  const f = image('lon.png');
  Object.defineProperty(f, 'size', { value: 21 * 1024 * 1024 });
  return f;
};

function setup(props: Partial<React.ComponentProps<typeof ImageDropZone>> = {}) {
  const onFile = vi.fn();
  const r = render(<ImageDropZone label="Ảnh cho Mật cô đặc" onFile={onFile} {...props} />);
  mounted.push(r);
  const zone = r.container.querySelector<HTMLElement>('[data-testid="image-drop-zone"]')!;
  return { onFile, container: r.container, zone };
}

function fire(el: Element, type: string, extra: Record<string, unknown> = {}) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  for (const [k, v] of Object.entries(extra)) Object.defineProperty(ev, k, { value: v });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

const alertText = (c: HTMLElement) => c.querySelector('[role="alert"]')?.textContent ?? null;

describe('ImageDropZone', () => {
  it('có tên đọc cho trình đọc màn hình, hướng dẫn kéo-thả và dán Ctrl+V / ⌘V, hai nút đủ vùng chạm 44px', () => {
    const { zone, container } = setup();
    expect(zone.getAttribute('role')).toBe('group');
    expect(zone.getAttribute('aria-label')).toBe('Ảnh cho Mật cô đặc');
    expect(zone.tabIndex).toBe(0);
    expect(container.textContent).toMatch(/Kéo ảnh vào đây/);
    expect(container.textContent).toMatch(/Ctrl\+V/);
    expect(container.textContent).toMatch(/⌘V/);
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Chọn ảnh', 'Dán ảnh']);
    expect(buttons.every((b) => /min-h-\[44px\]/.test(b.className))).toBe(true);
  });

  it('chọn tệp ảnh: gọi onFile một lần với đúng tệp rồi xoá lựa chọn để chọn lại cùng tệp được', () => {
    const { onFile, container } = setup();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).toBe('image/*');
    const file = image();
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fire(input, 'change');
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('tệp không phải ảnh hoặc ảnh quá 20MB: báo lỗi tiếng Việt, không gọi onFile; chọn tệp hợp lệ sau đó xoá lỗi', () => {
    const { onFile, container } = setup();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.pdf', { type: 'application/pdf' })], configurable: true });
    fire(input, 'change');
    expect(alertText(container)).toBe('Tệp này không phải ảnh. Chọn ảnh JPEG, PNG hoặc WebP.');
    Object.defineProperty(input, 'files', { value: [bigImage()], configurable: true });
    fire(input, 'change');
    expect(alertText(container)).toBe('Ảnh quá lớn (tối đa 20MB). Chọn ảnh nhỏ hơn.');
    expect(onFile).not.toHaveBeenCalled();
    Object.defineProperty(input, 'files', { value: [image()], configurable: true });
    fire(input, 'change');
    expect(alertText(container)).toBeNull();
    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it('kéo thả: đang kéo ngang qua thì đánh dấu, thả ảnh thì gọi onFile, kéo ra thì bỏ đánh dấu; thả nhiều tệp chỉ lấy ảnh đầu tiên', () => {
    const { onFile, zone } = setup();
    fire(zone, 'dragover', { dataTransfer: { files: [], types: ['Files'] } });
    expect(zone.getAttribute('data-dragging')).toBe('true');
    fire(zone, 'dragleave');
    expect(zone.getAttribute('data-dragging')).toBeNull();

    const first = image('1.png');
    const ev = fire(zone, 'drop', { dataTransfer: { files: [new File(['x'], 'ghi-chu.txt', { type: 'text/plain' }), first, image('2.png')] } });
    expect(ev.defaultPrevented).toBe(true);
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile).toHaveBeenCalledWith(first);
    expect(zone.getAttribute('data-dragging')).toBeNull();
  });

  it('thả tệp không phải ảnh: báo lỗi, không gọi onFile', () => {
    const { onFile, zone, container } = setup();
    fire(zone, 'drop', { dataTransfer: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } });
    expect(alertText(container)).toBe('Tệp này không phải ảnh. Chọn ảnh JPEG, PNG hoặc WebP.');
    expect(onFile).not.toHaveBeenCalled();
  });

  it('dán (Ctrl+V / ⌘V) khi ô đang focus: lấy ảnh trong clipboard; dán chữ thuần thì bỏ qua, không báo lỗi', () => {
    const { onFile, zone, container } = setup();
    const file = image('anh-dan.png');
    const ev = fire(zone, 'paste', { clipboardData: { files: [file], items: [] } });
    expect(ev.defaultPrevented).toBe(true);
    expect(onFile).toHaveBeenCalledWith(file);

    onFile.mockClear();
    const text = fire(zone, 'paste', { clipboardData: { files: [], items: [] } });
    expect(text.defaultPrevented).toBe(false);
    expect(onFile).not.toHaveBeenCalled();
    expect(alertText(container)).toBeNull();
  });

  it('nút "Dán ảnh": đọc ảnh từ bộ nhớ tạm của trình duyệt rồi gọi onFile với tệp có đúng loại ảnh', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    vi.stubGlobal('navigator', { clipboard: { read: vi.fn(async () => [{ types: ['text/plain', 'image/png'], getType: async () => blob }]) } });
    const { onFile, container } = setup();
    click(byText(container, 'button', 'Dán ảnh'));
    await flush();
    expect(onFile).toHaveBeenCalledTimes(1);
    const file = onFile.mock.calls[0]![0] as File;
    expect(file.type).toBe('image/png');
    expect(file.name).toBe('anh-dan.png');
  });

  it('nút "Dán ảnh": clipboard không có ảnh, hoặc trình duyệt không cho đọc: hướng dẫn thay thế, không gọi onFile', async () => {
    vi.stubGlobal('navigator', { clipboard: { read: vi.fn(async () => [{ types: ['text/plain'], getType: async () => new Blob(['x']) }]) } });
    const empty = setup();
    click(byText(empty.container, 'button', 'Dán ảnh'));
    await flush();
    expect(alertText(empty.container)).toBe('Bộ nhớ tạm chưa có ảnh. Chụp hoặc sao chép ảnh rồi thử lại.');
    expect(empty.onFile).not.toHaveBeenCalled();

    vi.stubGlobal('navigator', {});
    const noApi = setup();
    click(byText(noApi.container, 'button', 'Dán ảnh'));
    await flush();
    expect(alertText(noApi.container)).toBe('Trình duyệt không cho đọc ảnh từ bộ nhớ tạm. Bấm vào ô này rồi nhấn Ctrl+V (⌘V trên Mac).');

    vi.stubGlobal('navigator', { clipboard: { read: vi.fn(async () => Promise.reject(new DOMException('denied', 'NotAllowedError'))) } });
    const denied = setup();
    click(byText(denied.container, 'button', 'Dán ảnh'));
    await flush();
    expect(alertText(denied.container)).toBe('Trình duyệt không cho đọc ảnh từ bộ nhớ tạm. Bấm vào ô này rồi nhấn Ctrl+V (⌘V trên Mac).');
  });

  it('đang bận hoặc bị khoá: hai nút aria-disabled, chọn/thả/dán đều bị bỏ qua', () => {
    for (const props of [{ busy: true }, { disabled: true }]) {
      const { onFile, zone, container } = setup(props);
      const buttons = Array.from(container.querySelectorAll('button'));
      expect(buttons.every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
      if ('busy' in props) expect(zone.getAttribute('aria-busy')).toBe('true');
      const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(input, 'files', { value: [image()], configurable: true });
      fire(input, 'change');
      fire(zone, 'drop', { dataTransfer: { files: [image()] } });
      fire(zone, 'paste', { clipboardData: { files: [image()], items: [] } });
      expect(onFile).not.toHaveBeenCalled();
    }
  });

  it('nhãn nút và gợi ý tuỳ chỉnh được (ô đọc nhãn bao bì dùng chữ khác ô ảnh sản phẩm)', () => {
    const { container } = setup({ pickLabel: 'Chọn ảnh bao bì', hint: 'Chụp mặt sau bao bì.' });
    expect(container.textContent).toMatch(/Chụp mặt sau bao bì\./);
    expect(byText(container, 'button', 'Chọn ảnh bao bì')).not.toBeNull();
  });
});
