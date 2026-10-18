'use client';

import { useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { BTN_LINK, INPUT_CLASS, TOUCH_H } from '@/components/admin/ui';

/**
 * Chỉ http/https mới dựng thẻ img: `javascript:` và `data:` không bao giờ vào thuộc tính src từ ô nhập của đối tác.
 * Trả về liên kết đã cắt khoảng trắng, hoặc null khi không xem trước được.
 */
export function previewableImageUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? trimmed : null;
  } catch {
    return null;
  }
}

const PREVIEW_BOX: Record<'avatar' | 'cover', string> = {
  avatar: 'h-16 w-16 shrink-0',
  cover: 'aspect-[3/1] w-full',
};

/**
 * Ô dán liên kết ảnh kèm xem trước. Web chưa có đường tải ảnh lên cho cổng đối tác (chỉ có nén ảnh minh chứng gửi dạng
 * data URL), nên giữ cách dán liên kết nhưng cho đối tác thấy ảnh thật trước khi bấm Lưu.
 */
export function ImageUrlField({
  id,
  label,
  value,
  onChange,
  shape,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  shape: 'avatar' | 'cover';
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const src = previewableImageUrl(value);
  const failed = src !== null && failedUrl === src;
  const hintId = `${id}-hint`;

  let hint = 'Chưa có ảnh. Dán liên kết ảnh (bắt đầu bằng https://) để xem trước.';
  if (value.trim() && !src) hint = 'Liên kết chưa hợp lệ: cần bắt đầu bằng https://.';
  else if (failed) hint = 'Không tải được ảnh từ liên kết này. Kiểm tra lại liên kết hoặc thử ảnh khác.';
  else if (src) hint = 'Ảnh xem trước. Bấm Lưu để áp dụng cho gian hàng.';

  const hintTone = (value.trim() && !src) || failed ? 'text-danger-fg' : 'text-stone-500';

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-stone-700">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://..."
        inputMode="url"
        autoComplete="off"
        aria-describedby={hintId}
        className={`mt-1 ${INPUT_CLASS} ${TOUCH_H}`}
      />
      <div className={shape === 'avatar' ? 'mt-2 flex items-center gap-3' : 'mt-2 space-y-2'}>
        <div
          data-preview
          className={`flex items-center justify-center overflow-hidden rounded-media border border-stone-200 bg-stone-50 text-stone-400 ${PREVIEW_BOX[shape]}`}
        >
          {src && !failed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={`Xem trước: ${label}`}
              referrerPolicy="no-referrer"
              onError={() => setFailedUrl(src)}
              className="h-full w-full object-cover"
            />
          ) : (
            <ImageIcon className="h-6 w-6" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p id={hintId} className={`text-xs ${hintTone}`}>
            {hint}
          </p>
          {value.trim() && (
            <button type="button" onClick={() => onChange('')} className={`${BTN_LINK} text-xs`}>
              Xoá ảnh
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
