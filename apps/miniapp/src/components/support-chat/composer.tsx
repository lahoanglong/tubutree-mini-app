import { useRef, useState } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import { IconButton } from '../ui/icon-button';
import { Button } from '../ui/button';
import { isCloudinaryConfigured, MAX_IMAGE_BYTES, uploadToCloudinary } from '../image-upload';

export const CHAT_MAX_LENGTH = 1000;

interface Props {
  onSend: (body: string) => void;
  onSendImage: (imageUrl: string) => void;
  onImageError: (message: string) => void;
}

export function Composer({ onSend, onSendImage, onImageError }: Props) {
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canImage = isCloudinaryConfigured();
  const body = text.trim();

  const submit = () => {
    if (!body) return;
    onSend(body);
    setText('');
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      onImageError('Ảnh quá lớn (tối đa 20MB). Hãy chọn ảnh khác nhé.');
      return;
    }
    setUploading(true);
    const url = await uploadToCloudinary(file);
    setUploading(false);
    if (url) onSendImage(url);
    else onImageError('Tải ảnh thất bại. Hãy chọn lại ảnh khác.');
  };

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, padding: '8px 12px', background: 'var(--color-bg-surface)' }}>
      {canImage && (
        <>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onFile(e)} />
          <IconButton
            icon={uploading ? Loader2 : ImagePlus}
            label="Đính kèm ảnh"
            onPress={() => !uploading && fileRef.current?.click()}
          />
        </>
      )}
      <textarea
        aria-label="Nội dung tin nhắn"
        value={text}
        maxLength={CHAT_MAX_LENGTH}
        rows={1}
        placeholder="Nhập tin nhắn…"
        onChange={(e) => setText(e.target.value)}
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
      <Button variant="primary" disabled={!body} onPress={submit}>Gửi</Button>
    </div>
  );
}
