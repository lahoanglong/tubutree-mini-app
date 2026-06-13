import { useRef, useState } from 'react';
import { Box, Text, Input } from 'zmp-ui';
import { haptic } from '../utils/haptic';

const CLOUD = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
const PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined;
const CONFIGURED = Boolean(CLOUD && PRESET);

/**
 * Upload 1 ảnh lên Cloudinary (unsigned preset) → trả secure_url qua onChange.
 * Khi chưa cấu hình env → fallback ô dán URL (vẫn hoạt động, BE nhận URL string).
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
      const form = new FormData();
      form.append('file', file);
      form.append('upload_preset', PRESET!);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error('upload failed');
      const data = (await res.json()) as { secure_url?: string };
      if (!data.secure_url) throw new Error('no url');
      haptic('medium');
      onChange(data.secure_url);
    } catch {
      setError('Tải ảnh thất bại, thử lại.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  // Fallback: chưa cấu hình Cloudinary → dán URL.
  if (!CONFIGURED) {
    return (
      <Box>
        <Input label={label} placeholder="Dán URL ảnh" value={value} onChange={(e) => onChange(e.target.value)} />
      </Box>
    );
  }

  return (
    <Box>
      <Text size="xSmall" bold style={{ marginBottom: 4 }}>
        {label}
      </Text>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onFile} />
      <Box
        className="tubu-press"
        onClick={pick}
        style={{
          border: '1.5px dashed var(--neutral-200)',
          borderRadius: 'var(--radius-md)',
          padding: value ? 0 : 16,
          textAlign: 'center',
          overflow: 'hidden',
          minHeight: 80,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {uploading ? (
          <Text size="small" style={{ color: 'var(--neutral-400)' }}>
            Đang tải ảnh…
          </Text>
        ) : value ? (
          <img src={value} alt={label} style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block' }} />
        ) : (
          <Text size="small" style={{ color: 'var(--primary-700)' }}>
            📷 Chạm để tải ảnh lên
          </Text>
        )}
      </Box>
      {value && !uploading && (
        <Text size="xSmall" onClick={pick} style={{ color: 'var(--primary-700)', marginTop: 4 }}>
          Đổi ảnh khác
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

/** Upload nhiều ảnh (cho review). */
export function MultiImageUpload({
  value,
  onChange,
  max = 5,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
  max?: number;
}) {
  if (!CONFIGURED) return null; // review ảnh chỉ bật khi có Cloudinary
  return (
    <Box flex style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      {value.map((url) => (
        <Box key={url} style={{ position: 'relative' }}>
          <img src={url} alt="review" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }} />
          <span
            onClick={() => onChange(value.filter((u) => u !== url))}
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: 'var(--danger)',
              color: '#fff',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </span>
        </Box>
      ))}
      {value.length < max && (
        <Box style={{ width: 64, height: 64 }}>
          <ImageUpload label="" value="" onChange={(url) => onChange([...value, url])} />
        </Box>
      )}
    </Box>
  );
}
