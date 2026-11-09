// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { Composer } from './composer';

const COMPRESSED = 'data:image/jpeg;base64,' + btoa('nho');

function stubCanvas(opts: { decodeFails?: boolean } = {}) {
  class FakeImage {
    width = 4000;
    height = 3000;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) {
      queueMicrotask(() => (opts.decodeFails ? this.onerror?.() : this.onload?.()));
    }
  }
  vi.stubGlobal('Image', FakeImage);
  const ctx = { set fillStyle(_v: string) {}, fillRect: () => {}, drawImage: () => {} };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(COMPRESSED);
}

let mounted: Rendered | null = null;

const OK_RESPONSE = { ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/a.jpg' }) };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function mount(fetchImpl?: () => Promise<unknown>, disabled?: boolean) {
  const fetchMock = vi.fn<(url: string, init: { body: FormData }) => Promise<unknown>>(fetchImpl ?? (async () => OK_RESPONSE));
  vi.stubGlobal('fetch', fetchMock);
  const onSend = vi.fn();
  const onSendImage = vi.fn();
  const onImageError = vi.fn();
  const qc = new QueryClient();
  const ui = (d?: boolean) => <Composer onSend={onSend} onSendImage={onSendImage} onImageError={onImageError} disabled={d} />;
  mounted = render(ui(disabled), qc);
  const container = mounted.container;
  const root = mounted.root;
  const input = () => container.querySelector('input[type="file"]') as HTMLInputElement;
  const change = (file: File) => {
    Object.defineProperty(input(), 'files', { value: [file], configurable: true });
    input().dispatchEvent(new Event('change', { bubbles: true }));
  };
  const pick = async (file: File) => {
    act(() => change(file));
    await flush(8);
  };
  const pickTogether = (...files: File[]) =>
    act(() => {
      for (const f of files) change(f);
    });
  const attach = () => container.querySelector('button[aria-label="Đính kèm ảnh"]') as HTMLButtonElement;
  const attachClickable = () => {
    const spy = vi.spyOn(input(), 'click').mockImplementation(() => {});
    act(() => {
      attach().click();
    });
    return spy.mock.calls.length === 1;
  };
  const textarea = () => container.querySelector('textarea') as HTMLTextAreaElement;
  const send = () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Gửi') as HTMLButtonElement;
  const type = (value: string) => typeInto(textarea(), value);
  const setDisabled = (d: boolean) =>
    act(() => {
      root.render(<QueryClientProvider client={qc}>{ui(d)}</QueryClientProvider>);
    });
  const sent = () => fetchMock.mock.calls[0]![1].body.get('file') as Blob;
  return { pick, pickTogether, sent, attachClickable, attach, input, textarea, send, type, setDisabled, container, fetchMock, onSend, onSendImage, onImageError };
}
const file = (type: string, bytes: number, name: string) => new File([new Uint8Array(bytes)], name, { type });

describe('Composer chat CSKH (web) — ảnh gửi lên Cloudinary', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME', 'demo');
    vi.stubEnv('NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET', 'unsigned');
  });
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('JPEG lớn đi qua bước nén trước khi tải lên', async () => {
    stubCanvas();
    const m = mount();
    const big = file('image/jpeg', 12 * 1024 * 1024, 'big.jpg');
    await m.pick(big);
    expect(m.onSendImage).toHaveBeenCalledWith('https://res.cloudinary.com/demo/a.jpg');
    expect(m.sent()).not.toBe(big);
    expect(m.sent().size).toBeLessThan(1024);
    expect(m.sent().type).toBe('image/jpeg');
  });

  it('PNG nhỏ giữ nguyên file', async () => {
    stubCanvas();
    const m = mount();
    const png = file('image/png', 50 * 1024, 'qr.png');
    await m.pick(png);
    expect(m.onSendImage).toHaveBeenCalled();
    expect(m.sent()).toBe(png);
  });

  it('JPEG nhỏ và cạnh vừa cỡ giữ nguyên file', async () => {
    class SmallImage {
      width = 800;
      height = 600;
      onload: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', SmallImage);
    const m = mount();
    const jpg = file('image/jpeg', 100 * 1024, 'small.jpg');
    await m.pick(jpg);
    expect(m.onSendImage).toHaveBeenCalled();
    expect(m.sent()).toBe(jpg);
  });

  it('nén lỗi thì vẫn gửi file gốc, không kẹt trạng thái đang gửi', async () => {
    stubCanvas({ decodeFails: true });
    const m = mount();
    const big = file('image/jpeg', 12 * 1024 * 1024, 'heic-as.jpg');
    await m.pick(big);
    expect(m.onSendImage).toHaveBeenCalledWith('https://res.cloudinary.com/demo/a.jpg');
    expect(m.sent()).toBe(big);
    expect(m.onImageError).not.toHaveBeenCalled();
    expect(m.attachClickable()).toBe(true);
  });

  it('tải lên lỗi thì báo lỗi và cho chọn ảnh lại', async () => {
    stubCanvas();
    const m = mount(async () => ({ ok: false }));
    await m.pick(file('image/jpeg', 12 * 1024 * 1024, 'big.jpg'));
    expect(m.onImageError).toHaveBeenCalledWith('Tải ảnh thất bại. Hãy chọn lại ảnh khác.');
    expect(m.onSendImage).not.toHaveBeenCalled();
  });

  it('bước nén ném lỗi thì báo lỗi, không gửi ảnh và nút đính kèm bấm lại được', async () => {
    stubCanvas();
    const prep = await import('@/components/account/prepare-for-cloudinary');
    vi.spyOn(prep, 'prepareForCloudinary').mockRejectedValue(new Error('nén lỗi'));
    const m = mount();
    await m.pick(file('image/jpeg', 12 * 1024 * 1024, 'big.jpg'));
    expect(m.onImageError).toHaveBeenCalledWith('Tải ảnh thất bại. Hãy chọn lại ảnh khác.');
    expect(m.onSendImage).not.toHaveBeenCalled();
    expect(m.attachClickable()).toBe(true);
  });

  it('tải lên ném lỗi thì báo lỗi, không gửi ảnh và nút đính kèm bấm lại được', async () => {
    stubCanvas();
    const m = mount(async () => {
      throw new Error('mất mạng');
    });
    const up = await import('@/components/account/cloudinary-upload');
    vi.spyOn(up, 'uploadToCloudinary').mockRejectedValue(new Error('upload lỗi'));
    await m.pick(file('image/jpeg', 12 * 1024 * 1024, 'big.jpg'));
    expect(m.onImageError).toHaveBeenCalledWith('Tải ảnh thất bại. Hãy chọn lại ảnh khác.');
    expect(m.onSendImage).not.toHaveBeenCalled();
    expect(m.attachClickable()).toBe(true);
  });

  it('hai lần chọn ảnh cùng nhịp: chỉ tải lên một lần và chỉ gửi một ảnh', async () => {
    stubCanvas();
    const gate = deferred<unknown>();
    const m = mount(() => gate.promise);
    m.pickTogether(file('image/png', 1024, 'a.png'), file('image/png', 1024, 'b.png'));
    await flush(8);
    expect(m.fetchMock).toHaveBeenCalledTimes(1);
    gate.resolve(OK_RESPONSE);
    await flush(8);
    expect(m.onSendImage).toHaveBeenCalledTimes(1);
    expect(m.fetchMock).toHaveBeenCalledTimes(1);
    expect(m.onImageError).not.toHaveBeenCalled();
  });

  it('đang tải: input ảnh khoá, nút đính kèm mờ + not-allowed, vùng bọc báo bận, bấm không mở hộp chọn file; tải xong mở lại', async () => {
    stubCanvas();
    const gate = deferred<unknown>();
    const m = mount(() => gate.promise);
    expect(m.container.querySelector('[aria-busy]')).toBeNull();
    expect(m.input().disabled).toBe(false);
    expect(m.attach().style.cursor).toBe('pointer');
    expect(m.attach().style.opacity).toBe('');
    await m.pick(file('image/png', 1024, 'a.png'));
    expect(m.input().disabled).toBe(true);
    expect(m.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(m.attach().style.cursor).toBe('not-allowed');
    expect(m.attach().style.opacity).toBe('0.55');
    expect(m.attachClickable()).toBe(false);
    gate.resolve(OK_RESPONSE);
    await flush(8);
    expect(m.input().disabled).toBe(false);
    expect(m.container.querySelector('[aria-busy]')).toBeNull();
    expect(m.attach().style.cursor).toBe('pointer');
    expect(m.attach().style.opacity).toBe('');
    expect(m.attachClickable()).toBe(true);
  });

  it('ảnh quá lớn: báo lỗi và không khoá — chọn ảnh khác ngay sau đó vẫn tải được', async () => {
    stubCanvas();
    const m = mount();
    const huge = file('image/png', 1, 'to.png');
    Object.defineProperty(huge, 'size', { value: 21 * 1024 * 1024 });
    await m.pick(huge);
    expect(m.onImageError).toHaveBeenCalledWith('Ảnh quá lớn (tối đa 20MB). Hãy chọn ảnh khác nhé.');
    expect(m.fetchMock).not.toHaveBeenCalled();
    expect(m.input().disabled).toBe(false);
    await m.pick(file('image/png', 1024, 'ok.png'));
    expect(m.onSendImage).toHaveBeenCalledTimes(1);
    expect(m.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('hộp chọn file đóng mà không chọn gì: không tải, không báo, không khoá', async () => {
    const m = mount();
    Object.defineProperty(m.input(), 'files', { value: [], configurable: true });
    act(() => {
      m.input().dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(4);
    expect(m.fetchMock).not.toHaveBeenCalled();
    expect(m.onImageError).not.toHaveBeenCalled();
    expect(m.input().disabled).toBe(false);
  });

  it('không disabled: ô nhập và input ảnh bật, Gửi chỉ bật khi có chữ', () => {
    const m = mount();
    expect(m.textarea().disabled).toBe(false);
    expect(m.input().disabled).toBe(false);
    expect(m.send().disabled).toBe(true);
    m.type('chào shop');
    expect(m.send().disabled).toBe(false);
  });

  it('disabled: ô nhập, input ảnh và Gửi khoá; nút đính kèm mờ + not-allowed, bấm không mở hộp chọn file, không báo bận', () => {
    const m = mount(undefined, true);
    expect(m.textarea().disabled).toBe(true);
    expect(m.input().disabled).toBe(true);
    expect(m.send().disabled).toBe(true);
    expect(m.attach().style.cursor).toBe('not-allowed');
    expect(m.attach().style.opacity).toBe('0.55');
    expect(m.container.querySelector('[aria-busy]')).toBeNull();
    expect(m.attachClickable()).toBe(false);
  });

  it('disabled: sự kiện chọn ảnh vẫn tới thì không tải gì, không báo gì', async () => {
    stubCanvas();
    const m = mount(undefined, true);
    await m.pick(file('image/png', 1024, 'a.png'));
    expect(m.fetchMock).not.toHaveBeenCalled();
    expect(m.onSendImage).not.toHaveBeenCalled();
    expect(m.onImageError).not.toHaveBeenCalled();
  });

  it('đã gõ chữ rồi mới disabled: Gửi khoá, bấm không gọi onSend; hết disabled thì gửi được', () => {
    const m = mount();
    m.type('đơn của tôi');
    m.setDisabled(true);
    expect(m.send().disabled).toBe(true);
    click(m.send());
    expect(m.onSend).not.toHaveBeenCalled();
    m.setDisabled(false);
    click(m.send());
    expect(m.onSend).toHaveBeenCalledTimes(1);
    expect(m.onSend).toHaveBeenCalledWith('đơn của tôi');
  });

  it('hai cú bấm Gửi cùng nhịp: onSend chỉ gọi một lần với chữ đã cắt khoảng trắng, ô nhập được xoá', () => {
    const m = mount();
    m.type('  xin chào  ');
    const btn = m.send();
    act(() => {
      btn.click();
      btn.click();
    });
    expect(m.onSend).toHaveBeenCalledTimes(1);
    expect(m.onSend).toHaveBeenCalledWith('xin chào');
    expect(m.textarea().value).toBe('');
    expect(m.send().disabled).toBe(true);
  });

  it('gửi xong gõ tiếp: tin thứ hai vẫn đi, khoá không kẹt', () => {
    const m = mount();
    m.type('một');
    click(m.send());
    m.type('hai');
    click(m.send());
    expect(m.onSend.mock.calls).toEqual([['một'], ['hai']]);
  });

  it('onSend ném lỗi: chữ còn nguyên và bấm Gửi lại vẫn gửi được (khoá không kẹt)', () => {
    const m = mount();
    m.onSend.mockImplementationOnce(() => {
      throw new Error('hỏng');
    });
    const swallow = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', swallow);
    try {
      m.type('chào');
      click(m.send());
      expect(m.textarea().value).toBe('chào');
      click(m.send());
    } finally {
      window.removeEventListener('error', swallow);
    }
    expect(m.onSend).toHaveBeenCalledTimes(2);
    expect(m.onSend).toHaveBeenLastCalledWith('chào');
    expect(m.textarea().value).toBe('');
  });

  it('chỉ toàn khoảng trắng: Gửi khoá và không gọi onSend', () => {
    const m = mount();
    m.type('   ');
    expect(m.send().disabled).toBe(true);
    click(m.send());
    expect(m.onSend).not.toHaveBeenCalled();
  });
});
