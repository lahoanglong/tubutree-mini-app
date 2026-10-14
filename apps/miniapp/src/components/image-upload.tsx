import { useRef, useState, type CSSProperties } from 'react';
import { Camera, Loader2, RefreshCw, Video, X } from 'lucide-react';
import { haptic } from '../utils/haptic';
import { Text } from './ui/text';

const CLOUD = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
const PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined;
const CONFIGURED = Boolean(CLOUD && PRESET);

/** Chặn ảnh gốc quá lớn TRƯỚC khi đưa vào canvas nén — ảnh vài chục MB (panorama, RAW export...)
 * có thể treo/crash webview khi drawImage/toDataURL. VideoUpload đã có guard tương tự (50MB). */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Nút văn bản có vùng chạm 44px (chữ nhỏ vẫn phải bấm dễ). */
const LINK_BUTTON: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  minHeight: 44,
  padding: 0,
  border: 'none',
  background: 'none',
  font: 'inherit',
  cursor: 'pointer',
};

/**
 * Nén ảnh client-side bằng HTMLCanvasElement + FileReader.
 * Chuyển đổi tệp ảnh bất kỳ sang chuỗi Base64 Data URL JPEG dung lượng nhẹ (~150-250KB).
 */
export function readAndCompressImage(file: File, maxDim = 1200, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được tệp ảnh'));
    reader.onload = (e) => {
      const src = e.target?.result as string;
      if (!src) return reject(new Error('Tệp rỗng'));
      const img = new Image();
      img.onerror = () => reject(new Error('Không tải được ảnh'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(src);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Upload 1 file ảnh lên Cloudinary (unsigned preset) → secure_url, hoặc null nếu
 * chưa cấu hình VITE_CLOUDINARY_* hoặc request lỗi (caller tự fallback, VD base64 local).
 */
export async function uploadToCloudinary(file: File | Blob): Promise<string | null> {
  if (!CONFIGURED) return null;
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('upload_preset', PRESET!);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { secure_url?: string };
    return data.secure_url ?? null;
  } catch {
    return null;
  }
}

/**
 * Upload 1 ảnh lên Cloudinary (unsigned preset) → fallback sang FileReader Data URL nếu lỗi/chưa cấu hình.
 */
export function ImageUpload({
  label,
  value,
  onChange,
  maxDim,
  quality,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  /** Cạnh dài tối đa khi phải nén client-side (chưa cấu hình Cloudinary). */
  maxDim?: number;
  quality?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = () => {
    haptic('light');
    inputRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Ảnh quá lớn (tối đa 20MB). Hãy chọn ảnh khác nhé.');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setUploading(true);
    try {
      // 1. Thử Cloudinary nếu được cấu hình
      const secureUrl = await uploadToCloudinary(file);
      if (secureUrl) {
        haptic('medium');
        onChange(secureUrl);
        return;
      }

      // 2. Client-side Smart Compression Fallback
      const dataUrl = await readAndCompressImage(file, maxDim, quality);
      haptic('medium');
      onChange(dataUrl);
    } catch {
      setError('Tải ảnh thất bại. Hãy chọn lại tệp ảnh khác.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <Text variant="label" as="div" style={{ marginBottom: 4 }}>
          {label}
        </Text>
      )}
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onFile} />
      <button
        type="button"
        className="tubu-press"
        onClick={pick}
        style={{
          width: '100%',
          font: 'inherit',
          color: 'inherit',
          border: '1.5px dashed var(--color-border-default)',
          borderRadius: 'var(--radius-control)',
          padding: value ? 0 : 16,
          textAlign: 'center',
          overflow: 'hidden',
          minHeight: 80,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg-canvas)',
          cursor: 'pointer',
        }}
      >
        {uploading ? (
          <Text variant="body-sm" tone="tertiary" as="span" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Loader2 size={14} className="animate-spin" />
            Đang tải ảnh…
          </Text>
        ) : value ? (
          <img src={value} alt={label || 'preview'} style={{ width: '100%', maxHeight: 180, objectFit: 'cover', display: 'block' }} />
        ) : (
          <Text variant="body-sm" tone="brand" as="span" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
            <Camera size={15} />
            Chạm để tải ảnh lên
          </Text>
        )}
      </button>
      {value && !uploading && (
        <button type="button" onClick={pick} style={{ ...LINK_BUTTON, marginTop: 4, color: 'var(--color-text-brand)' }}>
          <Text variant="caption" tone="brand" as="span" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <RefreshCw size={12} />
            Đổi ảnh khác
          </Text>
        </button>
      )}
      {error && (
        <Text variant="caption" tone="danger" as="div" style={{ marginTop: 4 }}>
          {error}
        </Text>
      )}
    </div>
  );
}

/**
 * Upload 1 video review lên Cloudinary. Chưa cấu hình thì ẩn: máy chủ chỉ nhận video đã tải lên Cloudinary (URL dán tay
 * bị từ chối), nên ô dán URL chỉ dẫn khách tới lỗi.
 */
export function VideoUpload({
  value,
  onChange,
  maxSeconds = 60,
}: {
  value: string;
  onChange: (url: string) => void;
  maxSeconds?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = () => {
    haptic('light');
    inputRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (file.size > 50 * 1024 * 1024) {
      setError('Video quá lớn (tối đa 50MB). Hãy quay ngắn hơn nhé.');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('upload_preset', PRESET!);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/video/upload`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error('upload failed');
      const data = (await res.json()) as { secure_url?: string };
      if (!data.secure_url) throw new Error('no url');
      haptic('medium');
      onChange(data.secure_url);
    } catch {
      setError('Tải video thất bại, thử lại.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  if (!CONFIGURED) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <input ref={inputRef} type="file" accept="video/*" hidden onChange={onFile} />
      {value ? (
        <div>
          <video src={value} controls style={{ width: '100%', maxHeight: 200, borderRadius: 'var(--radius-control)', background: 'var(--color-bg-inverse)' }} />
          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            <button type="button" onClick={pick} style={LINK_BUTTON}>
              <Text variant="caption" tone="brand" as="span">Đổi video</Text>
            </button>
            <button type="button" onClick={() => onChange('')} style={LINK_BUTTON}>
              <Text variant="caption" tone="danger" as="span">Xóa video</Text>
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="tubu-press"
          onClick={pick}
          style={{
            width: '100%',
            font: 'inherit',
            color: 'inherit',
            border: '1.5px dashed var(--color-border-subtle)',
            borderRadius: 'var(--radius-control)',
            padding: 14,
            textAlign: 'center',
            background: 'none',
            cursor: 'pointer',
          }}
        >
          <Text variant="body-sm" tone="brand" as="span" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Video size={16} aria-hidden />
            {uploading ? 'Đang tải video…' : `Quay/đăng video review (≤ ${maxSeconds}s)`}
          </Text>
        </button>
      )}
      {error && (
        <Text variant="caption" tone="danger" as="div" style={{ marginTop: 4 }}>
          {error}
        </Text>
      )}
    </div>
  );
}

/** Upload nhiều ảnh (cho bài viết cộng đồng / đánh giá sản phẩm). */
export function MultiImageUpload({
  value = [],
  onChange,
  max = 6,
  label = 'Ảnh đính kèm',
}: {
  value?: string[];
  onChange: (urls: string[]) => void;
  max?: number;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = () => {
    haptic('light');
    inputRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const newUrls: string[] = [];
      let oversizedCount = 0;
      for (const file of files) {
        if (value.length + newUrls.length >= max) break;
        if (file.size > MAX_IMAGE_BYTES) {
          oversizedCount += 1;
          continue;
        }
        let uploadedUrl = '';
        if (CONFIGURED) {
          try {
            const form = new FormData();
            form.append('file', file);
            form.append('upload_preset', PRESET!);
            const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, {
              method: 'POST',
              body: form,
            });
            if (res.ok) {
              const data = (await res.json()) as { secure_url?: string };
              if (data.secure_url) uploadedUrl = data.secure_url;
            }
          } catch {
            // fallback
          }
        }
        if (!uploadedUrl) {
          uploadedUrl = await readAndCompressImage(file);
        }
        if (uploadedUrl) newUrls.push(uploadedUrl);
      }
      if (newUrls.length > 0) {
        haptic('medium');
        onChange([...value, ...newUrls]);
      }
      if (oversizedCount > 0) {
        setError(`Đã bỏ qua ${oversizedCount} ảnh quá lớn (tối đa 20MB/ảnh).`);
      }
    } catch {
      setError('Tải ảnh thất bại. Hãy chọn tệp ảnh khác.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div style={{ marginTop: 14, marginBottom: 14 }}>
      {label && (
        <Text variant="label" as="div" tone="secondary" style={{ marginBottom: 6 }}>
          {label} ({value.length}/{max})
        </Text>
      )}
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={onFile} />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {value.map((url, idx) => (
          <div
            key={idx}
            style={{
              position: 'relative',
              width: 72,
              height: 72,
              borderRadius: 'var(--radius-control)',
              boxShadow: 'var(--elevation-1)',
              border: '1px solid var(--color-border-subtle)',
            }}
          >
            <div style={{ width: '100%', height: '100%', overflow: 'hidden', borderRadius: 'var(--radius-control)' }}>
              <img src={url} alt={`upload-${idx}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            {/* Vùng chạm 44px nằm gọn trong ô 72px (ô kế tiếp cách 10px, lấn ra là chạm nhầm ảnh bên cạnh);
                vòng 20px nhìn thấy vẫn cách góc 3px. */}
            <button
              type="button"
              aria-label="Xóa ảnh"
              onClick={() => {
                haptic('light');
                onChange(value.filter((_, i) => i !== idx));
              }}
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: 44,
                height: 44,
                padding: 0,
                border: 'none',
                background: 'none',
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 3,
                  right: 3,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: 'var(--color-bg-scrim)',
                  color: 'var(--color-text-inverse)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={12} aria-hidden />
              </span>
            </button>
          </div>
        ))}

        {value.length < max && (
          <button
            type="button"
            className="tubu-press"
            onClick={pick}
            style={{
              width: 72,
              height: 72,
              borderRadius: 'var(--radius-control)',
              border: '1.5px dashed var(--color-border-selected)',
              background: 'var(--color-bg-subtle)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              gap: 2,
              padding: 0,
              font: 'inherit',
              color: 'inherit',
            }}
          >
            <Camera size={22} color="var(--color-text-brand)" strokeWidth={1.8} />
            <Text variant="label" tone="brand" as="span">
              {uploading ? 'Đang tải…' : 'Chạm để tải'}
            </Text>
          </button>
        )}
      </div>

      {error && (
        <Text variant="caption" tone="danger" as="div" style={{ marginTop: 4 }}>
          {error}
        </Text>
      )}
    </div>
  );
}
