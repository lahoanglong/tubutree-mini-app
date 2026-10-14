'use client';

import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { MAX_IMAGE_BYTES, isUsableImageFile, readAndCompressImage } from '@/lib/image-compress';
import { ui } from '@/lib/guest-ui';

/**
 * Ảnh minh chứng cho yêu cầu đổi/trả (hàng lỗi, vỡ, giao sai): khách chọn ảnh, trình duyệt nén thành JPEG nhẹ và gửi kèm
 * yêu cầu dưới dạng `images[]` — cùng cách Mini App làm khi chưa cấu hình Cloudinary — để admin thấy ảnh ngay cạnh yêu
 * cầu thay vì phải dò email.
 */
export function EvidenceUpload({
  value,
  onChange,
  max = 3,
  disabled = false,
}: {
  value: string[];
  onChange: (images: string[]) => void;
  max?: number;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setNotice(null);
    setBusy(true);
    const added: string[] = [];
    const problems: string[] = [];
    let notImage = 0;
    let tooBig = 0;
    let overLimit = 0;
    let failed = 0;
    try {
      for (const file of files) {
        if (value.length + added.length >= max) {
          overLimit += 1;
          continue;
        }
        if (!isUsableImageFile(file)) {
          notImage += 1;
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          tooBig += 1;
          continue;
        }
        try {
          added.push(await readAndCompressImage(file));
        } catch {
          failed += 1;
        }
      }
      if (added.length > 0) onChange([...value, ...added]);
      if (overLimit > 0) problems.push(`Chỉ gửi được tối đa ${max} ảnh, đã bỏ qua ${overLimit} ảnh.`);
      if (notImage > 0) problems.push(`Đã bỏ qua ${notImage} tệp không phải ảnh.`);
      if (tooBig > 0) problems.push(`Đã bỏ qua ${tooBig} ảnh quá lớn (tối đa 20MB mỗi ảnh).`);
      if (failed > 0) problems.push('Không xử lý được ảnh, hãy chọn ảnh khác.');
      setNotice(problems.length > 0 ? problems.join(' ') : null);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const full = value.length >= max;

  return (
    <div>
      <div className="text-sm font-semibold text-stone-900">
        Ảnh minh chứng (khuyến khích, tối đa {max}){' '}
        <span className="font-normal text-stone-600">
          {value.length}/{max}
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-label="Chọn ảnh minh chứng"
        onChange={(e) => void onFiles(e)}
        className="min-h-11"
      />
      <ul className="mt-2 flex flex-wrap items-center gap-2">
        {value.map((src, i) => (
          <li key={i} className="relative h-[4.5rem] w-[4.5rem] flex-none overflow-hidden rounded-control border border-stone-200 bg-stone-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`Ảnh minh chứng ${i + 1}`} className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              disabled={disabled || busy}
              aria-label={`Xóa ảnh minh chứng ${i + 1}`}
              className="absolute right-0 top-0 inline-flex h-11 w-11 items-start justify-end p-1 disabled:opacity-50"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-stone-900/70 text-stone-0">
                <X className="h-3 w-3" aria-hidden="true" />
              </span>
            </button>
          </li>
        ))}
        <li className="flex-none">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || busy || full}
            className={ui.btnSecondary}
          >
            <ImagePlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {busy ? 'Đang xử lý ảnh…' : 'Thêm ảnh'}
          </button>
        </li>
      </ul>
      {notice && (
        <p role="alert" className={`mt-1 ${ui.error}`}>
          {notice}
        </p>
      )}
    </div>
  );
}
