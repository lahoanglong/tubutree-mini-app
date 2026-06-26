import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function QrCode({ value, size = 180 }: { value: string; size?: number }) {
  const [url, setUrl] = useState<string>('');
  useEffect(() => {
    QRCode.toDataURL(value, { width: size, margin: 1, color: { dark: '#1a1a17', light: '#ffffff' } })
      .then(setUrl).catch(() => setUrl(''));
  }, [value, size]);
  if (!url) return <div style={{ width: size, height: size, background: 'var(--neutral-100)', borderRadius: 12 }} />;
  return <img src={url} alt="QR" width={size} height={size} style={{ borderRadius: 12 }} />;
}
