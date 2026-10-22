'use client';

import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { isCloudinaryConfigured, uploadToCloudinary } from '@/components/account/cloudinary-upload';
import { MAX_IMAGE_BYTES, MAX_PUBLIC_DATA_URL_LENGTH, isUsableImageFile, readAndCompressImage } from '@/lib/image-compress';
import { ui } from '@/lib/guest-ui';

/**
 * Ảnh đính kèm bài cộng đồng: lên Cloudinary khi bản build có cấu hình, lỗi hoặc chưa cấu hình thì nén thành ảnh nhúng (data URL)
 * trong trần của nội dung công khai — cùng thứ tự với `MultiImageUpload` của Mini App.
 */
export function ImageUpload({ value, onChange, max = 6, label = 'Ảnh đính kèm bài viết' }: { value: string[]; onChange: (urls: string[]) => void; max?: number; label?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const added: string[] = [];
      let oversized = 0;
      for (const file of files) {
        if (value.length + added.length >= max) break;
        if (!isUsableImageFile(file)) continue;
        if (file.size > MAX_IMAGE_BYTES) {
          oversized += 1;
          continue;
        }
        let url: string | null = null;
        if (isCloudinaryConfigured()) url = await uploadToCloudinary(file);
        if (!url) {
          try {
            url = await readAndCompressImage(file, MAX_PUBLIC_DATA_URL_LENGTH);
          } catch {
            url = null;
          }
        }
        if (url) added.push(url);
      }
      if (added.length > 0) onChange([...value, ...added]);
      if (oversized > 0) setError(`Đã bỏ qua ${oversized} ảnh quá lớn (tối đa 20MB/ảnh).`);
      else if (added.length === 0) setError('Tải ảnh thất bại. Hãy chọn tệp ảnh khác.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="my-3.5">
      <div className="mb-1.5 text-sm font-semibold text-stone-800">
        {label} ({value.length}/{max})
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple hidden aria-label="Chọn ảnh đính kèm" onChange={(e) => void onFiles(e)} />
      <ul className="flex flex-wrap items-center gap-2.5">
        {value.map((src, i) => (
          <li key={i} className="relative h-[4.5rem] w-[4.5rem] overflow-hidden rounded-control border border-stone-200 bg-stone-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`Ảnh ${i + 1}`} className="h-full w-full object-cover" />
            <button
              type="button"
              aria-label="Xoá ảnh"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="absolute right-0 top-0 inline-flex h-11 min-h-11 w-11 items-start justify-end p-1"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-stone-900/70 text-stone-0">
                <X className="h-3 w-3" aria-hidden="true" />
              </span>
            </button>
          </li>
        ))}
        {value.length < max && (
          <li>
            <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className={ui.btnSecondary}>
              <ImagePlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {busy ? 'Đang tải ảnh…' : 'Thêm ảnh'}
            </button>
          </li>
        )}
      </ul>
      {error && (
        <p role="alert" className={`mt-1 ${ui.error}`}>
          {error}
        </p>
      )}
    </div>
  );
}
