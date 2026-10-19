// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStorefront: vi.fn(),
  readFile: vi.fn(),
  fetchOgImage: vi.fn(),
  imageBytes: vi.fn(),
  imageCtor: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ getStorefront: mocks.getStorefront }));
vi.mock('@/lib/og-image-fetch', () => ({ fetchOgImage: mocks.fetchOgImage }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile, default: { readFile: mocks.readFile } }));
vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(...args: unknown[]) {
      mocks.imageCtor(...args);
    }
    arrayBuffer() {
      return mocks.imageBytes();
    }
  },
}));

let renderStorefrontOgImage: typeof import('./og-render').renderStorefrontOgImage;

const DEFAULT_PNG = Buffer.from([137, 80, 78, 71, 1, 1, 1]);
const FONT = Buffer.from([0, 1, 0, 0]);
const CARD = new Uint8Array([137, 80, 78, 71, 9, 9]).buffer;

const store = { title: 'Shop Lan', avatarUrl: 'https://res.cloudinary.com/a.png', themeColor: null, collections: [] };
const params = Promise.resolve({ slug: 'lan' });

const bytesOf = async (res: Response) => Buffer.from(await res.arrayBuffer());

beforeEach(async () => {
  vi.resetModules();
  ({ renderStorefrontOgImage } = await import('./og-render'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mocks.getStorefront.mockResolvedValue(store);
  mocks.fetchOgImage.mockResolvedValue('data:image/png;base64,AQID');
  mocks.imageBytes.mockResolvedValue(CARD);
  mocks.readFile.mockImplementation(async (file: string) => {
    if (file.endsWith('.ttf')) return FONT;
    if (file.endsWith('og-default.png')) return DEFAULT_PNG;
    throw new Error(`không có ${file}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('renderStorefrontOgImage', () => {
  it('gian hàng bình thường: trả thẻ dựng riêng cho gian hàng, đọc font bằng readFile', async () => {
    const res = await renderStorefrontOgImage(params);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(await bytesOf(res)).toEqual(Buffer.from(CARD));
    const [, options] = mocks.imageCtor.mock.calls[0]!;
    expect(options).toMatchObject({ width: 1200, height: 630, fonts: [{ name: 'BeVietnam', weight: 600 }] });
    expect(options.fonts[0].data).toEqual(FONT);
    expect(mocks.readFile.mock.calls.some(([file]) => String(file).endsWith('BeVietnamPro-SemiBold.ttf'))).toBe(true);
  });

  it('API không trả lời: ảnh mặc định, không ném lỗi', async () => {
    mocks.getStorefront.mockRejectedValue(new Error('API unavailable'));
    const res = await renderStorefrontOgImage(params);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(await bytesOf(res)).toEqual(DEFAULT_PNG);
  });

  it('gian hàng không có hoặc đang ẩn (API 404): ảnh mặc định, không lộ tên', async () => {
    mocks.getStorefront.mockResolvedValue(null);
    const res = await renderStorefrontOgImage(params);
    expect(await bytesOf(res)).toEqual(DEFAULT_PNG);
    expect(mocks.imageCtor).not.toHaveBeenCalled();
  });

  it('không đọc được font: ảnh mặc định', async () => {
    mocks.readFile.mockImplementation(async (file: string) => {
      if (file.endsWith('og-default.png')) return DEFAULT_PNG;
      throw new Error('ENOENT');
    });
    const res = await renderStorefrontOgImage(params);
    expect(res.status).toBe(200);
    expect(await bytesOf(res)).toEqual(DEFAULT_PNG);
  });

  it('bộ dựng ảnh lỗi giữa chừng (satori): ảnh mặc định', async () => {
    mocks.imageBytes.mockRejectedValue(new Error('satori: unsupported image'));
    const res = await renderStorefrontOgImage(params);
    expect(res.status).toBe(200);
    expect(await bytesOf(res)).toEqual(DEFAULT_PNG);
  });

  it('tham số route lỗi: vẫn ảnh mặc định', async () => {
    const res = await renderStorefrontOgImage(Promise.reject(new Error('bad params')));
    expect(res.status).toBe(200);
    expect(await bytesOf(res)).toEqual(DEFAULT_PNG);
  });

  it('ngay cả ảnh mặc định đọc không được vẫn trả 200 image/png (PNG nhúng sẵn), không bao giờ 500', async () => {
    mocks.getStorefront.mockRejectedValue(new Error('API unavailable'));
    mocks.readFile.mockRejectedValue(new Error('ENOENT'));
    const res = await renderStorefrontOgImage(params);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const bytes = await bytesOf(res);
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });

  it('lỗi tải font lần đầu không bị nhớ: lần sau đọc được thì dựng thẻ bình thường', async () => {
    mocks.readFile.mockImplementationOnce(async () => {
      throw new Error('EAGAIN');
    });
    expect(await bytesOf(await renderStorefrontOgImage(params))).toEqual(DEFAULT_PNG);
    expect(await bytesOf(await renderStorefrontOgImage(params))).toEqual(Buffer.from(CARD));
  });
});
