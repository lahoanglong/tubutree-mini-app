// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets } from '@/test-utils/a11y';
import { ReviewVideoUpload } from './review-video-upload';

function Harness({ initial = null }: { initial?: string | null }) {
  const [video, setVideo] = useState<string | null>(initial);
  return (
    <>
      <ReviewVideoUpload value={video} onChange={setVideo} />
      <output data-testid="value">{video ?? ''}</output>
    </>
  );
}

const env = { cloud: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME, preset: process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET };
const configure = () => {
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = 'demo';
  process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET = 'reviews';
};
const restore = (key: 'NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME' | 'NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET', v: string | undefined) => {
  if (v === undefined) delete process.env[key];
  else process.env[key] = v;
};

const videoFile = (size = 1000) => {
  const f = new File(['x'], 'v.mp4', { type: 'video/mp4' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const pick = (c: HTMLElement, f: File) => {
  const input = c.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [f], configurable: true });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const value = (c: HTMLElement) => c.querySelector('[data-testid="value"]')!.textContent;

let mounted: Rendered[] = [];
const mount = async (initial: string | null = null) => {
  const r = render(<Harness initial={initial} />);
  mounted.push(r);
  await flush(2);
  return r.container;
};

const fetchMock = vi.fn();
beforeEach(() => {
  configure();
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/v.mp4', duration: 20 }) });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  restore('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME', env.cloud);
  restore('NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET', env.preset);
  vi.unstubAllGlobals();
});

describe('ReviewVideoUpload — tải video đánh giá lên Cloudinary như Mini App', () => {
  it('chọn video: gửi tới /video/upload với preset, rồi báo secure_url cho form', async () => {
    const c = await mount();
    expect(byText(c, 'button', 'Quay/đăng video review (≤ 60s)')).not.toBeNull();
    pick(c, videoFile());
    await flush(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.cloudinary.com/v1_1/demo/video/upload');
    const body = (fetchMock.mock.calls[0]![1] as RequestInit).body as FormData;
    expect(body.get('upload_preset')).toBe('reviews');
    expect(value(c)).toBe('https://res.cloudinary.com/demo/v.mp4');
    expect(c.querySelector('video')?.getAttribute('src')).toBe('https://res.cloudinary.com/demo/v.mp4');
  });

  it('video quá 50MB: báo rõ khách cần làm gì và không tải lên', async () => {
    const c = await mount();
    pick(c, videoFile(51 * 1024 * 1024));
    await flush(2);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Video quá lớn (tối đa 50MB). Hãy quay ngắn hơn nhé.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(value(c)).toBe('');
  });

  it('Cloudinary báo video dài quá 60 giây: không nhận video, nói cần cắt ngắn', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/v.mp4', duration: 95 }) });
    const c = await mount();
    pick(c, videoFile());
    await flush(4);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Video dài quá 60 giây. Hãy cắt ngắn lại rồi chọn lại nhé.');
    expect(value(c)).toBe('');
  });

  it('tải lỗi: báo thử lại và giữ nguyên video cũ', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    const c = await mount('https://res.cloudinary.com/demo/cu.mp4');
    click(byText(c, 'button', 'Đổi video'));
    pick(c, videoFile());
    await flush(4);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Tải video thất bại, thử lại.');
    expect(value(c)).toBe('https://res.cloudinary.com/demo/cu.mp4');
  });

  it('đã có video: xem trước, "Đổi video" và "Xoá video" đủ 44px; xoá thì bỏ video khỏi form', async () => {
    const c = await mount('https://res.cloudinary.com/demo/cu.mp4');
    expect(c.querySelector('video')).not.toBeNull();
    expect(smallTouchTargets(c)).toEqual([]);
    click(byText(c, 'button', 'Xoá video'));
    expect(value(c)).toBe('');
    expect(c.querySelector('video')).toBeNull();
  });

  it('bản build chưa cấu hình Cloudinary: không có nút chọn; video cũ của đánh giá vẫn được giữ nguyên và báo rõ', async () => {
    delete process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    delete process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
    const empty = await mount();
    expect(empty.querySelector('input[type="file"]')).toBeNull();
    expect(empty.textContent).not.toContain('video review');
    const kept = await mount('https://res.cloudinary.com/demo/cu.mp4');
    expect(kept.textContent).toContain('Video đã gửi kèm đánh giá này được giữ nguyên.');
    expect(kept.querySelector('input[type="file"]')).toBeNull();
  });
});
