'use client';

import { useRef, useState } from 'react';
import { Video } from 'lucide-react';
import {
  REVIEW_VIDEO_MAX_SECONDS,
  VideoUploadError,
  readVideoDuration,
  uploadCloudinaryVideo,
  videoUploadCopy,
} from '@tubutree/app-core/cloudinary-video';
import { ui } from '@/lib/guest-ui';
import { reviewVideoConfig } from './review-video-config';

/**
 * Video đánh giá: tải thẳng lên Cloudinary, cùng giới hạn và lời báo với Mini App. Máy chủ chỉ nhận video đã tải lên
 * Cloudinary (URL dán tay bị từ chối) nên bản build chưa cấu hình thì ẩn ô chọn; video đã gắn vào đánh giá đang sửa vẫn
 * được giữ để lưu lại không làm mất video. `onBusyChange` báo form cha khi đang tải: video 50MB trên 4G mất cả phút, form phải
 * chờ thay vì gửi đánh giá không kèm video (mất thưởng, sửa lại cũng không được cộng thêm).
 */
export function ReviewVideoUpload({
  value,
  onChange,
  onBusyChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changeBusy = (next: boolean) => {
    setBusy(next);
    onBusyChange?.(next);
  };

  const config = reviewVideoConfig();
  if (!config) {
    return value ? <p className="mt-2 text-sm text-stone-600">Video đã gửi kèm đánh giá này được giữ nguyên.</p> : null;
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    changeBusy(true);
    try {
      onChange(await uploadCloudinaryVideo(file, config, { readDuration: readVideoDuration }));
    } catch (err) {
      setError(err instanceof VideoUploadError ? err.message : videoUploadCopy.failed);
    } finally {
      changeBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="mt-3">
      <input ref={inputRef} type="file" accept="video/*" hidden aria-label="Chọn video đánh giá" className="min-h-11" onChange={(e) => void onFile(e)} />
      {value ? (
        <div>
          <video src={value} controls preload="metadata" playsInline className="max-h-56 w-full rounded-control bg-stone-900" />
          <div className="mt-1 flex gap-3">
            <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || busy} className={`${ui.btnText} text-forest-600`}>
              {busy ? videoUploadCopy.uploading : 'Đổi video'}
            </button>
            <button type="button" onClick={() => onChange(null)} disabled={disabled || busy} className={`${ui.btnText} text-danger-fg`}>
              Xoá video
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-control border-[1.5px] border-dashed border-stone-450 p-3.5 text-sm font-semibold text-forest-600 disabled:opacity-50"
        >
          <Video className="h-4 w-4" aria-hidden="true" />
          {busy ? videoUploadCopy.uploading : videoUploadCopy.pick(REVIEW_VIDEO_MAX_SECONDS)}
        </button>
      )}
      {error && (
        <p role="alert" className={`mt-1 ${ui.error}`}>
          {error}
        </p>
      )}
    </div>
  );
}
