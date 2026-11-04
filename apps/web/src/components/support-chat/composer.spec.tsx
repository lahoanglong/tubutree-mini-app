// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { flush, render, type Rendered } from '@/test-utils/dom';
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

function mount(fetchImpl?: () => Promise<unknown>) {
  const fetchMock = vi.fn<(url: string, init: { body: FormData }) => Promise<unknown>>(
    fetchImpl ?? (async () => ({ ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/a.jpg' }) })),
  );
  vi.stubGlobal('fetch', fetchMock);
  const onSendImage = vi.fn();
  const onImageError = vi.fn();
  mounted = render(<Composer onSend={() => {}} onSendImage={onSendImage} onImageError={onImageError} />);
  const input = mounted.container.querySelector('input[type="file"]') as HTMLInputElement;
  const pick = async (file: File) => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(8);
  };
  const sent = () => fetchMock.mock.calls[0]![1].body.get('file') as Blob;
  return { pick, sent, onSendImage, onImageError };
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
  });

  it('tải lên lỗi thì báo lỗi và cho chọn ảnh lại', async () => {
    stubCanvas();
    const m = mount(async () => ({ ok: false }));
    await m.pick(file('image/jpeg', 12 * 1024 * 1024, 'big.jpg'));
    expect(m.onImageError).toHaveBeenCalledWith('Tải ảnh thất bại. Hãy chọn lại ảnh khác.');
    expect(m.onSendImage).not.toHaveBeenCalled();
  });
});
