import { useRef, useState } from 'react';
import { Box, Text, Input } from 'zmp-ui';
import { haptic } from '../utils/haptic';

const CLOUD = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
const PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined;
const CONFIGURED = Boolean(CLOUD && PRESET);

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
 * Upload 1 ảnh lên Cloudinary (unsigned preset) → fallback sang FileReader Data URL nếu lỗi/chưa cấu hình.
 */
export function ImageUpload({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
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
    setUploading(true);
    try {
      // 1. Thử Cloudinary nếu được cấu hình
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
            if (data.secure_url) {
              haptic('medium');
              onChange(data.secure_url);
              setUploading(false);
              if (inputRef.current) inputRef.current.value = '';
              return;
            }
          }
        } catch {
          // Cloudinary fail -> fallback to local FileReader compression
        }
      }

      // 2. Client-side Smart Compression Fallback
      const dataUrl = await readAndCompressImage(file);
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
    <Box style={{ marginBottom: 12 }}>
      {label && (
        <Text size="xSmall" bold style={{ marginBottom: 4 }}>
          {label}
        </Text>
      )}
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onFile} />
      <Box
        className="tubu-press"
        onClick={pick}
        style={{
          border: '1.5px dashed var(--neutral-300)',
          borderRadius: 'var(--radius-md)',
          padding: value ? 0 : 16,
          textAlign: 'center',
          overflow: 'hidden',
          minHeight: 80,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--neutral-50)',
          cursor: 'pointer',
        }}
      >
        {uploading ? (
          <Text size="small" style={{ color: 'var(--neutral-500)' }}>
            ⏳ Đang tải ảnh…
          </Text>
        ) : value ? (
          <img src={value} alt={label || 'preview'} style={{ width: '100%', maxHeight: 180, objectFit: 'cover', display: 'block' }} />
        ) : (
          <Text size="small" bold style={{ color: 'var(--leaf-700)' }}>
            📷 Chạm để tải ảnh lên
          </Text>
        )}
      </Box>
      {value && !uploading && (
        <Text size="xSmall" onClick={pick} style={{ color: 'var(--leaf-700)', marginTop: 4, cursor: 'pointer' }}>
          🔄 Đổi ảnh khác
        </Text>
      )}
      {error && (
        <Text size="xSmall" style={{ color: 'var(--danger)', marginTop: 4 }}>
          {error}
        </Text>
      )}
    </Box>
  );
}

/**
 * Upload 1 video review lên Cloudinary → fallback dán URL nếu chưa cấu hình.
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

  if (!CONFIGURED) {
    return (
      <Box style={{ marginTop: 8 }}>
        <Input label="Video review (không bắt buộc)" placeholder="Dán URL video" value={value} onChange={(e) => onChange(e.target.value)} />
      </Box>
    );
  }

  return (
    <Box style={{ marginTop: 8 }}>
      <input ref={inputRef} type="file" accept="video/*" hidden onChange={onFile} />
      {value ? (
        <Box>
          <video src={value} controls style={{ width: '100%', maxHeight: 200, borderRadius: 'var(--radius-md)', background: '#000' }} />
          <Box flex style={{ gap: 12, marginTop: 4 }}>
            <Text size="xSmall" onClick={pick} style={{ color: 'var(--primary-700)' }}>Đổi video</Text>
            <Text size="xSmall" onClick={() => onChange('')} style={{ color: 'var(--danger)' }}>Xóa video</Text>
          </Box>
        </Box>
      ) : (
        <Box
          className="tubu-press"
          onClick={pick}
          style={{ border: '1.5px dashed var(--neutral-200)', borderRadius: 'var(--radius-md)', padding: 14, textAlign: 'center' }}
        >
          <Text size="small" style={{ color: 'var(--primary-700)' }}>
            {uploading ? 'Đang tải video…' : `🎬 Quay/đăng video review (≤ ${maxSeconds}s)`}
          </Text>
        </Box>
      )}
      {error && (
        <Text size="xSmall" style={{ color: 'var(--danger)', marginTop: 4 }}>{error}</Text>
      )}
    </Box>
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
      for (const file of files) {
        if (value.length + newUrls.length >= max) break;
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
    } catch {
      setError('Tải ảnh thất bại. Hãy chọn tệp ảnh khác.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Box style={{ marginTop: 14, marginBottom: 14 }}>
      {label && (
        <Text size="xSmall" bold style={{ color: 'var(--neutral-700)', marginBottom: 6 }}>
          {label} ({value.length}/{max})
        </Text>
      )}
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={onFile} />

      <Box flex style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {value.map((url, idx) => (
          <Box
            key={idx}
            style={{
              position: 'relative',
              width: 72,
              height: 72,
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              boxShadow: 'var(--shadow-xs)',
              border: '1px solid var(--neutral-200)',
            }}
          >
            <img src={url} alt={`upload-${idx}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <Box
              role="button"
              aria-label="Xóa ảnh"
              onClick={() => {
                haptic('light');
                onChange(value.filter((_, i) => i !== idx));
              }}
              style={{
                position: 'absolute',
                top: 3,
                right: 3,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: 'rgba(0,0,0,0.65)',
                color: '#fff',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              ✕
            </Box>
          </Box>
        ))}

        {value.length < max && (
          <Box
            className="tubu-press"
            onClick={pick}
            style={{
              width: 72,
              height: 72,
              borderRadius: 'var(--radius-md)',
              border: '1.5px dashed var(--leaf-400, #4da492)',
              background: 'var(--leaf-50, #f4f9f7)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              gap: 2,
            }}
          >
            <Text style={{ fontSize: 20, lineHeight: 1 }}>📷</Text>
            <Text size="xSmall" bold style={{ color: 'var(--leaf-700)', fontSize: 9.5 }}>
              {uploading ? 'Đang tải…' : 'Chạm để tải'}
            </Text>
          </Box>
        )}
      </Box>

      {error && (
        <Text size="xSmall" style={{ color: 'var(--danger)', marginTop: 4 }}>
          {error}
        </Text>
      )}
    </Box>
  );
}
