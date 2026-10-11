import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// Không truyền màu: thư viện chỉ nhận hex và không đọc được biến CSS. Mặc định của nó là đen trên trắng,
// tương phản tối đa cho máy quét, và không đổi theo theme sáng/tối.
export function QrCode({ value, size = 180 }: { value: string; size?: number }) {
  const [url, setUrl] = useState<string>('');
  useEffect(() => {
    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then(setUrl).catch(() => setUrl(''));
  }, [value, size]);
  if (!url) return <div style={{ width: size, height: size, background: 'var(--color-bg-subtle)', borderRadius: 12 }} />;
  return <img src={url} alt="QR" width={size} height={size} style={{ borderRadius: 12 }} />;
}
