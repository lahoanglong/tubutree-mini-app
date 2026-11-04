import { fireEvent, render, waitFor, within } from '@testing-library/react';
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

async function mount() {
  vi.stubEnv('VITE_CLOUDINARY_CLOUD_NAME', 'demo');
  vi.stubEnv('VITE_CLOUDINARY_UPLOAD_PRESET', 'unsigned');
  vi.resetModules();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/a.jpg' }) });
  vi.stubGlobal('fetch', fetchMock);
  const { Composer } = await import('./composer');
  const onSendImage = vi.fn();
  const onImageError = vi.fn();
  const { container } = render(<Composer onSend={() => {}} onSendImage={onSendImage} onImageError={onImageError} />);
  const pick = (file: File) => fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
  const sent = () => (fetchMock.mock.calls[0]![1] as { body: FormData }).body.get('file') as Blob;
  return { pick, sent, onSendImage, onImageError, container };
}
const file = (type: string, bytes: number, name: string) => new File([new Uint8Array(bytes)], name, { type });

describe('Composer chat CSKH — ảnh gửi lên Cloudinary', () => {
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
});
