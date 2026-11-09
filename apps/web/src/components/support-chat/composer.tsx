import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import { Button, IconButton } from '@/components/mini';
import { isCloudinaryConfigured, MAX_IMAGE_BYTES, uploadToCloudinary } from '@/components/account/cloudinary-upload';
import { prepareForCloudinary } from '@/components/account/prepare-for-cloudinary';

export const CHAT_MAX_LENGTH = 1000;

interface Props {
  onSend: (body: string) => void;
  onSendImage: (imageUrl: string) => void;
  onImageError: (message: string) => void;
  disabled?: boolean;
}

export function Composer({ onSend, onSendImage, onImageError, disabled = false }: Props) {
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Khoá đồng bộ: `uploading` và `text` chỉ đổi sau lần vẽ kế, hai sự kiện cùng nhịp vẫn thấy giá trị cũ
  // (hai lần chọn ảnh sẽ tải hai lần, hai cú bấm "Gửi" sẽ gửi hai lần).
  const uploadingRef = useRef(false);
  const textRef = useRef('');
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const canImage = isCloudinaryConfigured();
  const body = text.trim();
  const locked = uploading || disabled;

  const submit = () => {
    if (disabled) return;
    const next = textRef.current.trim();
    if (!next) return;
    onSend(next);
    textRef.current = '';
    setText('');
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file || disabled || uploadingRef.current) return;
    if (file.size > MAX_IMAGE_BYTES) {
      onImageError('Ảnh quá lớn (tối đa 20MB). Hãy chọn ảnh khác nhé.');
      return;
    }
    uploadingRef.current = true;
    setUploading(true);
    let url: string | null = null;
    try {
      url = await uploadToCloudinary(await prepareForCloudinary(file));
    } catch {
      url = null;
    } finally {
      uploadingRef.current = false;
      if (mountedRef.current) setUploading(false);
    }
    if (!mountedRef.current) return;
    if (url) onSendImage(url);
    else onImageError('Tải ảnh thất bại. Hãy chọn lại ảnh khác.');
  };

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, padding: '8px 12px', background: 'var(--color-bg-surface)' }}>
      {canImage && (
        <>
          <input ref={fileRef} type="file" accept="image/*" hidden disabled={locked} onChange={(e) => void onFile(e)} />
          <span aria-busy={uploading || undefined} style={{ display: 'flex' }}>
            <IconButton
              icon={uploading ? Loader2 : ImagePlus}
              label="Đính kèm ảnh"
              onPress={() => {
                if (disabled || uploadingRef.current) return;
                fileRef.current?.click();
              }}
              style={locked ? { cursor: 'not-allowed', opacity: 0.55 } : undefined}
            />
          </span>
        </>
      )}
      <textarea
        aria-label="Nội dung tin nhắn"
        value={text}
        maxLength={CHAT_MAX_LENGTH}
        rows={1}
        placeholder="Nhập tin nhắn…"
        disabled={disabled}
        onChange={(e) => {
          textRef.current = e.target.value;
          setText(e.target.value);
        }}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 44,
          maxHeight: 120,
          boxSizing: 'border-box',
          padding: '10px 12px',
          font: 'inherit',
          color: 'var(--color-text-primary)',
          background: 'var(--color-bg-canvas)',
          border: '1px solid var(--color-border-default)',
          borderRadius: 'var(--radius-control)',
          resize: 'none',
        }}
      />
      <Button variant="primary" disabled={!body || disabled} onPress={submit}>Gửi</Button>
    </div>
  );
}
