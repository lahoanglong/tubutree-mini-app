import { describe, expect, it, vi } from 'vitest';
import {
  REVIEW_VIDEO_MAX_BYTES,
  REVIEW_VIDEO_MAX_SECONDS,
  VideoUploadError,
  readVideoDuration,
  uploadCloudinaryVideo,
  videoUploadCopy,
} from './cloudinary-video';

const CFG = { cloudName: 'tubu-cloud', uploadPreset: 'tubu_unsigned' };
const file = (size = 1024) => new Blob([new Uint8Array(size)], { type: 'video/mp4' });
const ok = (body: Record<string, unknown>) => vi.fn().mockResolvedValue({ ok: true, json: async () => body });

describe('uploadCloudinaryVideo', () => {
  it('gọi đúng địa chỉ /video/upload của cloud với preset không ký, trả secure_url', async () => {
    const fetchImpl = ok({ secure_url: 'https://res.cloudinary.com/tubu-cloud/video/upload/v1/a.mp4', duration: 12.4 });
    const url = await uploadCloudinaryVideo(file(), CFG, { fetchImpl });
    expect(url).toBe('https://res.cloudinary.com/tubu-cloud/video/upload/v1/a.mp4');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchImpl.mock.calls[0]!;
    expect(endpoint).toBe('https://api.cloudinary.com/v1_1/tubu-cloud/video/upload');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('upload_preset')).toBe('tubu_unsigned');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('giới hạn mặc định: 50MB và 60 giây (cùng cho Mini App và web)', () => {
    expect(REVIEW_VIDEO_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(REVIEW_VIDEO_MAX_SECONDS).toBe(60);
  });

  it('quá dung lượng: báo lỗi nói cách xử lý, không gọi Cloudinary', async () => {
    const fetchImpl = ok({});
    const big = { size: REVIEW_VIDEO_MAX_BYTES + 1 } as Blob;
    await expect(uploadCloudinaryVideo(big, CFG, { fetchImpl })).rejects.toThrow(videoUploadCopy.tooLarge);
    await expect(uploadCloudinaryVideo(big, CFG, { fetchImpl })).rejects.toBeInstanceOf(VideoUploadError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('đúng 50MB vẫn tải được', async () => {
    const fetchImpl = ok({ secure_url: 'https://res.cloudinary.com/x/video/upload/a.mp4' });
    await expect(uploadCloudinaryVideo({ size: REVIEW_VIDEO_MAX_BYTES } as Blob, CFG, { fetchImpl })).resolves.toContain('a.mp4');
  });

  it('đọc được độ dài ở máy và quá 60 giây: báo lỗi trước khi tải lên', async () => {
    const fetchImpl = ok({});
    const readDuration = vi.fn().mockResolvedValue(75);
    await expect(uploadCloudinaryVideo(file(), CFG, { fetchImpl, readDuration })).rejects.toThrow(videoUploadCopy.tooLong(60));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('đúng 60 giây (cho lệch dưới 1 giây do máy quay) vẫn tải được', async () => {
    const fetchImpl = ok({ secure_url: 'https://res.cloudinary.com/x/video/upload/a.mp4' });
    await expect(uploadCloudinaryVideo(file(), CFG, { fetchImpl, readDuration: async () => 60.6 })).resolves.toContain('a.mp4');
  });

  it('không đọc được độ dài ở máy (null): vẫn tải, kiểm theo duration Cloudinary trả về', async () => {
    const fetchImpl = ok({ secure_url: 'https://res.cloudinary.com/x/video/upload/a.mp4', duration: 90 });
    await expect(uploadCloudinaryVideo(file(), CFG, { fetchImpl, readDuration: async () => null })).rejects.toThrow(videoUploadCopy.tooLong(60));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('đọc độ dài ở máy ném lỗi: bỏ qua bước đó, không chặn việc tải', async () => {
    const fetchImpl = ok({ secure_url: 'https://res.cloudinary.com/x/video/upload/a.mp4', duration: 30 });
    await expect(
      uploadCloudinaryVideo(file(), CFG, {
        fetchImpl,
        readDuration: async () => {
          throw new Error('codec');
        },
      }),
    ).resolves.toContain('a.mp4');
  });

  it('Cloudinary trả lỗi HTTP, thiếu secure_url hoặc mạng đứt: cùng một lời báo thử lại', async () => {
    await expect(uploadCloudinaryVideo(file(), CFG, { fetchImpl: vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) })).rejects.toThrow(videoUploadCopy.failed);
    await expect(uploadCloudinaryVideo(file(), CFG, { fetchImpl: ok({}) })).rejects.toThrow(videoUploadCopy.failed);
    await expect(uploadCloudinaryVideo(file(), CFG, { fetchImpl: vi.fn().mockRejectedValue(new Error('network')) })).rejects.toThrow(videoUploadCopy.failed);
  });

  it('giới hạn tuỳ chỉnh được tôn trọng', async () => {
    const fetchImpl = ok({});
    await expect(uploadCloudinaryVideo({ size: 2000 } as Blob, CFG, { fetchImpl, maxBytes: 1000 })).rejects.toThrow(videoUploadCopy.tooLarge);
    await expect(uploadCloudinaryVideo(file(), CFG, { fetchImpl, maxSeconds: 10, readDuration: async () => 11.5 })).rejects.toThrow(videoUploadCopy.tooLong(10));
  });
});

describe('readVideoDuration', () => {
  type Handlers = { onloadedmetadata: (() => void) | null; onerror: (() => void) | null };
  const probeWith = (setup: (v: Handlers & { duration: number; src: string }) => void) => {
    const revoked: string[] = [];
    const video = { preload: '', muted: false, src: '', duration: Number.NaN, onloadedmetadata: null, onerror: null } as Handlers & {
      preload: string; muted: boolean; src: string; duration: number;
    };
    const probe = {
      createVideo: () => video,
      createObjectURL: () => 'blob:abc',
      revokeObjectURL: (u: string) => void revoked.push(u),
    };
    return { probe, video, revoked, trigger: () => setup(video) };
  };

  it('đọc được độ dài từ metadata rồi thu hồi địa chỉ tạm', async () => {
    const p = probeWith((v) => {
      v.duration = 42.5;
      v.onloadedmetadata?.();
    });
    const pending = readVideoDuration(file(), p.probe as never, 1000);
    p.trigger();
    await expect(pending).resolves.toBe(42.5);
    expect(p.revoked).toEqual(['blob:abc']);
  });

  it('tệp không đọc được (onerror) hoặc độ dài không hữu hạn: null', async () => {
    const e = probeWith((v) => v.onerror?.());
    const pe = readVideoDuration(file(), e.probe as never, 1000);
    e.trigger();
    await expect(pe).resolves.toBeNull();
    const i = probeWith((v) => {
      v.duration = Number.POSITIVE_INFINITY;
      v.onloadedmetadata?.();
    });
    const pi = readVideoDuration(file(), i.probe as never, 1000);
    i.trigger();
    await expect(pi).resolves.toBeNull();
  });

  it('chờ quá lâu thì thôi (null), không treo nút tải', async () => {
    vi.useFakeTimers();
    try {
      const p = probeWith(() => undefined);
      const pending = readVideoDuration(file(), p.probe as never, 5000);
      await vi.advanceTimersByTimeAsync(5000);
      await expect(pending).resolves.toBeNull();
      expect(p.revoked).toEqual(['blob:abc']);
    } finally {
      vi.useRealTimers();
    }
  });
});
