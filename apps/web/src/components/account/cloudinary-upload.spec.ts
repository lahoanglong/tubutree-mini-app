import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCloudinaryConfigured, uploadToCloudinary } from './cloudinary-upload';

// Chép ý của image-upload.tsx (Mini App): có cấu hình thì tải lên preset unsigned, mọi lỗi trả null để nơi gọi tự xử lý.

const env = { cloud: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME, preset: process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET };
const fetchMock = vi.fn();

beforeEach(() => {
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = 'demo';
  process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET = 'avatars';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (env.cloud === undefined) delete process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  else process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = env.cloud;
  if (env.preset === undefined) delete process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
  else process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET = env.preset;
});

describe('isCloudinaryConfigured', () => {
  it('cần đủ cả cloud name lẫn upload preset', () => {
    expect(isCloudinaryConfigured()).toBe(true);
    process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET = '';
    expect(isCloudinaryConfigured()).toBe(false);
    process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET = 'avatars';
    delete process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    expect(isCloudinaryConfigured()).toBe(false);
  });
});

describe('uploadToCloudinary', () => {
  it('POST multipart tới image/upload của cloud, kèm file và upload_preset, trả secure_url', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/a.jpg' }) });
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    await expect(uploadToCloudinary(blob)).resolves.toBe('https://res.cloudinary.com/demo/a.jpg');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.cloudinary.com/v1_1/demo/image/upload');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('upload_preset')).toBe('avatars');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('chưa cấu hình: trả null và không gọi mạng', async () => {
    delete process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    await expect(uploadToCloudinary(new Blob(['x']))).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Cloudinary từ chối, mất mạng hoặc phản hồi thiếu secure_url: null', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await expect(uploadToCloudinary(new Blob(['x']))).resolves.toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(uploadToCloudinary(new Blob(['x']))).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await expect(uploadToCloudinary(new Blob(['x']))).resolves.toBeNull();
  });
});
