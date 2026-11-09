import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const COMPRESSED = 'data:image/jpeg;base64,' + btoa('nho');

function stubCanvas() {
  class FakeImage {
    width = 4000;
    height = 3000;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', FakeImage);
  const ctx = { set fillStyle(_v: string) {}, fillRect: () => {}, drawImage: () => {} };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(COMPRESSED);
}

const OK_RESPONSE = { ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/a.jpg' }) };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function mount(opts: { disabled?: boolean; fetchImpl?: () => Promise<unknown> } = {}) {
  vi.stubEnv('VITE_CLOUDINARY_CLOUD_NAME', 'demo');
  vi.stubEnv('VITE_CLOUDINARY_UPLOAD_PRESET', 'unsigned');
  vi.resetModules();
  const fetchMock = vi.fn().mockImplementation(opts.fetchImpl ?? (async () => OK_RESPONSE));
  vi.stubGlobal('fetch', fetchMock);
  const { Composer } = await import('./composer');
  const onSend = vi.fn();
  const onSendImage = vi.fn();
  const onImageError = vi.fn();
  const ui = (disabled?: boolean) => <Composer onSend={onSend} onSendImage={onSendImage} onImageError={onImageError} disabled={disabled} />;
  const { container, rerender } = render(ui(opts.disabled));
  const input = () => container.querySelector('input[type="file"]') as HTMLInputElement;
  const pick = (file: File) => fireEvent.change(input(), { target: { files: [file] } });
  const sent = () => (fetchMock.mock.calls[0]![1] as { body: FormData }).body.get('file') as Blob;
  const textarea = () => within(container).getByLabelText('Nội dung tin nhắn') as HTMLTextAreaElement;
  const send = () => within(container).getByRole('button', { name: 'Gửi' }) as HTMLButtonElement;
  const attach = () => within(container).getByRole('button', { name: 'Đính kèm ảnh' }) as HTMLButtonElement;
  const type = (value: string) => fireEvent.change(textarea(), { target: { value } });
  const setDisabled = (disabled: boolean) => rerender(ui(disabled));
  return { pick, sent, onSend, onSendImage, onImageError, container, fetchMock, input, textarea, send, attach, type, setDisabled };
}
const file = (type: string, bytes: number, name: string) => new File([new Uint8Array(bytes)], name, { type });

// Mỗi ca nạp lại composer sau resetModules (CONFIGURED đọc một lần lúc nạp module): ca đầu chịu lần biên dịch nguội ~5 s khi máy tải.
describe('Composer chat CSKH — ảnh gửi lên Cloudinary', { timeout: 20_000 }, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('../image-upload');
  });

  it('JPEG lớn đi qua bước nén trước khi tải lên', async () => {
    stubCanvas();
    const m = await mount();
    const big = file('image/jpeg', 1024, 'big.jpg');
    m.pick(big);
    await waitFor(() => expect(m.onSendImage).toHaveBeenCalledWith('https://res.cloudinary.com/demo/a.jpg'));
    expect(m.sent()).not.toBe(big);
    expect(m.sent().size).toBeLessThan(1024);
    expect(m.sent().type).toBe('image/jpeg');
  });

  it.each(['prepare', 'upload'] as const)('%s ném lỗi: nút ảnh bật lại và có báo lỗi', async (which) => {
    const boom = async () => {
      throw new Error('hỏng');
    };
    vi.doMock('../image-upload', () => ({
      isCloudinaryConfigured: () => true,
      MAX_IMAGE_BYTES: 20 * 1024 * 1024,
      prepareForCloudinary: which === 'prepare' ? boom : async (f: File) => f,
      uploadToCloudinary: which === 'upload' ? boom : async () => 'https://res.cloudinary.com/demo/a.jpg',
    }));
    const m = await mount();
    m.pick(file('image/png', 1024, 'qr.png'));
    await waitFor(() => expect(m.onImageError).toHaveBeenCalledWith('Tải ảnh thất bại. Hãy chọn lại ảnh khác.'));
    expect(m.onSendImage).not.toHaveBeenCalled();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(within(m.container).getByRole('button', { name: 'Đính kèm ảnh' }));
    expect(click).toHaveBeenCalled();
  });

  it('PNG nhỏ giữ nguyên file', async () => {
    stubCanvas();
    const m = await mount();
    const png = file('image/png', 50 * 1024, 'qr.png');
    m.pick(png);
    await waitFor(() => expect(m.onSendImage).toHaveBeenCalled());
    expect(m.sent()).toBe(png);
  });

  it('hai lần chọn ảnh cùng nhịp: chỉ tải lên một lần và chỉ gửi một ảnh', async () => {
    const gate = deferred<unknown>();
    const m = await mount({ fetchImpl: () => gate.promise });
    await act(async () => {
      m.pick(file('image/png', 1024, 'a.png'));
      m.pick(file('image/png', 1024, 'b.png'));
    });
    await waitFor(() => expect(m.fetchMock).toHaveBeenCalledTimes(1));
    gate.resolve(OK_RESPONSE);
    await waitFor(() => expect(m.onSendImage).toHaveBeenCalledTimes(1));
    expect(m.fetchMock).toHaveBeenCalledTimes(1);
    expect(m.onImageError).not.toHaveBeenCalled();
  });

  it('đang tải: input ảnh khoá, nút đính kèm mờ + not-allowed, vùng bọc báo bận, bấm không mở hộp chọn file; tải xong mở lại', async () => {
    const gate = deferred<unknown>();
    const m = await mount({ fetchImpl: () => gate.promise });
    expect(m.container.querySelector('[aria-busy]')).toBeNull();
    expect(m.input().disabled).toBe(false);
    expect(m.attach().style.cursor).toBe('pointer');
    expect(m.attach().style.opacity).toBe('');
    m.pick(file('image/png', 1024, 'a.png'));
    await waitFor(() => expect(m.input().disabled).toBe(true));
    expect(m.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(m.attach().style.cursor).toBe('not-allowed');
    expect(m.attach().style.opacity).toBe('0.55');
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(m.attach());
    expect(click).not.toHaveBeenCalled();
    gate.resolve(OK_RESPONSE);
    await waitFor(() => expect(m.input().disabled).toBe(false));
    expect(m.container.querySelector('[aria-busy]')).toBeNull();
    expect(m.attach().style.cursor).toBe('pointer');
    expect(m.attach().style.opacity).toBe('');
    fireEvent.click(m.attach());
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('ảnh quá lớn: báo lỗi và không khoá — chọn ảnh khác ngay sau đó vẫn tải được', async () => {
    const m = await mount();
    const huge = file('image/png', 1, 'to.png');
    Object.defineProperty(huge, 'size', { value: 21 * 1024 * 1024 });
    m.pick(huge);
    expect(m.onImageError).toHaveBeenCalledWith('Ảnh quá lớn (tối đa 20MB). Hãy chọn ảnh khác nhé.');
    expect(m.fetchMock).not.toHaveBeenCalled();
    expect(m.input().disabled).toBe(false);
    m.pick(file('image/png', 1024, 'ok.png'));
    await waitFor(() => expect(m.onSendImage).toHaveBeenCalledTimes(1));
    expect(m.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('hộp chọn file đóng mà không chọn gì: không tải, không báo, không khoá', async () => {
    const m = await mount();
    fireEvent.change(m.input(), { target: { files: [] } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(m.fetchMock).not.toHaveBeenCalled();
    expect(m.onImageError).not.toHaveBeenCalled();
    expect(m.input().disabled).toBe(false);
  });

  it('không disabled: ô nhập, input ảnh và nút Gửi (khi có chữ) đều bật', async () => {
    const m = await mount();
    expect(m.textarea().disabled).toBe(false);
    expect(m.input().disabled).toBe(false);
    expect(m.send().disabled).toBe(true);
    m.type('chào shop');
    expect(m.send().disabled).toBe(false);
  });

  it('disabled: ô nhập, input ảnh và Gửi khoá; nút đính kèm mờ + not-allowed, bấm không mở hộp chọn file, không báo bận', async () => {
    const m = await mount({ disabled: true });
    expect(m.textarea().disabled).toBe(true);
    expect(m.input().disabled).toBe(true);
    expect(m.send().disabled).toBe(true);
    expect(m.attach().style.cursor).toBe('not-allowed');
    expect(m.attach().style.opacity).toBe('0.55');
    expect(m.container.querySelector('[aria-busy]')).toBeNull();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(m.attach());
    expect(click).not.toHaveBeenCalled();
  });

  it('disabled: sự kiện chọn ảnh vẫn tới thì không tải gì, không báo gì', async () => {
    const m = await mount({ disabled: true });
    m.pick(file('image/png', 1024, 'a.png'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(m.fetchMock).not.toHaveBeenCalled();
    expect(m.onSendImage).not.toHaveBeenCalled();
    expect(m.onImageError).not.toHaveBeenCalled();
  });

  it('đã gõ chữ rồi mới disabled: Gửi khoá, bấm không gọi onSend; hết disabled thì gửi được', async () => {
    const m = await mount();
    m.type('đơn của tôi');
    m.setDisabled(true);
    expect(m.send().disabled).toBe(true);
    fireEvent.click(m.send());
    expect(m.onSend).not.toHaveBeenCalled();
    m.setDisabled(false);
    fireEvent.click(m.send());
    expect(m.onSend).toHaveBeenCalledTimes(1);
    expect(m.onSend).toHaveBeenCalledWith('đơn của tôi');
  });

  it('hai cú bấm Gửi cùng nhịp: onSend chỉ gọi một lần với chữ đã cắt khoảng trắng, ô nhập được xoá', async () => {
    const m = await mount();
    m.type('  xin chào  ');
    await act(async () => {
      fireEvent.click(m.send());
      fireEvent.click(m.send());
    });
    expect(m.onSend).toHaveBeenCalledTimes(1);
    expect(m.onSend).toHaveBeenCalledWith('xin chào');
    expect(m.textarea().value).toBe('');
    expect(m.send().disabled).toBe(true);
  });

  it('gửi xong gõ tiếp: tin thứ hai vẫn đi, khoá không kẹt', async () => {
    const m = await mount();
    m.type('một');
    fireEvent.click(m.send());
    m.type('hai');
    fireEvent.click(m.send());
    expect(m.onSend.mock.calls).toEqual([['một'], ['hai']]);
  });

  it('onSend ném lỗi: chữ còn nguyên và bấm Gửi lại vẫn gửi được (khoá không kẹt)', async () => {
    const m = await mount();
    m.onSend.mockImplementationOnce(() => {
      throw new Error('hỏng');
    });
    const swallow = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', swallow);
    try {
      m.type('chào');
      fireEvent.click(m.send());
      expect(m.textarea().value).toBe('chào');
      fireEvent.click(m.send());
    } finally {
      window.removeEventListener('error', swallow);
    }
    expect(m.onSend).toHaveBeenCalledTimes(2);
    expect(m.onSend).toHaveBeenLastCalledWith('chào');
    expect(m.textarea().value).toBe('');
  });

  it('chỉ toàn khoảng trắng: Gửi khoá và không gọi onSend', async () => {
    const m = await mount();
    m.type('   ');
    expect(m.send().disabled).toBe(true);
    fireEvent.click(m.send());
    expect(m.onSend).not.toHaveBeenCalled();
  });
});
