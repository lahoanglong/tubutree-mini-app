/**
 * Tải video đánh giá lên Cloudinary (preset không ký), MỘT bản cho Mini App và web: cùng giới hạn, cùng lời báo lỗi. Máy chủ chỉ nhận
 * video đã tải lên Cloudinary (URL dán tay bị từ chối), nên không có đường nào khác để đính video vào đánh giá.
 */

import { VIDEO_UPLOADING } from './review-copy';

export const REVIEW_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const REVIEW_VIDEO_MAX_SECONDS = 60;

/** Máy quay thường ghi dư dưới một giây so với "60 giây" khách thấy: không chặn nhầm video đúng hạn mức. */
const DURATION_SLACK_SECONDS = 1;

export const videoUploadCopy = {
  tooLarge: 'Video quá lớn (tối đa 50MB). Hãy quay ngắn hơn nhé.',
  tooLong: (maxSeconds: number) => `Video dài quá ${maxSeconds} giây. Hãy cắt ngắn lại rồi chọn lại nhé.`,
  failed: 'Tải video thất bại, thử lại.',
  pick: (maxSeconds: number) => `Quay/đăng video review (≤ ${maxSeconds}s)`,
  uploading: VIDEO_UPLOADING,
} as const;

/** Lỗi đã có lời báo cho khách trong `message`. */
export class VideoUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoUploadError';
  }
}

export interface VideoUploadConfig {
  cloudName: string;
  uploadPreset: string;
}

export interface VideoUploadOptions {
  maxBytes?: number;
  maxSeconds?: number;
  fetchImpl?: typeof fetch;
  /** Độ dài đọc từ tệp ở máy (giây) để chặn video quá dài TRƯỚC khi tốn dữ liệu tải lên; null hoặc lỗi thì bỏ qua bước này. */
  readDuration?: (file: Blob) => Promise<number | null>;
}

export async function uploadCloudinaryVideo(file: Blob, cfg: VideoUploadConfig, opts: VideoUploadOptions = {}): Promise<string> {
  const maxBytes = opts.maxBytes ?? REVIEW_VIDEO_MAX_BYTES;
  const maxSeconds = opts.maxSeconds ?? REVIEW_VIDEO_MAX_SECONDS;
  const tooLong = (seconds: number) => seconds > maxSeconds + DURATION_SLACK_SECONDS;

  if (file.size > maxBytes) throw new VideoUploadError(videoUploadCopy.tooLarge);
  if (opts.readDuration) {
    const seconds = await opts.readDuration(file).catch(() => null);
    if (seconds != null && tooLong(seconds)) throw new VideoUploadError(videoUploadCopy.tooLong(maxSeconds));
  }

  let data: { secure_url?: string; duration?: number };
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('upload_preset', cfg.uploadPreset);
    const res = await (opts.fetchImpl ?? fetch)(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/video/upload`, { method: 'POST', body: form });
    if (!res.ok) throw new Error('upload failed');
    data = (await res.json()) as typeof data;
  } catch {
    throw new VideoUploadError(videoUploadCopy.failed);
  }
  if (!data.secure_url) throw new VideoUploadError(videoUploadCopy.failed);
  // Không đọc được độ dài ở máy thì Cloudinary là nguồn cuối: video đã lên nhưng chưa gắn vào đánh giá nào.
  if (typeof data.duration === 'number' && tooLong(data.duration)) throw new VideoUploadError(videoUploadCopy.tooLong(maxSeconds));
  return data.secure_url;
}

interface ProbeVideo {
  preload: string;
  muted: boolean;
  src: string;
  duration: number;
  onloadedmetadata: (() => void) | null;
  onerror: (() => void) | null;
}

export interface VideoProbe {
  createVideo: () => ProbeVideo;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
}

// app-core không có kiểu DOM (chạy được ở cả Node lẫn trình duyệt), nên lấy `document`/`URL` qua globalThis khi gọi.
const browserProbe = (): VideoProbe => {
  const g = globalThis as unknown as {
    document: { createElement: (tag: 'video') => ProbeVideo };
    URL: { createObjectURL: (blob: Blob) => string; revokeObjectURL: (url: string) => void };
  };
  return {
    createVideo: () => g.document.createElement('video'),
    createObjectURL: (blob) => g.URL.createObjectURL(blob),
    revokeObjectURL: (url) => g.URL.revokeObjectURL(url),
  };
};

/** Độ dài video (giây) từ metadata của trình duyệt; null khi không đọc được hoặc quá `timeoutMs`. Cả hai nền tảng đều chạy trong trình duyệt. */
export function readVideoDuration(file: Blob, probe: VideoProbe = browserProbe(), timeoutMs = 4000): Promise<number | null> {
  return new Promise((resolve) => {
    const video = probe.createVideo();
    const url = probe.createObjectURL(file);
    let done = false;
    const finish = (seconds: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      probe.revokeObjectURL(url);
      resolve(seconds);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => finish(null);
    video.src = url;
  });
}
