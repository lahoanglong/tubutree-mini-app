'use client';

import { useRef, useState } from 'react';
import { Camera, Loader2, RefreshCw } from 'lucide-react';
import { uploadToCloudinary } from '@/components/account/cloudinary-upload';
import { MAX_IMAGE_BYTES, isUsableImageFile, readAndCompressImage } from '@/lib/image-compress';
import { ui } from '@/lib/guest-ui';
import { skin } from '@/components/pro-shared/mini-skin';

/**
 * Ô tải ảnh logo/ảnh bìa, cùng cách `ImageUpload` của Mini App: ưu tiên Cloudinary, chưa cấu hình hoặc lỗi thì nén thành
 * data URL JPEG nhẹ (API nhận cả hai, trần 1,5 triệu ký tự).
 */
export function BrandImageField({ label, value, onChange }: { label: string; value: string; onChange: (url: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      if (!isUsableImageFile(file)) {
        setError('Tệp này không phải ảnh. Hãy chọn ảnh khác nhé.');
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError('Ảnh quá lớn (tối đa 20MB). Hãy chọn ảnh khác nhé.');
        return;
      }
      setBusy(true);
      const secureUrl = await uploadToCloudinary(file);
      onChange(secureUrl ?? (await readAndCompressImage(file)));
    } catch {
      setError('Tải ảnh thất bại. Hãy chọn lại tệp ảnh khác.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      <div className="mb-1 text-xs text-stone-600 max-md:text-[length:var(--type-label-size)] max-md:font-semibold max-md:leading-[var(--type-label-lh)] max-md:text-[color:var(--color-text-primary)]">{label}</div>
      <input ref={inputRef} type="file" accept="image/*" hidden aria-label={`Chọn ảnh ${label.toLowerCase()}`} onChange={(e) => void onFile(e)} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label={value ? `Đổi ảnh ${label.toLowerCase()}` : `Tải ảnh ${label.toLowerCase()} lên`}
        className="flex min-h-20 w-full items-center justify-center overflow-hidden rounded-control border-2 border-dashed border-stone-450 bg-stone-50 max-md:border-[1.5px] max-md:border-[color:var(--color-border-default)] max-md:bg-[color:var(--color-bg-canvas)] text-sm font-semibold text-forest-700 hover:bg-stone-100 disabled:opacity-60"
      >
        {busy ? (
          <span className="inline-flex items-center gap-1 text-stone-600">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Đang tải ảnh…
          </span>
        ) : value ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL Cloudinary hoặc data URL xem trước, domain không cố định
          <img src={value} alt={`Ảnh ${label.toLowerCase()}`} className="max-h-44 w-full object-cover" />
        ) : (
          <span className="inline-flex items-center gap-1.5 p-4">
            <Camera className="h-4 w-4" aria-hidden="true" />
            Chạm để tải ảnh lên
          </span>
        )}
      </button>
      {value && !busy && (
        <button type="button" onClick={() => inputRef.current?.click()} className={`${ui.btnText} no-underline text-forest-700`}>
          <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
          Đổi ảnh khác
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
