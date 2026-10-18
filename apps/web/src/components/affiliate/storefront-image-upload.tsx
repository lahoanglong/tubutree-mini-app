'use client';

import { useRef, useState } from 'react';
import { Camera, RefreshCw } from 'lucide-react';
import { uploadToCloudinary } from '@/components/account/cloudinary-upload';
import { fitWithin, isUsableImageFile, MAX_IMAGE_BYTES } from '@/lib/image-compress';

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Không tải được ảnh'));
    };
    img.src = url;
  });
}

async function compress(file: File, maxDim: number, quality: number): Promise<string> {
  const img = await loadImage(file);
  const { width, height } = fitWithin(img.naturalWidth || img.width, img.naturalHeight || img.height, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không xử lý được ảnh');
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Ô tải ảnh đại diện/ảnh bìa gian hàng: Cloudinary khi bản build có cấu hình, không thì nén ngay trong trình duyệt thành
 * data URL (cùng cách của Mini App). Ảnh đại diện nhỏ nên nén mạnh hơn ảnh bìa; cả hai đi kèm mọi lượt xem gian hàng.
 */
export function StorefrontImageUpload({
  label,
  value,
  onChange,
  maxDim,
  quality,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  maxDim: number;
  quality: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const reset = () => {
      if (inputRef.current) inputRef.current.value = '';
    };
    if (!isUsableImageFile(file)) {
      setError('Tệp này không phải ảnh. Hãy chọn ảnh khác nhé.');
      return reset();
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Ảnh quá lớn (tối đa 20MB). Hãy chọn ảnh khác nhé.');
      return reset();
    }
    setBusy(true);
    try {
      onChange((await uploadToCloudinary(file)) ?? (await compress(file, maxDim, quality)));
    } catch {
      setError('Tải ảnh thất bại. Hãy chọn lại tệp ảnh khác.');
    } finally {
      setBusy(false);
      reset();
    }
  };

  return (
    <div className="mb-3">
      <div className="mb-1 text-sm font-medium text-stone-800">{label}</div>
      <input ref={inputRef} type="file" accept="image/*" hidden aria-label={`Chọn tệp ${label.toLowerCase()}`} onChange={(e) => void onFile(e)} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label={value ? `Đổi ${label.toLowerCase()}` : `Tải lên ${label.toLowerCase()}`}
        className="flex min-h-20 w-full items-center justify-center overflow-hidden rounded-control border-2 border-dashed border-stone-450 bg-stone-50 text-sm font-semibold text-forest-700"
      >
        {busy ? (
          <span role="status">Đang tải ảnh…</span>
        ) : value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={label} className="block max-h-44 w-full object-cover" />
        ) : (
          <span className="inline-flex items-center gap-1.5 p-4">
            <Camera className="h-4 w-4" aria-hidden="true" />
            Chạm để tải ảnh lên
          </span>
        )}
      </button>
      {value && !busy && (
        <button type="button" onClick={() => inputRef.current?.click()} className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-forest-700">
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          Đổi ảnh khác
        </button>
      )}
      {error && (
        <div role="alert" className="mt-1 text-xs text-danger-fg">
          {error}
        </div>
      )}
    </div>
  );
}
